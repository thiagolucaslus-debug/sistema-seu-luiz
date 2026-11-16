from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import sqlite3
import sys
from datetime import date
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import pytest
from cryptography.exceptions import InvalidTag
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import auth as auth_module
import database
import models
from routers import auth as auth_router
from routers import cartoes, cloud, contas, dividas, lancamentos, modulos, pessoas, relatorios, solicitacoes, sync_hub
from services import pdf_generator
from services.cloud_sync import CloudSyncManager
from services.hub_sync import HubSyncASGIMiddleware, HubSyncClient
from services.vault_crypto import (
    decrypt_vault_blob,
    encrypt_vault_blob,
    decode_vault_aes_key,
)
from tenancy import USER_OWNED_TABLES


def _make_isolated_node(
    tmp_base: Path,
    name: str,
    *,
    desktop_mode: bool = False,
    hub_transport: Any = None,
    vault_http: Any = None,
    hydrate_secret: str | None = None,
) -> dict[str, Any]:
    """Cria uma instância FastAPI + SQLite 100% isolada (simulando Hub Nuvem ou um PC Desktop)."""
    data_dir = tmp_base / name
    data_dir.mkdir(parents=True, exist_ok=True)
    uploads_dir = data_dir / "uploads"
    pdfs_dir = data_dir / "pdfs"
    uploads_dir.mkdir(exist_ok=True)
    pdfs_dir.mkdir(exist_ok=True)
    db_path = data_dir / "financeiro.db"

    eng = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False, "timeout": 30},
    )
    SessionNode = sessionmaker(autocommit=False, autoflush=False, bind=eng)
    models.Base.metadata.create_all(bind=eng)

    def _migrate_node() -> None:
        with eng.begin() as conn:
            cols_u = {r[1] for r in conn.execute(text("PRAGMA table_info(usuarios)"))}
            if "sync_rev" not in cols_u:
                conn.execute(text("ALTER TABLE usuarios ADD COLUMN sync_rev INTEGER NOT NULL DEFAULT 1"))
            for tbl in USER_OWNED_TABLES:
                cols = {r[1] for r in conn.execute(text(f"PRAGMA table_info({tbl})"))}
                if "usuario_id" not in cols:
                    conn.execute(text(f"ALTER TABLE {tbl} ADD COLUMN usuario_id INTEGER"))
                conn.execute(text(f"CREATE INDEX IF NOT EXISTS ix_{tbl}_usuario_id ON {tbl} (usuario_id)"))

    _migrate_node()

    def override_get_db():
        db = SessionNode()
        try:
            yield db
        finally:
            db.close()

    cloud_mgr = CloudSyncManager(
        data_dir=data_dir,
        db_path=db_path,
        config_dir=data_dir / "cfg",
        http_transport=vault_http,
        engine_disposer=eng.dispose,
        schema_migrator=_migrate_node,
        debounce_seconds=60.0,
        max_wait_seconds=120.0,
    )

    app = FastAPI()

    # Override per-node directories and cloud manager safely
    app.dependency_overrides[database.get_db] = override_get_db
    app.dependency_overrides[cloud.get_cloud_manager] = lambda: cloud_mgr

    # Routers
    for r in (
        auth_router.router,
        contas.router,
        cartoes.router,
        pessoas.router,
        modulos.router,
        lancamentos.router,
        dividas.router,
        relatorios.router,
        solicitacoes.router,
        sync_hub.router,
        cloud.router,
    ):
        app.include_router(r)

    app.mount("/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")

    hub_client = None
    if desktop_mode:
        hub_client = HubSyncClient(
            data_dir=data_dir,
            db_path=db_path,
            hub_url="https://hub.test",
            http_transport=hub_transport,
            enabled=True,
            version_poll_interval_sec=0.0,
            offline_cooldown_sec=0.05,
        )
        app.add_middleware(HubSyncASGIMiddleware, hub_client=hub_client)

    # Context wrapper ensuring file uploads/PDFs land in this node's data_dir
    class NodeClient:
        def __init__(self, inner: TestClient):
            self._inner = inner

        def request(self, method: str, url: str, **kwargs):
            old_auth_up = auth_router.UPLOADS_DIR
            old_pes_dd = pessoas.DATA_DIR
            old_pdf_dd = pdf_generator.DATA_DIR
            old_sol_dd = solicitacoes.DATA_DIR
            old_sol_up = solicitacoes.UPLOADS_DIR
            old_sync_dd = sync_hub.DATA_DIR
            old_hyd = os.environ.get("CLOUD_VAULT_HYDRATE_SHA256")
            try:
                auth_router.UPLOADS_DIR = uploads_dir
                pessoas.DATA_DIR = str(data_dir)
                pdf_generator.DATA_DIR = str(data_dir)
                solicitacoes.DATA_DIR = str(data_dir)
                solicitacoes.UPLOADS_DIR = str(uploads_dir)
                sync_hub.DATA_DIR = str(data_dir)
                if hydrate_secret is not None:
                    os.environ["CLOUD_VAULT_HYDRATE_SHA256"] = hashlib.sha256(
                        hydrate_secret.encode("utf-8")
                    ).hexdigest()
                return self._inner.request(method, url, **kwargs)
            finally:
                auth_router.UPLOADS_DIR = old_auth_up
                pessoas.DATA_DIR = old_pes_dd
                pdf_generator.DATA_DIR = old_pdf_dd
                solicitacoes.DATA_DIR = old_sol_dd
                solicitacoes.UPLOADS_DIR = old_sol_up
                sync_hub.DATA_DIR = old_sync_dd
                if hydrate_secret is not None:
                    if old_hyd is None:
                        os.environ.pop("CLOUD_VAULT_HYDRATE_SHA256", None)
                    else:
                        os.environ["CLOUD_VAULT_HYDRATE_SHA256"] = old_hyd

        def get(self, url: str, **kw):
            return self.request("GET", url, **kw)

        def post(self, url: str, **kw):
            return self.request("POST", url, **kw)

        def put(self, url: str, **kw):
            return self.request("PUT", url, **kw)

        def patch(self, url: str, **kw):
            return self.request("PATCH", url, **kw)

        def delete(self, url: str, **kw):
            return self.request("DELETE", url, **kw)

    tc = TestClient(app)
    return {
        "client": NodeClient(tc),
        "raw_client": tc,
        "data_dir": data_dir,
        "db_path": db_path,
        "uploads_dir": uploads_dir,
        "cloud_mgr": cloud_mgr,
        "hub_client": hub_client,
        "engine": eng,
    }


class FakeGitHubVaultAPI:
    """Simula em memória a API Git Data do GitHub (refs, commits, trees, blobs)."""

    def __init__(self) -> None:
        self.blobs: dict[str, bytes] = {}
        self.trees: dict[str, list[dict[str, Any]]] = {}
        self.commits: dict[str, dict[str, Any]] = {}
        self.refs: dict[str, str] = {}
        self._counter = 0

    def _next_sha(self, prefix: str) -> str:
        self._counter += 1
        return hashlib.sha1(f"{prefix}:{self._counter}".encode("utf-8")).hexdigest()

    def transport(
        self,
        method: str,
        url: str,
        headers: dict[str, str] | None = None,
        data: bytes | None = None,
        timeout: float = 30.0,
    ) -> tuple[int, dict[str, str], bytes]:
        parts = urlsplit(url)
        path = parts.path
        body = json.loads(data.decode("utf-8")) if data else {}

        # GET /repos/{owner}/{repo}
        if method == "GET" and path.count("/") == 3 and path.startswith("/repos/"):
            return 200, {}, json.dumps({"full_name": path[len("/repos/"):], "private": True}).encode()

        # GET /repos/{owner}/{repo}/git/ref/heads/{branch}
        if method == "GET" and "/git/ref/heads/" in path:
            branch = path.split("/git/ref/heads/", 1)[1]
            if branch not in self.refs:
                return 404, {}, json.dumps({"message": "Not Found"}).encode()
            return 200, {}, json.dumps({"object": {"sha": self.refs[branch]}}).encode()

        # POST /repos/{owner}/{repo}/git/blobs
        if method == "POST" and path.endswith("/git/blobs"):
            raw = base64.b64decode(body["content"]) if body.get("encoding") == "base64" else body["content"].encode()
            sha = self._next_sha("blob")
            self.blobs[sha] = raw
            return 201, {}, json.dumps({"sha": sha}).encode()

        # GET /repos/{owner}/{repo}/git/blobs/{sha}
        if method == "GET" and "/git/blobs/" in path:
            sha = path.rsplit("/", 1)[1]
            if sha not in self.blobs:
                return 404, {}, b"{}"
            b64 = base64.b64encode(self.blobs[sha]).decode("ascii")
            return 200, {}, json.dumps({"sha": sha, "encoding": "base64", "content": b64}).encode()

        # POST /repos/{owner}/{repo}/git/trees
        if method == "POST" and path.endswith("/git/trees"):
            sha = self._next_sha("tree")
            self.trees[sha] = list(body.get("tree") or [])
            return 201, {}, json.dumps({"sha": sha}).encode()

        # GET /repos/{owner}/{repo}/git/trees/{sha}
        if method == "GET" and "/git/trees/" in path:
            sha = path.rsplit("/", 1)[1]
            if sha not in self.trees:
                return 404, {}, b"{}"
            return 200, {}, json.dumps({"sha": sha, "tree": self.trees[sha]}).encode()

        # POST /repos/{owner}/{repo}/git/commits
        if method == "POST" and path.endswith("/git/commits"):
            sha = self._next_sha("commit")
            self.commits[sha] = {"tree": body["tree"], "parents": body.get("parents") or []}
            return 201, {}, json.dumps({"sha": sha}).encode()

        # GET /repos/{owner}/{repo}/git/commits/{sha}
        if method == "GET" and "/git/commits/" in path:
            sha = path.rsplit("/", 1)[1]
            if sha not in self.commits:
                return 404, {}, b"{}"
            return 200, {}, json.dumps({"sha": sha, "tree": {"sha": self.commits[sha]["tree"]}}).encode()

        # POST /repos/{owner}/{repo}/git/refs
        if method == "POST" and path.endswith("/git/refs"):
            branch = str(body["ref"]).removeprefix("refs/heads/")
            self.refs[branch] = body["sha"]
            return 201, {}, json.dumps({"ref": body["ref"], "object": {"sha": body["sha"]}}).encode()

        # PATCH /repos/{owner}/{repo}/git/refs/heads/{branch}
        if method == "PATCH" and "/git/refs/heads/" in path:
            branch = path.split("/git/refs/heads/", 1)[1]
            self.refs[branch] = body["sha"]
            return 200, {}, json.dumps({"object": {"sha": body["sha"]}}).encode()

        return 404, {}, json.dumps({"message": f"Unhandled {method} {path}"}).encode()


def test_multiuser_strict_isolation_and_public_links(tmp_path: Path):
    node = _make_isolated_node(tmp_path, "hub_iso")
    c = node["client"]

    # 1. Registra dois perfis independentes
    r_ana = c.post("/auth/register", json={"nome": "Ana Silva", "usuario": "ana", "senha": "123456"})
    assert r_ana.status_code == 200
    h_ana = {"Authorization": f"Bearer {r_ana.json()['access_token']}"}

    r_carlos = c.post("/auth/register", json={"nome": "Carlos Souza", "usuario": "carlos", "senha": "654321"})
    assert r_carlos.status_code == 200
    h_carlos = {"Authorization": f"Bearer {r_carlos.json()['access_token']}"}

    # 2. Ana cadastra conta, cartão, pessoa, módulo e lançamentos
    conta_ana = c.post("/contas/", json={"nome": "Conta Ana", "banco": "Itau", "saldo_inicial": 2500.0}, headers=h_ana).json()
    cartao_ana = c.post(
        "/cartoes/",
        json={"nome": "Nubank Ana", "bandeira": "Mastercard", "limite": 8000, "dia_fechamento": 10, "dia_vencimento": 17},
        headers=h_ana,
    ).json()
    pessoa_ana = c.post("/pessoas/", json={"nome": "Marina", "telefone": "11999991111"}, headers=h_ana).json()
    modulo_ana = c.post("/modulos/", json={"nome": "Supermercado", "orcamento_mensal": 1200}, headers=h_ana).json()

    hoje = date.today().isoformat()
    lanc_ana = c.post(
        "/lancamentos/",
        json={
            "descricao": "Compra Mercado Marina",
            "valor_total": 300.0,
            "tipo": "compra_cartao",
            "data_lancamento": hoje,
            "cartao_id": cartao_ana["id"],
            "pessoa_id": pessoa_ana["id"],
            "modulo_id": modulo_ana["id"],
            "total_parcelas": 2,
        },
        headers=h_ana,
    )
    assert lanc_ana.status_code == 200

    # 3. Carlos cadastra seus próprios dados
    cartao_carlos = c.post(
        "/cartoes/",
        json={"nome": "Inter Carlos", "bandeira": "Visa", "limite": 5000, "dia_fechamento": 5, "dia_vencimento": 12},
        headers=h_carlos,
    ).json()
    pessoa_carlos = c.post("/pessoas/", json={"nome": "Pedro", "telefone": "11988882222"}, headers=h_carlos).json()

    # 4. Verifica isolamento total de leitura
    assert [x["nome"] for x in c.get("/contas/", headers=h_carlos).json()] == []
    assert [x["nome"] for x in c.get("/cartoes/", headers=h_carlos).json()] == ["Inter Carlos"]
    assert [x["nome"] for x in c.get("/pessoas/", headers=h_carlos).json()] == ["Pedro"]
    assert [x["nome"] for x in c.get("/modulos/", headers=h_carlos).json()] == []
    assert c.get("/lancamentos/", headers=h_carlos).json()["items"] == []

    # 5. Ataques cruzados (Carlos tentando ler/alterar/deletar recursos da Ana -> 404)
    assert c.delete(f"/contas/{conta_ana['id']}", headers=h_carlos).status_code == 404
    assert c.delete(f"/cartoes/{cartao_ana['id']}", headers=h_carlos).status_code == 404
    assert c.get(f"/pessoas/{pessoa_ana['id']}/extrato", headers=h_carlos).status_code == 404
    assert c.get(f"/pessoas/{pessoa_ana['id']}/pdf/{date.today().month}/{date.today().year}", headers=h_carlos).status_code == 404
    assert c.delete(f"/lancamentos/{lanc_ana.json()['id']}", headers=h_carlos).status_code == 404

    # Carlos tentando lançar compra usando cartão ou pessoa da Ana -> rejeitado (400/404)
    cross_lanc = c.post(
        "/lancamentos/",
        json={
            "descricao": "Tentativa Indevida",
            "valor_total": 100.0,
            "tipo": "compra_cartao",
            "data_lancamento": hoje,
            "cartao_id": cartao_ana["id"],
            "pessoa_id": pessoa_carlos["id"],
            "total_parcelas": 1,
        },
        headers=h_carlos,
    )
    assert cross_lanc.status_code in (400, 404)

    # 6. Link público `/public/lancar/:token` expõe apenas cartões da Ana e `gestor_nome`
    tok_marina = pessoa_ana["token_acesso"]
    pub_info = c.get(f"/public/lancar/{tok_marina}")
    assert pub_info.status_code == 200
    assert pub_info.json()["gestor_nome"] == "Ana Silva"
    assert [ct["nome"] for ct in pub_info.json()["cartoes"]] == ["Nubank Ana"]
    assert c.get("/public/lancar/token_inexistente_123").status_code == 404

    # Marina envia compra com comprovante pelo celular
    tiny_png = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xcf\xc0"
        b"\x00\x00\x03\x01\x01\x00\xc9\xfe\x92\xef\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    sub_res = c.post(
        f"/public/lancar/{tok_marina}",
        data={
            "descricao": "Farmacia Noturna",
            "valor": "89.90",
            "tipo_solicitacao": "compra_cartao",
            "cartao_id": str(cartao_ana["id"]),
            "total_parcelas": "1",
            "data_compra": hoje,
        },
        files={"comprovante": ("cupom.png", io.BytesIO(tiny_png), "image/png")},
    )
    assert sub_res.status_code == 200

    # Carlos não vê pendência; Ana vê 1 pendência
    assert c.get("/solicitacoes/pendentes/count", headers=h_carlos).json()["pendentes"] == 0
    cnt_ana = c.get("/solicitacoes/pendentes/count", headers=h_ana).json()
    assert cnt_ana["pendentes"] == 1 and cnt_ana["count"] == 1

    pend_list = c.get("/solicitacoes/", params={"status": "pendente"}, headers=h_ana).json()
    assert len(pend_list) == 1
    sol_id = pend_list[0]["id"]
    assert pend_list[0]["comprovante_url"].startswith("/uploads/")

    # Aprova classificando no módulo da Ana
    ap_res = c.post(
        f"/solicitacoes/{sol_id}/aprovar",
        json={"modulo_id": modulo_ana["id"], "cartao_id": cartao_ana["id"]},
        headers=h_ana,
    )
    assert ap_res.status_code == 200
    ap_list = c.get("/solicitacoes/", params={"status": "aprovada"}, headers=h_ana).json()
    assert len(ap_list) == 1 and ap_list[0]["status"] == "aprovada"

    # Envia segunda solicitação e recusa com motivo via JSON
    sub2 = c.post(
        f"/public/lancar/{tok_marina}",
        data={"descricao": "Duplicada", "valor": "50.00", "tipo_solicitacao": "compra_para_mim"},
    )
    assert sub2.status_code == 200
    sol2_id = sub2.json().get("solicitacao_id") or sub2.json().get("id")
    assert sol2_id
    rej_res = c.post(f"/solicitacoes/{sol2_id}/rejeitar", json={"motivo": "Lancado em duplicidade"}, headers=h_ana)
    assert rej_res.status_code == 200
    rej_list = c.get("/solicitacoes/", params={"status": "rejeitada"}, headers=h_ana).json()
    assert len(rej_list) == 1 and rej_list[0]["motivo_rejeicao"] == "Lancado em duplicidade"

    # PDF público de fechamento responde %PDF válido
    pdf_pub = c.get(f"/public/fechamento/{tok_marina}/{date.today().month}/{date.today().year}/pdf")
    assert pdf_pub.status_code == 200
    assert pdf_pub.content.startswith(b"%PDF")


def test_encrypted_vault_roundtrip_hydrate_and_cold_boot_merge(tmp_path: Path):
    key_b64 = base64.urlsafe_b64encode(os.urandom(32)).decode("ascii").rstrip("=")
    key = decode_vault_aes_key(key_b64)
    plain = b"SQLite format 3\x00dados_ultra_sensiveis"
    enc = encrypt_vault_blob(plain, key)
    assert plain not in enc
    assert decrypt_vault_blob(enc, key) == plain

    # Adulteração de chave ou byte cifrado deve falhar na autenticação GCM
    wrong_key = os.urandom(32)
    with pytest.raises(InvalidTag):
        decrypt_vault_blob(enc, wrong_key)
    tampered = bytearray(enc)
    tampered[-1] ^= 0xFF
    with pytest.raises(InvalidTag):
        decrypt_vault_blob(bytes(tampered), key)

    fake_gh = FakeGitHubVaultAPI()
    secret = "segredo_teste_hidratacao_24h"

    # 1. Container #1 popula dados de Luiz + comprovante e sincroniza no Cofre Criptografado
    n1 = _make_isolated_node(tmp_path, "render_gen1", vault_http=fake_gh.transport, hydrate_secret=secret)
    c1 = n1["client"]
    r_luiz = c1.post("/auth/register", json={"nome": "Francisco Luiz", "usuario": "luiz", "senha": "senha_luiz"})
    h_luiz = {"Authorization": f"Bearer {r_luiz.json()['access_token']}"}
    c1.post("/cartoes/", json={"nome": "Cartao Luiz", "bandeira": "Visa", "limite": 10000, "dia_fechamento": 8, "dia_vencimento": 15}, headers=h_luiz)
    (n1["uploads_dir"] / "comprovante_luiz.jpg").write_bytes(b"JPEG_BYTES_LUIZ")

    # Assinatura incorreta no hydrate -> 403
    bad_hyd = c1.post(
        "/cloud/vault/hydrate",
        json={
            "hydrate_secret": "errado",
            "github_token": "ghp_fake",
            "repo": "owner/private-vault",
            "aes_key": key_b64,
        },
    )
    assert bad_hyd.status_code == 403

    ok_hyd1 = c1.post(
        "/cloud/vault/hydrate",
        json={
            "hydrate_secret": secret,
            "github_token": "ghp_fake",
            "repo": "owner/private-vault",
            "aes_key": key_b64,
        },
    )
    assert ok_hyd1.status_code == 200
    assert ok_hyd1.json()["vault_connected"] is True

    # Verifica que nada no fake GitHub está em texto claro
    for blob_bytes in fake_gh.blobs.values():
        assert b"Francisco Luiz" not in blob_bytes
        assert b"JPEG_BYTES_LUIZ" not in blob_bytes

    # 2. Simula cold-boot no Render: novo container nasce vazio e recebe cadastro mobile ANTES do hydrate
    n2 = _make_isolated_node(tmp_path, "render_gen2", vault_http=fake_gh.transport, hydrate_secret=secret)
    c2 = n2["client"]
    r_mob = c2.post("/auth/register", json={"nome": "Cliente Celular", "usuario": "celular1", "senha": "1234"})
    h_mob = {"Authorization": f"Bearer {r_mob.json()['access_token']}"}
    c2.post("/cartoes/", json={"nome": "Cartao Celular", "bandeira": "Elo", "limite": 3000, "dia_fechamento": 5, "dia_vencimento": 12}, headers=h_mob)

    # GitHub Actions dispara /cloud/vault/hydrate -> restaura Luiz + preserva Cliente Celular!
    ok_hyd2 = c2.post(
        "/cloud/vault/hydrate",
        json={
            "hydrate_secret": secret,
            "github_token": "ghp_fake",
            "repo": "owner/private-vault",
            "aes_key": key_b64,
        },
    )
    assert ok_hyd2.status_code == 200
    assert (n2["uploads_dir"] / "comprovante_luiz.jpg").read_bytes() == b"JPEG_BYTES_LUIZ"

    # Ambos os usuários fazem login e veem seus respectivos cartões intactos!
    login_luiz = c2.post("/auth/login", json={"usuario": "luiz", "senha": "senha_luiz"})
    assert login_luiz.status_code == 200
    assert [x["nome"] for x in c2.get("/cartoes/", headers={"Authorization": f"Bearer {login_luiz.json()['access_token']}"}).json()] == ["Cartao Luiz"]

    login_mob = c2.post("/auth/login", json={"usuario": "celular1", "senha": "1234"})
    assert login_mob.status_code == 200
    assert [x["nome"] for x in c2.get("/cartoes/", headers={"Authorization": f"Bearer {login_mob.json()['access_token']}"}).json()] == ["Cartao Celular"]


def test_bidirectional_pc_mobile_hub_sync_and_offline_outbox_replay(tmp_path: Path):
    hub = _make_isolated_node(tmp_path, "cloud_hub", desktop_mode=False)
    hub_c = hub["client"]

    network_state = {"online": True}

    def hub_http_bridge(
        method: str,
        url: str,
        headers: dict[str, str] | None = None,
        data: bytes | None = None,
        timeout: float = 12.0,
    ) -> tuple[int, dict[str, str], bytes]:
        if not network_state["online"]:
            raise OSError("Rede desconectada (modo aviao)")
        parsed = urlsplit(url)
        pq = f"{parsed.path}?{parsed.query}" if parsed.query else parsed.path
        resp = hub_c.request(method, pq, headers=headers or {}, content=data)
        return resp.status_code, dict(resp.headers), resp.content

    pc1 = _make_isolated_node(tmp_path, "pc_1", desktop_mode=True, hub_transport=hub_http_bridge)
    pc2 = _make_isolated_node(tmp_path, "pc_2", desktop_mode=True, hub_transport=hub_http_bridge)
    c_pc1 = pc1["client"]
    c_pc2 = pc2["client"]

    # 1. Cadastro feito no Celular (Hub) funciona imediatamente no PC #1 sem configuração extra
    reg_mob = hub_c.post("/auth/register", json={"nome": "Julia Mobile", "usuario": "julia", "senha": "abcd12"})
    assert reg_mob.status_code == 200
    h_julia_mob = {"Authorization": f"Bearer {reg_mob.json()['access_token']}"}
    hub_c.post("/cartoes/", json={"nome": "C6 Julia", "bandeira": "Mastercard", "limite": 6000, "dia_fechamento": 9, "dia_vencimento": 16}, headers=h_julia_mob)

    # PC #1 novo (banco vazio) consulta check-setup -> True (vem do Hub) e faz login com 'julia'
    assert c_pc1.get("/auth/check-setup").json()["configured"] is True
    log_julia_pc1 = c_pc1.post("/auth/login", json={"usuario": "julia", "senha": "abcd12"})
    assert log_julia_pc1.status_code == 200
    h_julia_pc1 = {"Authorization": f"Bearer {log_julia_pc1.json()['access_token']}"}
    assert [x["nome"] for x in c_pc1.get("/cartoes/", headers=h_julia_pc1).json()] == ["C6 Julia"]

    # 2. Cadastro feito no PC #1 ('bruno') funciona imediatamente no Celular (Hub) e no PC #2
    reg_bruno = c_pc1.post("/auth/register", json={"nome": "Bruno Desktop", "usuario": "bruno", "senha": "998877"})
    assert reg_bruno.status_code == 200
    h_bruno_pc1 = {"Authorization": f"Bearer {reg_bruno.json()['access_token']}"}

    log_bruno_mob = hub_c.post("/auth/login", json={"usuario": "bruno", "senha": "998877"})
    assert log_bruno_mob.status_code == 200
    h_bruno_mob = {"Authorization": f"Bearer {log_bruno_mob.json()['access_token']}"}

    log_bruno_pc2 = c_pc2.post("/auth/login", json={"usuario": "bruno", "senha": "998877"})
    assert log_bruno_pc2.status_code == 200
    h_bruno_pc2 = {"Authorization": f"Bearer {log_bruno_pc2.json()['access_token']}"}

    # 3. Bruno cria cartão + pessoa no PC #1 -> Camila envia gasto com foto pelo link público no Celular
    card_bruno = c_pc1.post(
        "/cartoes/",
        json={"nome": "Santander Bruno", "bandeira": "Visa", "limite": 12000, "dia_fechamento": 15, "dia_vencimento": 22},
        headers=h_bruno_pc1,
    ).json()
    camila = c_pc1.post("/pessoas/", json={"nome": "Camila", "telefone": "11977776666"}, headers=h_bruno_pc1).json()

    tiny_png = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xcf\xc0"
        b"\x00\x00\x03\x01\x01\x00\xc9\xfe\x92\xef\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    pub_sub = hub_c.post(
        f"/public/lancar/{camila['token_acesso']}",
        data={
            "descricao": "Supermercado Camila",
            "valor": "240.00",
            "tipo_solicitacao": "compra_cartao",
            "cartao_id": str(card_bruno["id"]),
            "total_parcelas": "2",
            "data_compra": date.today().isoformat(),
        },
        files={"comprovante": ("nota_camila.png", io.BytesIO(tiny_png), "image/png")},
    )
    assert pub_sub.status_code == 200

    # PC #1 vê imediatamente a solicitação pendente e baixa o comprovante automaticamente
    assert c_pc1.get("/solicitacoes/pendentes/count", headers=h_bruno_pc1).json()["pendentes"] == 1
    pend_pc1 = c_pc1.get("/solicitacoes/", params={"status": "pendente"}, headers=h_bruno_pc1).json()
    assert len(pend_pc1) == 1
    fname = pend_pc1[0]["comprovante_url"].removeprefix("/uploads/")
    assert (pc1["uploads_dir"] / fname).is_file()

    # Bruno aprova no PC #1 -> reflete no Celular (Hub) e no PC #2
    assert c_pc1.post(f"/solicitacoes/{pend_pc1[0]['id']}/aprovar", json={}, headers=h_bruno_pc1).status_code == 200
    assert hub_c.get("/solicitacoes/pendentes/count", headers=h_bruno_mob).json()["pendentes"] == 0
    assert len(hub_c.get("/lancamentos/", headers=h_bruno_mob).json()["items"]) == 1
    assert len(c_pc2.get("/lancamentos/", headers=h_bruno_pc2).json()["items"]) == 1

    # 4. Resiliência Offline no PC #1 + Replay Automático com remapeamento de ID
    # Primeiro, celular cria um cartão online (para deslocar a sequência de IDs no Hub!)
    hub_c.post(
        "/cartoes/",
        json={"nome": "Cartao Criado no Celular", "bandeira": "Elo", "limite": 4000, "dia_fechamento": 1, "dia_vencimento": 8},
        headers=h_bruno_mob,
    )

    # Corta a internet do PC #1
    network_state["online"] = False
    off_card = c_pc1.post(
        "/cartoes/",
        json={"nome": "Cartao Offline PC1", "bandeira": "Mastercard", "limite": 3500, "dia_fechamento": 10, "dia_vencimento": 18},
        headers=h_bruno_pc1,
    )
    assert off_card.status_code == 200
    off_lanc = c_pc1.post(
        "/lancamentos/",
        json={
            "descricao": "Compra Feita Sem Internet",
            "valor_total": 150.0,
            "tipo": "compra_cartao",
            "data_lancamento": date.today().isoformat(),
            "cartao_id": off_card.json()["id"],
            "pessoa_id": camila["id"],
            "total_parcelas": 1,
        },
        headers=h_bruno_pc1,
    )
    assert off_lanc.status_code == 200
    assert len(pc1["hub_client"]._load_outbox()) == 2

    # Reconecta a internet -> próxima leitura sincroniza outbox, remapeia FK e converge PC #1, Hub e PC #2!
    network_state["online"] = True
    import time as _t
    _t.sleep(0.08)

    lancs_pc1 = c_pc1.get("/lancamentos/", headers=h_bruno_pc1).json()["items"]
    lancs_mob = hub_c.get("/lancamentos/", headers=h_bruno_mob).json()["items"]
    lancs_pc2 = c_pc2.get("/lancamentos/", headers=h_bruno_pc2).json()["items"]

    assert pc1["hub_client"]._load_outbox() == []
    descs_mob = {x["descricao"] for x in lancs_mob}
    assert "Compra Feita Sem Internet" in descs_mob
    assert "Supermercado Camila" in descs_mob
    assert {x["descricao"] for x in lancs_pc1} == descs_mob
    assert {x["descricao"] for x in lancs_pc2} == descs_mob


def test_cloud_backup_zip_and_admin_endpoints_strictly_isolated_per_user(tmp_path: Path):
    import zipfile

    key_b64 = base64.urlsafe_b64encode(os.urandom(32)).decode("ascii").rstrip("=")
    fake_gh = FakeGitHubVaultAPI()
    secret = "segredo_isolamento_cloud"

    node = _make_isolated_node(tmp_path, "cloud_iso", vault_http=fake_gh.transport, hydrate_secret=secret)
    c = node["client"]

    # 1. Proprietário primário (id=1) cria dados sensíveis e hidrata o cofre global
    r_owner = c.post("/auth/register", json={"nome": "Luiz Titular", "usuario": "luiz_owner", "senha": "owner_secret_password"})
    assert r_owner.status_code == 200
    h_owner = {"Authorization": f"Bearer {r_owner.json()['access_token']}"}
    c.post(
        "/cartoes/",
        json={"nome": "Black Secreto Luiz", "bandeira": "Mastercard", "limite": 50000, "dia_fechamento": 10, "dia_vencimento": 17},
        headers=h_owner,
    )
    p_owner = c.post("/pessoas/", json={"nome": "Familiar Luiz", "telefone": "11911112222"}, headers=h_owner).json()

    tiny_png = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xcf\xc0"
        b"\x00\x00\x03\x01\x01\x00\xc9\xfe\x92\xef\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    up_owner = c.post(
        f"/pessoas/{p_owner['id']}/foto",
        files={"file": ("owner.png", io.BytesIO(tiny_png), "image/png")},
        headers=h_owner,
    )
    assert up_owner.status_code == 200
    owner_foto_name = Path(up_owner.json()["foto_path"]).name

    assert c.post(
        "/cloud/vault/hydrate",
        json={"hydrate_secret": secret, "github_token": "ghp_x", "repo": "owner/secret-vault-repo", "aes_key": key_b64},
    ).status_code == 200

    # 2. Segundo perfil independente se registra
    r_sec = c.post("/auth/register", json={"nome": "Maria Isolada", "usuario": "maria_sec", "senha": "maria_password"})
    assert r_sec.status_code == 200
    h_sec = {"Authorization": f"Bearer {r_sec.json()['access_token']}"}
    c.post(
        "/cartoes/",
        json={"nome": "Cartao Maria", "bandeira": "Visa", "limite": 3000, "dia_fechamento": 5, "dia_vencimento": 12},
        headers=h_sec,
    )
    p_sec = c.post("/pessoas/", json={"nome": "Cliente Maria", "telefone": "11933334444"}, headers=h_sec).json()
    up_sec = c.post(
        f"/pessoas/{p_sec['id']}/foto",
        files={"file": ("maria.png", io.BytesIO(tiny_png), "image/png")},
        headers=h_sec,
    )
    assert up_sec.status_code == 200
    maria_foto_name = Path(up_sec.json()["foto_path"]).name

    # 3. Maria NÃO pode desconectar, sobrescrever, restaurar ou exportar credenciais globais
    assert c.delete("/cloud/disconnect", headers=h_sec).status_code == 403
    assert c.post("/cloud/restore", json={"force": True}, headers=h_sec).status_code == 403
    assert c.get("/cloud/export-token", headers=h_sec).status_code == 403
    assert c.post("/cloud/token", json={"token": "invalido"}, headers=h_sec).status_code == 403
    assert c.post("/cloud/configure-client", json={"auto_sync_enabled": False}, headers=h_sec).status_code == 403
    assert c.post("/cloud/oauth/authorize", headers=h_sec).status_code == 403

    # 4. Status de Maria oculta repositório/conta do proprietário e exibe apenas contadores de Maria
    st_sec = c.get("/cloud/status", headers=h_sec).json()
    assert st_sec["connected"] is True
    assert st_sec["is_primary_owner"] is False
    assert "secret-vault-repo" not in st_sec["account"]
    assert st_sec["folder_url"] == ""
    assert st_sec["counts"]["usuarios"] == 1
    assert st_sec["counts"]["cartoes"] == 1

    st_owner = c.get("/cloud/status", headers=h_owner).json()
    assert st_owner["is_primary_owner"] is True
    assert "secret-vault-repo" in st_owner["account"]

    # 5. Backup ZIP de Maria contém EXCLUSIVAMENTE os dados e uploads de Maria (com VACUUM sem resíduos)
    zip_res = c.get("/cloud/backup-zip", headers=h_sec)
    assert zip_res.status_code == 200
    with zipfile.ZipFile(io.BytesIO(zip_res.content), "r") as zf:
        names = set(zf.namelist())
        assert f"uploads/{maria_foto_name}" in names
        assert f"uploads/{owner_foto_name}" not in names

        db_bytes = zf.read("financeiro.db")
        assert b"Black Secreto Luiz" not in db_bytes
        assert b"luiz_owner" not in db_bytes

        extracted_db = tmp_path / "maria_only.db"
        extracted_db.write_bytes(db_bytes)
        conn = sqlite3.connect(str(extracted_db))
        try:
            users = conn.execute("SELECT email FROM usuarios").fetchall()
            cards = conn.execute("SELECT nome FROM cartoes").fetchall()
            assert users == [("maria_sec",)]
            assert cards == [("Cartao Maria",)]
        finally:
            conn.close()

    node["cloud_mgr"].shutdown()


def test_hub_sync_multiuser_pk_collision_and_outbox_4xx_healing(tmp_path: Path):
    import time as _t

    hub = _make_isolated_node(tmp_path, "hub_pk", desktop_mode=False)
    hub_c = hub["client"]

    network_state = {"online": False}

    def hub_bridge(
        method: str,
        url: str,
        headers: dict[str, str] | None = None,
        data: bytes | None = None,
        timeout: float = 12.0,
    ) -> tuple[int, dict[str, str], bytes]:
        if not network_state["online"]:
            raise OSError("Sem internet")
        parsed = urlsplit(url)
        pq = f"{parsed.path}?{parsed.query}" if parsed.query else parsed.path
        resp = hub_c.request(method, pq, headers=headers or {}, content=data)
        return resp.status_code, dict(resp.headers), resp.content

    pc_shared = _make_isolated_node(tmp_path, "pc_shared", desktop_mode=True, hub_transport=hub_bridge)
    c_pc = pc_shared["client"]

    # 1. PC compartilhado começa OFFLINE: Alice cria perfil local + cartão (id=1) + módulo + subcategoria + lançamento
    r_alice_off = c_pc.post("/auth/setup", json={"nome": "Alice Offline", "usuario": "alice", "senha": "alice123"})
    assert r_alice_off.status_code == 200
    h_alice_pc = {"Authorization": f"Bearer {r_alice_off.json()['access_token']}"}

    alice_card = c_pc.post(
        "/cartoes/",
        json={"nome": "Cartao Offline Alice", "bandeira": "Visa", "limite": 4000, "dia_fechamento": 8, "dia_vencimento": 15},
        headers=h_alice_pc,
    ).json()
    assert alice_card["id"] == 1

    alice_mod = c_pc.post("/modulos/", json={"nome": "Estudos Alice", "cor": "#3B82F6"}, headers=h_alice_pc).json()
    alice_sub = c_pc.post(
        "/modulos/subcategorias",
        json={"nome": "Livros Tecnicos", "modulo_id": alice_mod["id"]},
        headers=h_alice_pc,
    ).json()
    alice_lanc = c_pc.post(
        "/lancamentos/",
        json={
            "descricao": "Curso Python Offline",
            "valor_total": 420.0,
            "tipo": "compra_cartao",
            "data_lancamento": date.today().isoformat(),
            "cartao_id": alice_card["id"],
            "modulo_id": alice_mod["id"],
            "subcategoria_id": alice_sub["id"],
            "total_parcelas": 2,
        },
        headers=h_alice_pc,
    )
    assert alice_lanc.status_code == 200

    # 2. No Hub em nuvem, Roberto cria o primeiro perfil online -> seu cartão canônico TAMBÉM recebe id=1!
    r_rob_hub = hub_c.post("/auth/register", json={"nome": "Roberto Online", "usuario": "roberto", "senha": "rob123"})
    assert r_rob_hub.status_code == 200
    h_rob_hub = {"Authorization": f"Bearer {r_rob_hub.json()['access_token']}"}
    rob_card_hub = hub_c.post(
        "/cartoes/",
        json={"nome": "Nubank Roberto Canonico", "bandeira": "Mastercard", "limite": 9000, "dia_fechamento": 10, "dia_vencimento": 17},
        headers=h_rob_hub,
    ).json()
    assert rob_card_hub["id"] == 1

    # 3. Internet volta no PC compartilhado e ROBERTO entra PRIMEIRO (antes de Alice sincronizar!)
    network_state["online"] = True
    _t.sleep(0.08)

    log_rob_pc = c_pc.post("/auth/login", json={"usuario": "roberto", "senha": "rob123"})
    assert log_rob_pc.status_code == 200
    h_rob_pc = {"Authorization": f"Bearer {log_rob_pc.json()['access_token']}"}

    rob_cards_pc = c_pc.get("/cartoes/", headers=h_rob_pc).json()
    assert len(rob_cards_pc) == 1
    # ID canônico 1 do Hub foi preservado 1:1 para Roberto!
    assert rob_cards_pc[0]["id"] == 1
    assert rob_cards_pc[0]["nome"] == "Nubank Roberto Canonico"

    # Roberto edita seu cartão id=1 e lança compra nele pelo PC -> funciona sem 404/400 no Hub!
    upd_rob = c_pc.put(
        "/cartoes/1",
        json={"nome": "Nubank Roberto Editado PC", "bandeira": "Mastercard", "limite": 11000, "dia_fechamento": 10, "dia_vencimento": 17},
        headers=h_rob_pc,
    )
    assert upd_rob.status_code == 200
    lanc_rob = c_pc.post(
        "/lancamentos/",
        json={
            "descricao": "Jantar Roberto PC",
            "valor_total": 180.0,
            "tipo": "compra_cartao",
            "data_lancamento": date.today().isoformat(),
            "cartao_id": 1,
            "total_parcelas": 1,
        },
        headers=h_rob_pc,
    )
    assert lanc_rob.status_code == 200
    assert hub_c.get("/cartoes/", headers=h_rob_hub).json()[0]["nome"] == "Nubank Roberto Editado PC"

    # 4. Agora ALICE acessa o PC -> auto-provisiona no Hub e faz replay limpo dos itens realocados (cartão + módulo + subcategoria + lançamento)!
    log_alice_pc = c_pc.post("/auth/login", json={"usuario": "alice", "senha": "alice123"})
    assert log_alice_pc.status_code == 200
    h_alice_pc2 = {"Authorization": f"Bearer {log_alice_pc.json()['access_token']}"}
    assert pc_shared["hub_client"]._load_outbox() == []

    log_alice_hub = hub_c.post("/auth/login", json={"usuario": "alice", "senha": "alice123"})
    assert log_alice_hub.status_code == 200
    h_alice_hub = {"Authorization": f"Bearer {log_alice_hub.json()['access_token']}"}
    alice_lancs_hub = hub_c.get("/lancamentos/", headers=h_alice_hub).json()["items"]
    assert [x["descricao"] for x in alice_lancs_hub] == ["Curso Python Offline"]
    assert [x["descricao"] for x in c_pc.get("/lancamentos/", headers=h_alice_pc2).json()["items"]] == ["Curso Python Offline"]

    # 5. Se um item offline obsoleto retornar 404 no Hub, o PC drena a fila e cura o SQLite local via snapshot!
    conn = sqlite3.connect(str(pc_shared["db_path"]))
    try:
        with conn:
            conn.execute("DELETE FROM cartoes WHERE nome = 'Cartao Offline Alice'")
    finally:
        conn.close()
    pc_shared["hub_client"].enqueue_offline_mutation(
        usuario="alice",
        method="DELETE",
        path="/cartoes/999999",
        query="",
        content_type="application/json",
        raw_body=b"",
    )
    healed_cards = c_pc.get("/cartoes/", headers=h_alice_pc2).json()
    assert [x["nome"] for x in healed_cards] == ["Cartao Offline Alice"]
    assert pc_shared["hub_client"]._load_outbox() == []


def test_pdf_fechamento_escapes_xml_special_characters(tmp_path: Path):
    node = _make_isolated_node(tmp_path, "pdf_xml")
    c = node["client"]

    reg = c.post(
        "/auth/register",
        json={"nome": "Lucas & Ana <Gestão>", "usuario": "lucas_xml", "senha": "123456"},
    )
    assert reg.status_code == 200
    hdrs = {"Authorization": f"Bearer {reg.json()['access_token']}"}

    card = c.post(
        "/cartoes/",
        json={"nome": "C&A <Gold>", "bandeira": "Visa", "limite": 5000, "dia_fechamento": 10, "dia_vencimento": 17},
        headers=hdrs,
    ).json()
    pes = c.post(
        "/pessoas/",
        json={"nome": "João & Maria <Filhos>", "telefone": "(11) 99999-0000 & WhatsApp"},
        headers=hdrs,
    ).json()
    hoje = date.today()
    lanc = c.post(
        "/lancamentos/",
        json={
            "descricao": "Roupas C&A & H&M <Promoção>",
            "valor_total": 350.0,
            "tipo": "compra_cartao",
            "data_lancamento": hoje.isoformat(),
            "cartao_id": card["id"],
            "pessoa_id": pes["id"],
            "total_parcelas": 3,
        },
        headers=hdrs,
    )
    assert lanc.status_code == 200

    pdf_auth = c.get(f"/pessoas/{pes['id']}/pdf/{hoje.month}/{hoje.year}", headers=hdrs)
    assert pdf_auth.status_code == 200
    assert pdf_auth.content.startswith(b"%PDF")

    pdf_pub = c.get(f"/public/fechamento/{pes['token_acesso']}/{hoje.month}/{hoje.year}/pdf")
    assert pdf_pub.status_code == 200
    assert pdf_pub.content.startswith(b"%PDF")
