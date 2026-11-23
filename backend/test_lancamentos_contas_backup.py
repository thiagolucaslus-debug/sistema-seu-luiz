from __future__ import annotations

import io
import json
import os
import sqlite3
import sys
import zipfile
from datetime import date
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import auth as auth_module
import models
from routers import auth as auth_router
from routers import cartoes, cloud, contas, lancamentos, modulos, pessoas, relatorios, sync_hub
from services.cloud_sync import CloudSyncManager
from services.hub_sync import HubSyncClient
from tenancy import USER_OWNED_TABLES


def _build_test_app(tmp_path: Path, *, is_cloud_container: bool = False) -> dict[str, Any]:
    data_dir = tmp_path / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    uploads_dir = data_dir / "uploads"
    uploads_dir.mkdir(exist_ok=True)
    db_path = data_dir / "financeiro.db"

    eng = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False, "timeout": 30},
    )
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=eng)
    models.Base.metadata.create_all(bind=eng)
    with eng.begin() as conn:
        cols_u = {r[1] for r in conn.execute(text("PRAGMA table_info(usuarios)"))}
        if "sync_rev" not in cols_u:
            conn.execute(text("ALTER TABLE usuarios ADD COLUMN sync_rev INTEGER NOT NULL DEFAULT 1"))
        for tbl in USER_OWNED_TABLES:
            cols = {r[1] for r in conn.execute(text(f"PRAGMA table_info({tbl})"))}
            if "usuario_id" not in cols:
                conn.execute(text(f"ALTER TABLE {tbl} ADD COLUMN usuario_id INTEGER"))

    def override_get_db():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    cloud_mgr = CloudSyncManager(
        data_dir=data_dir,
        db_path=db_path,
        config_dir=data_dir / ".cloud_cfg",
        engine_disposer=eng.dispose,
    )
    cloud_mgr.is_cloud_container = is_cloud_container

    app = FastAPI()
    for router_mod in (auth_router, cartoes, contas, pessoas, modulos, lancamentos, relatorios, cloud, sync_hub):
        app.include_router(router_mod.router)

    import database as db_mod

    app.dependency_overrides[db_mod.get_db] = override_get_db
    app.dependency_overrides[cloud.get_cloud_manager] = lambda: cloud_mgr

    prev_mgr = cloud._manager_instance
    cloud.set_cloud_manager(cloud_mgr)

    # Add mutation middleware matching backend/main.py
    @app.middleware("http")
    async def auto_save_mw(request, call_next):
        response = await call_next(request)
        if request.method in ("POST", "PUT", "PATCH", "DELETE") and response.status_code < 400:
            path = request.url.path or ""
            if not path.startswith("/cloud/"):
                res = cloud_mgr.flush_after_mutation(reason=f"test:{request.method}:{path}", sync_cloud_blocking=False)
                response.headers["X-Auto-Saved"] = "1" if (res.get("local") or {}).get("ok") else "0"
        return response

    client = TestClient(app)

    def cleanup():
        cloud._manager_instance = prev_mgr
        eng.dispose()

    return {
        "client": client,
        "engine": eng,
        "SessionLocal": SessionLocal,
        "cloud_mgr": cloud_mgr,
        "data_dir": data_dir,
        "db_path": db_path,
        "uploads_dir": uploads_dir,
        "cleanup": cleanup,
    }


def _auth_headers(client: TestClient, username: str, senha: str, nome: str, is_first: bool = False) -> dict[str, str]:
    endpoint = "/auth/setup" if is_first else "/auth/register"
    res = client.post(endpoint, json={"nome": nome, "usuario": username, "senha": senha})
    assert res.status_code == 200, res.text
    token = res.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_lancamento_apos_fechamento_aparece_em_lancamentos_e_relatorios(tmp_path: Path):
    """Reproduz o bug exato do Francisco Luiz: compra dia 22 em cartão com fechamento dia 1."""
    env = _build_test_app(tmp_path)
    try:
        c = env["client"]
        headers = _auth_headers(c, "luiz", "senha123", "Francisco Luiz", is_first=True)

        # Cartão com fechamento dia 1 (igual OUTROS no perfil real)
        r_card = c.post(
            "/cartoes/",
            json={"nome": "OUTROS", "cor": "#2563eb", "dia_fechamento": 1, "dia_vencimento": 10},
            headers=headers,
        )
        assert r_card.status_code == 200
        cartao_id = r_card.json()["id"]

        # Compra em 22/11/2026 -> 1ª parcela entra na fatura 12/2026
        r_lanc = c.post(
            "/lancamentos/",
            json={
                "descricao": "Compra Teste Fechamento",
                "tipo": "compra_cartao",
                "valor_total": 500.0,
                "total_parcelas": 2,
                "data_lancamento": "2026-11-22",
                "cartao_id": cartao_id,
            },
            headers=headers,
        )
        assert r_lanc.status_code == 200
        body = r_lanc.json()
        assert body["mes_fatura"] == 12
        assert body["ano_fatura"] == 2026

        # 1) Deve aparecer em Lançamentos no mês da COMPRA (11/2026)!
        r_nov = c.get("/lancamentos/?mes=11&ano=2026", headers=headers)
        assert r_nov.status_code == 200
        nov_items = r_nov.json()["items"]
        assert any(i["descricao"] == "Compra Teste Fechamento" for i in nov_items)
        item_nov = next(i for i in nov_items if i["descricao"] == "Compra Teste Fechamento")
        assert item_nov["mes_fatura"] == 12
        assert item_nov["ano_fatura"] == 2026
        assert item_nov["fatura_inicial"] == "12/2026"

        # 2) Deve aparecer em Lançamentos no mês da FATURA (12/2026) e 01/2027!
        r_dez = c.get("/lancamentos/?mes=12&ano=2026", headers=headers)
        assert any(i["descricao"] == "Compra Teste Fechamento" for i in r_dez.json()["items"])
        r_jan = c.get("/lancamentos/?mes=1&ano=2027", headers=headers)
        assert any(i["descricao"] == "Compra Teste Fechamento" for i in r_jan.json()["items"])

        # 3) Deve aparecer em "Todos os meses" (mes=0)
        r_all = c.get("/lancamentos/?mes=0&ano=2026", headers=headers)
        assert any(i["descricao"] == "Compra Teste Fechamento" for i in r_all.json()["items"])

        # 4) Deve aparecer em Relatórios (parcelas futuras)
        r_rel = c.get("/relatorios/parcelas-futuras?meses=12", headers=headers)
        assert r_rel.status_code == 200
        all_rel_descs = [it["descricao"] for bloco in r_rel.json() for it in bloco["itens"]]
        assert "Compra Teste Fechamento" in all_rel_descs

        # 5) Validação de borda: valor <= 0 deve falhar com 400
        r_zero = c.post(
            "/lancamentos/",
            json={
                "descricao": "Valor Zero",
                "tipo": "compra_cartao",
                "valor_total": 0,
                "total_parcelas": 1,
                "data_lancamento": "2026-11-22",
                "cartao_id": cartao_id,
            },
            headers=headers,
        )
        assert r_zero.status_code == 400
    finally:
        env["cleanup"]()


def test_contas_movimentar_ajustar_e_consistencia_cruzada(tmp_path: Path):
    """Testa + Entrada, - Saída, Ajustar Saldo na conta e consistência em Extrato, Lançamentos, Fechamento, Dashboard e Módulos."""
    env = _build_test_app(tmp_path)
    try:
        c = env["client"]
        headers = _auth_headers(c, "luiz", "senha123", "Francisco Luiz", is_first=True)

        # Cria conta com saldo inicial 1000
        r_conta = c.post(
            "/contas/",
            json={"nome": "Itaú Corrente", "banco": "Itaú", "tipo": "corrente", "saldo_inicial": 1000.0},
            headers=headers,
        )
        assert r_conta.status_code == 200
        conta_id = r_conta.json()["id"]

        # Cria módulo
        r_mod = c.post("/modulos/", json={"nome": "Casa", "cor": "#10b981"}, headers=headers)
        assert r_mod.status_code == 200
        modulo_id = r_mod.json()["id"]

        hoje_str = date.today().isoformat()
        mes_atual = date.today().month
        ano_atual = date.today().year

        # 1) Adicionar valor / Entrada (+500)
        r_in = c.post(
            f"/contas/{conta_id}/movimentar",
            json={
                "tipo": "entrada",
                "valor": 500.0,
                "descricao": "Depósito Salário",
                "data_lancamento": hoje_str,
            },
            headers=headers,
        )
        assert r_in.status_code == 200, r_in.text
        assert r_in.json()["saldo_atual"] == 1500.0
        assert r_in.json()["tipo"] == "receita"

        # 2) Remover valor / Saída (-120) vinculada ao módulo Casa
        r_out = c.post(
            f"/contas/{conta_id}/movimentar",
            json={
                "tipo": "saida",
                "valor": 120.0,
                "descricao": "Conta de Energia",
                "data_lancamento": hoje_str,
                "modulo_id": modulo_id,
            },
            headers=headers,
        )
        assert r_out.status_code == 200, r_out.text
        assert r_out.json()["saldo_atual"] == 1380.0
        assert r_out.json()["tipo"] == "despesa_conta"
        saida_lanc_id = r_out.json()["lancamento_id"]

        # 3) Ajustar saldo para 1500 (cria entrada de +120)
        r_adj = c.post(
            f"/contas/{conta_id}/ajustar-saldo",
            json={"saldo_desejado": 1500.0, "descricao": "Acerto de saldo", "data_lancamento": hoje_str},
            headers=headers,
        )
        assert r_adj.status_code == 200, r_adj.text
        assert r_adj.json()["saldo_atual"] == 1500.0
        assert r_adj.json()["diferenca"] == 120.0

        # Verifica Lançamentos filtrando por conta_id
        r_lancs = c.get(f"/lancamentos/?mes={mes_atual}&ano={ano_atual}&conta_id={conta_id}", headers=headers)
        descs = [it["descricao"] for it in r_lancs.json()["items"]]
        assert "Depósito Salário" in descs
        assert "Conta de Energia" in descs
        assert "Acerto de saldo" in descs

        # Verifica Extrato da conta
        r_ext = c.get(f"/contas/{conta_id}/extrato", headers=headers)
        assert r_ext.status_code == 200
        assert r_ext.json()["conta"]["saldo_atual"] == 1500.0
        ext_descs = [m["descricao"] for m in r_ext.json()["movimentacoes"]]
        assert "Depósito Salário" in ext_descs
        assert "Conta de Energia" in ext_descs

        # Verifica Fechamento do Mês (antes era sempre 0,00 para contas!)
        r_fech = c.get(f"/relatorios/fechamento-mes?mes={mes_atual}&ano={ano_atual}", headers=headers)
        assert r_fech.status_code == 200
        fech = r_fech.json()
        assert fech["total_saidas_contas"] == 120.0
        assert fech["total_entradas_contas"] == 620.0
        conta_fech = next(x for x in fech["contas"] if x["id"] == conta_id)
        assert conta_fech["total_saidas"] == 120.0
        assert conta_fech["total_entradas"] == 620.0

        # Verifica Dashboard: receitas NÃO podem inflar evolucao_mensal nem parcelas_futuras!
        r_dash = c.get(f"/relatorios/dashboard?mes={mes_atual}&ano={ano_atual}", headers=headers)
        assert r_dash.status_code == 200
        dash = r_dash.json()
        assert dash["saldo_total_contas"] == 1500.0
        assert dash["total_receitas_mes"] == 620.0
        assert dash["total_despesas_contas_mes"] == 120.0
        # Evolução do mês atual só deve conter a despesa (120), NÃO os 620 de receita!
        evo_atual = next(e for e in dash["evolucao_mensal"] if e["mes"] == mes_atual and e["ano"] == ano_atual)
        assert evo_atual["total"] == 120.0

        # Relatórios parcelas futuras NÃO inclui receita!
        r_fut = c.get("/relatorios/parcelas-futuras?meses=6", headers=headers)
        fut_descs = [it["descricao"] for b in r_fut.json() for it in b["itens"]]
        assert "Depósito Salário" not in fut_descs
        assert "Acerto de saldo" not in fut_descs

        # Verifica Módulo antes e depois de cancelar a saída
        r_mods1 = c.get(f"/modulos/?mes={mes_atual}&ano={ano_atual}", headers=headers)
        mod_casa = next(m for m in r_mods1.json() if m["id"] == modulo_id)
        assert mod_casa["total_mes_atual"] == 120.0

        # Cancela a saída e confirma que módulos + saldo atualizam imediatamente
        r_del = c.delete(f"/lancamentos/{saida_lanc_id}", headers=headers)
        assert r_del.status_code == 200
        r_mods2 = c.get(f"/modulos/?mes={mes_atual}&ano={ano_atual}", headers=headers)
        mod_casa2 = next(m for m in r_mods2.json() if m["id"] == modulo_id)
        assert mod_casa2["total_mes_atual"] == 0.0

        # Validações de borda
        assert c.post(f"/contas/{conta_id}/movimentar", json={"tipo": "invalida", "valor": 10, "descricao": "X"}, headers=headers).status_code == 422
        assert c.post(f"/contas/{conta_id}/movimentar", json={"tipo": "entrada", "valor": 0, "descricao": "X"}, headers=headers).status_code == 422
    finally:
        env["cleanup"]()


def test_backup_automatico_local_multi_perfil_e_restore_isolado(tmp_path: Path):
    """Garante backup automático para TODOS os perfis, download .zip e restauração isolada sem afetar outro perfil."""
    env = _build_test_app(tmp_path)
    try:
        c = env["client"]
        headers_admin = _auth_headers(c, "admin", "senha123", "Administrador", is_first=True)
        headers_luiz = _auth_headers(c, "luiz", "senha123", "Francisco Luiz", is_first=False)

        # Admin cria 1 conta e 1 lançamento
        admin_conta = c.post(
            "/contas/",
            json={"nome": "Conta Admin", "banco": "Bradesco", "saldo_inicial": 300.0},
            headers=headers_admin,
        ).json()["id"]
        c.post(
            f"/contas/{admin_conta}/movimentar",
            json={"tipo": "entrada", "valor": 100.0, "descricao": "Entrada Admin Exclusiva"},
            headers=headers_admin,
        )

        # Francisco Luiz (perfil secundário!) cria conta, cartão, pessoa e lançamento
        luiz_conta = c.post(
            "/contas/",
            json={"nome": "Caixa Luiz", "banco": "Caixa", "saldo_inicial": 500.0},
            headers=headers_luiz,
        ).json()["id"]
        luiz_card = c.post("/cartoes/", json={"nome": "Itaú 7467", "dia_fechamento": 5, "dia_vencimento": 15}, headers=headers_luiz).json()["id"]
        luiz_pessoa = c.post("/pessoas/", json={"nome": "Maria"}, headers=headers_luiz).json()["id"]
        r_l = c.post(
            "/lancamentos/",
            json={
                "descricao": "Compra Luiz Importante",
                "tipo": "compra_cartao",
                "valor_total": 450.0,
                "total_parcelas": 3,
                "data_lancamento": "2026-11-22",
                "cartao_id": luiz_card,
                "pessoa_id": luiz_pessoa,
            },
            headers=headers_luiz,
        )
        assert r_l.status_code == 200
        assert r_l.headers.get("X-Auto-Saved") == "1"
        lanc_luiz_id = r_l.json()["id"]

        # Verifica arquivos automáticos criados em disco em backups_automaticos/
        bdir = env["data_dir"] / "backups_automaticos"
        assert (bdir / "ultimo_backup_automatico.db").exists()
        assert (bdir / "ultimo_backup_automatico.json").exists()
        assert (bdir / "perfis" / "luiz_backup.json").exists()
        assert (bdir / "perfis" / "admin_backup.json").exists()

        # SQLite íntegro no backup automático
        conn = sqlite3.connect(str(bdir / "ultimo_backup_automatico.db"))
        try:
            assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        finally:
            conn.close()

        # Perfil do Luiz no JSON automático contém a compra
        luiz_json = json.loads((bdir / "perfis" / "luiz_backup.json").read_text(encoding="utf-8"))
        assert any(l["descricao"] == "Compra Luiz Importante" for l in luiz_json["lancamentos"])

        # Botão Backup do topo: POST /cloud/backup-agora funciona para perfil secundário!
        r_now = c.post("/cloud/backup-agora", headers=headers_luiz)
        assert r_now.status_code == 200
        assert r_now.json()["ok"] is True
        assert r_now.json()["counts"]["lancamentos"] >= 1

        # Download ZIP do perfil do Luiz
        r_zip = c.get("/cloud/backup-zip", headers=headers_luiz)
        assert r_zip.status_code == 200
        zip_bytes = r_zip.content
        with zipfile.ZipFile(io.BytesIO(zip_bytes), "r") as zf:
            names = set(zf.namelist())
            assert "financeiro.db" in names
            assert "backup_dados.json" in names
            assert "manifest.json" in names
            snap_in_zip = json.loads(zf.read("backup_dados.json").decode("utf-8"))
            u_meta = snap_in_zip["usuario"]
            assert (u_meta.get("usuario") or u_meta.get("email")) == "luiz"
            assert any(l["descricao"] == "Compra Luiz Importante" for l in snap_in_zip["lancamentos"])
            # Não vaza dados do Admin no backup_dados.json do Luiz!
            assert not any(l["descricao"] == "Entrada Admin Exclusiva" for l in snap_in_zip["lancamentos"])

        # Simula perda de dados do Luiz (deleta lançamento)
        c.delete(f"/lancamentos/{lanc_luiz_id}", headers=headers_luiz)
        assert len(c.get("/lancamentos/?mes=0", headers=headers_luiz).json()["items"]) == 0

        # Restaura a partir do ZIP baixado!
        r_rest = c.post(
            "/cloud/restore-backup",
            files={"file": ("backup_luiz.zip", zip_bytes, "application/zip")},
            headers=headers_luiz,
        )
        assert r_rest.status_code == 200
        assert r_rest.json()["ok"] is True
        restored_items = c.get("/lancamentos/?mes=0", headers=headers_luiz).json()["items"]
        assert any(i["descricao"] == "Compra Luiz Importante" for i in restored_items)

        # Admin continua 100% intacto!
        admin_items = c.get("/lancamentos/?mes=0", headers=headers_admin).json()["items"]
        assert any(i["descricao"] == "Entrada Admin Exclusiva" for i in admin_items)

        # Também testa restauração via arquivo .json puro
        json_bytes = json.dumps(snap_in_zip, ensure_ascii=False).encode("utf-8")
        r_rest_json = c.post(
            "/cloud/restore-backup",
            files={"file": ("luiz_backup.json", json_bytes, "application/json")},
            headers=headers_luiz,
        )
        assert r_rest_json.status_code == 200
        assert any(
            i["descricao"] == "Compra Luiz Importante"
            for i in c.get("/lancamentos/?mes=0", headers=headers_luiz).json()["items"]
        )

        # Arquivo inválido retorna 400 sem corromper o banco
        r_bad = c.post(
            "/cloud/restore-backup",
            files={"file": ("corrompido.zip", b"not-a-zip", "application/zip")},
            headers=headers_luiz,
        )
        assert r_bad.status_code == 400
    finally:
        env["cleanup"]()


def test_cloud_sync_mantem_dirty_em_falha_e_espelha_gdrive(tmp_path: Path):
    """Garante que falha transitória no _vault_sync_now REAL mantém _dirty=True e que Vault + Google Drive rodam juntos."""
    env = _build_test_app(tmp_path)
    try:
        mgr: CloudSyncManager = env["cloud_mgr"]
        # Cria pelo menos 1 usuário no banco
        _auth_headers(env["client"], "luiz", "senha123", "Francisco Luiz", is_first=True)
        mgr.vault_credentials = {"repo": "owner/vault", "github_token": "tok", "aes_key": "k"}

        calls = {"vault_read": 0, "vault_commit": 0, "gdrive": 0}

        class _FakeVaultClient:
            repo_url = "https://github.com/owner/vault"

            def read_branch_state(self):
                calls["vault_read"] += 1
                if calls["vault_read"] == 1:
                    raise RuntimeError("Timeout transitório GitHub")
                return None

            def upload_encrypted(self, raw_bytes: bytes) -> str:
                return f"sha-{len(raw_bytes)}"

            def commit_tree(self, **kwargs):
                calls["vault_commit"] += 1
                return "commit-sha-1"

        def fake_gdrive_sync(*, force: bool = False, reason: str = "manual", mirror_mode: bool = False):
            calls["gdrive"] += 1
            assert mirror_mode is True
            mgr.meta["gdrive_db_sha256"] = "abc123"
            return {"ok": True, "action": "synced"}

        mgr._build_vault_client = lambda: _FakeVaultClient()  # type: ignore[method-assign]
        mgr._gdrive_sync_now = fake_gdrive_sync  # type: ignore[method-assign]

        # Marca mutação pendente (desabilitando thread de background para testar determinístico)
        mgr._shutdown = True
        mgr._dirty = True
        mgr._write_gen += 1

        # 1ª tentativa falha -> _dirty DEVE continuar True!
        with pytest.raises(RuntimeError):
            mgr.sync_now(force=False, reason="first_try")
        assert mgr._dirty is True
        assert mgr._last_error and "Timeout" in mgr._last_error

        # Conecta Google Drive simultaneamente ao Vault e tenta novamente
        mgr.credentials = {"refresh_token": "rt", "access_token": "at", "account_email": "luiz@gmail.com"}
        res = mgr.sync_now(force=False, reason="retry_try")
        assert res["ok"] is True
        assert res["action"] == "synced"
        assert res["gdrive_mirror"]["ok"] is True
        assert mgr._dirty is False
        assert mgr._last_error is None
        assert calls["vault_read"] == 2
        assert calls["vault_commit"] == 1
        assert calls["gdrive"] == 1
        assert mgr.status()["gdrive_connected"] is True
        assert mgr.status()["vault_connected"] is True
    finally:
        env["cleanup"]()


def test_protecoes_anti_wipe_nuvem_fria_e_hub_sync(tmp_path: Path, monkeypatch):
    """Bloqueia auto_provision em nuvem vazia não hidratada e impede HubSyncClient de regredir revisão local."""
    import time as _time

    env = _build_test_app(tmp_path, is_cloud_container=True)
    try:
        c = env["client"]
        ts = int(_time.time())
        sh = auth_module.hash_senha("senha123")
        proof = sync_hub.compute_sync_proof(sh, "luiz", ts)
        # 1) Nuvem em cold-start sem cofre conectado + 0 usuários -> /sync/session com auto_provision=True retorna 503
        r_prov = c.post(
            "/sync/session",
            json={
                "usuario": "luiz",
                "timestamp": ts,
                "proof": proof,
                "senha_hash": sh,
                "auto_provision": True,
                "nome": "Francisco Luiz",
            },
        )
        assert r_prov.status_code == 503

        # 2) /auth/check-setup em ambiente RENDER com 0 usuários e nuvem não conectada -> cloud_waking=True
        monkeypatch.setenv("RENDER", "true")
        r_setup = c.get("/auth/check-setup")
        assert r_setup.status_code == 200
        assert r_setup.json()["configured"] is True
        assert r_setup.json()["cloud_waking"] is True

        # 3) HubSyncClient NÃO baixa snapshot se remote_rev < local_rev
        pulled = {"called": False}

        def fake_http(method, url, headers=None, data=None, timeout=10.0):
            if url.endswith("/sync/version"):
                return 200, {}, json.dumps({"sync_rev": 1, "cloud_connected": False}).encode("utf-8")
            raise AssertionError(f"Unexpected HTTP call: {method} {url}")

        hub_client = HubSyncClient(
            hub_url="https://example.invalid",
            data_dir=env["data_dir"],
            db_path=env["db_path"],
            http_transport=fake_http,
            enabled=True,
            version_poll_interval_sec=0.0,
        )
        # Cria usuário local com sync_rev=50
        db = env["SessionLocal"]()
        try:
            u = models.Usuario(
                nome="Luiz",
                email="luiz",
                senha_hash=sh,
                sync_rev=50,
            )
            db.add(u)
            db.commit()
            db.refresh(u)
        finally:
            db.close()

        def fake_pull(hub_token):
            pulled["called"] = True
            return True

        hub_client.pull_user_snapshot = fake_pull  # type: ignore[method-assign]
        hub_client._sessions["luiz"] = "tok"

        # Poll com remote_rev=1 < local_rev=50 NÃO pode sobrescrever dados locais!
        local_user = hub_client.get_local_user_by_email("luiz")
        assert local_user is not None
        hub_client.sync_user_if_needed(local_user)
        assert pulled["called"] is False
    finally:
        env["cleanup"]()


def test_modulos_exclui_receita_e_transferencia_alinhado_ao_dashboard(tmp_path: Path):
    """Receitas e transferências vinculadas a um módulo NÃO podem inflar gastos de /modulos/ nem divergir do Dashboard."""
    env = _build_test_app(tmp_path)
    try:
        c = env["client"]
        headers = _auth_headers(c, "luiz", "senha123", "Francisco Luiz", is_first=True)
        c1 = c.post("/contas/", json={"nome": "Itaú", "banco": "Itaú", "saldo_inicial": 1000.0}, headers=headers).json()["id"]
        c2 = c.post("/contas/", json={"nome": "BB", "banco": "BB", "saldo_inicial": 0.0}, headers=headers).json()["id"]
        mid = c.post("/modulos/", json={"nome": "Casa", "cor": "#10b981"}, headers=headers).json()["id"]

        assert c.post(
            f"/contas/{c1}/movimentar",
            json={"tipo": "entrada", "valor": 500.0, "descricao": "Depósito Casa", "modulo_id": mid, "data_lancamento": "2026-11-22"},
            headers=headers,
        ).status_code == 200
        assert c.post(
            f"/contas/{c1}/movimentar",
            json={"tipo": "saida", "valor": 120.0, "descricao": "Luz Casa", "modulo_id": mid, "data_lancamento": "2026-11-22"},
            headers=headers,
        ).status_code == 200
        assert c.post(
            "/lancamentos/",
            json={
                "descricao": "Transf Casa",
                "tipo": "transferencia",
                "valor_total": 200.0,
                "data_lancamento": "2026-11-22",
                "conta_id": c1,
                "conta_destino_id": c2,
                "modulo_id": mid,
            },
            headers=headers,
        ).status_code == 200

        dash_mod = next(m for m in c.get("/relatorios/dashboard?mes=11&ano=2026", headers=headers).json()["modulos"] if m["id"] == mid)
        list_mod = next(m for m in c.get("/modulos/?mes=11&ano=2026", headers=headers).json() if m["id"] == mid)
        gastos_mod = c.get(f"/modulos/{mid}/gastos?mes=11&ano=2026", headers=headers).json()

        assert dash_mod["total"] == 120.0
        assert list_mod["total_mes_atual"] == 120.0
        assert gastos_mod["total"] == 120.0
        assert [it["descricao"] for it in gastos_mod["lancamentos"]] == ["Luz Casa"]
    finally:
        env["cleanup"]()


def test_lancamentos_validacao_estrita_e_busca(tmp_path: Path):
    """Valida campos inválidos em POST /lancamentos/ e busca textual em GET /lancamentos/."""
    env = _build_test_app(tmp_path)
    try:
        c = env["client"]
        headers = _auth_headers(c, "luiz", "senha123", "Francisco Luiz", is_first=True)
        card_id = c.post("/cartoes/", json={"nome": "Nubank", "dia_fechamento": 5, "dia_vencimento": 12}, headers=headers).json()["id"]
        c1 = c.post("/contas/", json={"nome": "Caixa", "banco": "Caixa", "saldo_inicial": 500.0}, headers=headers).json()["id"]

        # Descrição vazia
        assert c.post("/lancamentos/", json={"descricao": "   ", "tipo": "compra_cartao", "valor_total": 50, "data_lancamento": "2026-11-22", "cartao_id": card_id}, headers=headers).status_code == 400
        # Tipo inválido
        assert c.post("/lancamentos/", json={"descricao": "Teste", "tipo": "inventado", "valor_total": 50, "data_lancamento": "2026-11-22"}, headers=headers).status_code == 400
        # compra_cartao sem cartao_id
        assert c.post("/lancamentos/", json={"descricao": "Sem cartao", "tipo": "compra_cartao", "valor_total": 50, "data_lancamento": "2026-11-22"}, headers=headers).status_code == 400
        # transferencia sem conta_destino_id
        assert c.post("/lancamentos/", json={"descricao": "Transf incompleta", "tipo": "transferencia", "valor_total": 50, "data_lancamento": "2026-11-22", "conta_id": c1}, headers=headers).status_code == 400
        # mes_fatura inválido
        assert c.post("/lancamentos/", json={"descricao": "Mes 99", "tipo": "compra_cartao", "valor_total": 50, "data_lancamento": "2026-11-22", "cartao_id": card_id, "mes_fatura": 99, "ano_fatura": 2026}, headers=headers).status_code == 400
        # total_parcelas fora do intervalo
        assert c.post("/lancamentos/", json={"descricao": "200x", "tipo": "compra_cartao", "valor_total": 50, "total_parcelas": 200, "data_lancamento": "2026-11-22", "cartao_id": card_id}, headers=headers).status_code == 400

        # Lançamentos válidos + busca textual
        assert c.post("/lancamentos/", json={"descricao": "Farmácia Drogasil", "tipo": "compra_cartao", "valor_total": 85.5, "data_lancamento": "2026-11-22", "cartao_id": card_id}, headers=headers).status_code == 200
        assert c.post("/lancamentos/", json={"descricao": "Mercado Extra", "tipo": "despesa_conta", "valor_total": 140.0, "data_lancamento": "2026-11-22", "conta_id": c1}, headers=headers).status_code == 200

        r_busca = c.get("/lancamentos/?mes=0&busca=drogasil", headers=headers)
        assert r_busca.status_code == 200
        assert [it["descricao"] for it in r_busca.json()["items"]] == ["Farmácia Drogasil"]
    finally:
        env["cleanup"]()


def test_restore_zip_legado_multi_usuario_isola_por_email_e_preserva_logo(tmp_path: Path):
    """Backup SQLite legado multi-usuário com IDs trocados restaura pelo email (nunca vaza outro perfil) e restaura logo_path."""
    env = _build_test_app(tmp_path)
    try:
        c = env["client"]
        headers_admin = _auth_headers(c, "admin", "senha123", "Administrador", is_first=True)
        headers_luiz = _auth_headers(c, "luiz", "senha123", "Francisco Luiz", is_first=False)

        # Cria um banco SQLite legado onde luiz tem id=1 e admin tem id=2 (IDs invertidos!)
        leg_db = tmp_path / "legacy_swapped.db"
        leg_eng = create_engine(f"sqlite:///{leg_db}", connect_args={"check_same_thread": False})
        models.Base.metadata.create_all(bind=leg_eng)
        LSL = sessionmaker(bind=leg_eng)
        ls = LSL()
        try:
            u_luiz = models.Usuario(id=1, nome="Francisco Luiz", email="luiz", senha_hash="x", logo_path="/uploads/avatar_luiz.jpg")
            u_admin = models.Usuario(id=2, nome="Admin", email="admin", senha_hash="y")
            ls.add_all([u_luiz, u_admin])
            ls.flush()
            ls.add(models.ContaBancaria(usuario_id=1, nome="CONTA_REAL_LUIZ", banco="BB", saldo_inicial=777.0))
            ls.add(models.ContaBancaria(usuario_id=2, nome="CONTA_SECRETA_ADMIN", banco="Bradesco", saldo_inicial=999.0))
            ls.commit()
        finally:
            ls.close()
            leg_eng.dispose()

        zbuf = io.BytesIO()
        with zipfile.ZipFile(zbuf, "w") as zf:
            zf.write(leg_db, arcname="financeiro.db")
            zf.writestr("uploads/avatar_luiz.jpg", b"\xff\xd8\xff\xe0fakejpg")

        # Luiz (id=2 no banco principal) restaura o ZIP legado -> deve puxar APENAS CONTA_REAL_LUIZ!
        r_ok = c.post(
            "/cloud/restore-backup",
            files={"file": ("legacy_multi.zip", zbuf.getvalue(), "application/zip")},
            headers=headers_luiz,
        )
        assert r_ok.status_code == 200, r_ok.text
        luiz_contas = [x["nome"] for x in c.get("/contas/", headers=headers_luiz).json()]
        assert luiz_contas == ["CONTA_REAL_LUIZ"]
        assert "CONTA_SECRETA_ADMIN" not in luiz_contas
        # Logo restaurado no perfil e em uploads/
        me_luiz = c.get("/auth/me", headers=headers_luiz).json()
        assert me_luiz["logo_path"] == "/uploads/avatar_luiz.jpg"
        assert (env["uploads_dir"] / "avatar_luiz.jpg").is_file()

        # Um terceiro perfil ('maria') que NÃO existe no backup multi-usuário deve receber 400 (nunca puxar dados de outro)
        headers_maria = _auth_headers(c, "maria", "senha123", "Maria", is_first=False)
        r_refuse = c.post(
            "/cloud/restore-backup",
            files={"file": ("legacy_multi.zip", zbuf.getvalue(), "application/zip")},
            headers=headers_maria,
        )
        assert r_refuse.status_code == 400
    finally:
        env["cleanup"]()


def test_desktop_hub_sync_preserva_headers_backup_agora_e_remap_movimentar_offline(tmp_path: Path):
    """No modo Desktop: preserva headers X-Auto-Saved/X-Cloud-Sync-*, sincroniza /cloud/backup-agora com Hub e remapeia movimentar offline."""
    from services.hub_sync import HubSyncASGIMiddleware

    hub_env = _build_test_app(tmp_path / "hub", is_cloud_container=True)
    pc_env = _build_test_app(tmp_path / "pc", is_cloud_container=False)
    try:
        hub_client_http = hub_env["client"]
        # Configura Hub com um usuário pré-existente (luiz) e 1 conta
        h_hub_luiz = _auth_headers(hub_client_http, "luiz", "senha123", "Francisco Luiz", is_first=True)
        hub_conta_id = hub_client_http.post(
            "/contas/",
            json={"nome": "Conta Hub", "banco": "Itaú", "saldo_inicial": 1000.0},
            headers=h_hub_luiz,
        ).json()["id"]
        # Cria 1 lançamento extra no Hub para forçar IDs diferentes entre PC offline e Hub!
        hub_client_http.post(
            f"/contas/{hub_conta_id}/movimentar",
            json={"tipo": "entrada", "valor": 50.0, "descricao": "Bonus Hub"},
            headers=h_hub_luiz,
        )

        # Configura transporte do PC falando direto com o TestClient do Hub (com chave liga/desliga offline)
        net_state = {"online": True, "hub_backup_calls": 0}

        def hub_transport(method, url, headers=None, data=None, timeout=12.0):
            if not net_state["online"]:
                raise OSError("Sem internet")
            rel_path = url.replace("https://hub.local", "")
            if method.upper() == "POST" and rel_path == "/cloud/backup-agora":
                net_state["hub_backup_calls"] += 1
            resp = hub_client_http.request(method, rel_path, headers=headers or {}, content=data)
            resp_hdrs = {k.lower(): v for k, v in resp.headers.items()}
            if method.upper() in ("POST", "PUT", "PATCH", "DELETE") and rel_path.startswith("/contas/"):
                resp_hdrs["x-auto-saved"] = "true"
                resp_hdrs["x-cloud-sync-status"] = "synced"
                resp_hdrs["x-cloud-sync-rev"] = "77"
            return resp.status_code, resp_hdrs, resp.content

        hub_sync = HubSyncClient(
            data_dir=pc_env["data_dir"],
            db_path=pc_env["db_path"],
            hub_url="https://hub.local",
            http_transport=hub_transport,
            enabled=True,
            version_poll_interval_sec=0.0,
            offline_cooldown_sec=0.0,
        )
        # Monta app PC com HubSyncASGIMiddleware e registra hub_sync no router cloud
        pc_app = FastAPI()
        for router_mod in (auth_router, cartoes, contas, pessoas, modulos, lancamentos, relatorios, cloud, sync_hub):
            pc_app.include_router(router_mod.router)
        import database as db_mod

        def pc_get_db():
            s = pc_env["SessionLocal"]()
            try:
                yield s
            finally:
                s.close()

        pc_app.dependency_overrides[db_mod.get_db] = pc_get_db
        pc_app.dependency_overrides[cloud.get_cloud_manager] = lambda: pc_env["cloud_mgr"]
        pc_app.dependency_overrides[cloud.get_hub_client] = lambda: hub_sync
        pc_app.add_middleware(HubSyncASGIMiddleware, hub_client=hub_sync)

        try:
            pc_c = TestClient(pc_app)

            # 1) Login no PC sincroniza snapshot do Hub
            r_login = pc_c.post("/auth/login", json={"usuario": "luiz", "senha": "senha123"})
            assert r_login.status_code == 200
            h_pc = {"Authorization": f"Bearer {r_login.json()['access_token']}"}

            # 2) Mutação online preserva headers X-Auto-Saved / X-Cloud-Sync-Status / X-Cloud-Sync-Rev!
            r_on = pc_c.post(
                f"/contas/{hub_conta_id}/movimentar",
                json={"tipo": "entrada", "valor": 100.0, "descricao": "Online PC"},
                headers=h_pc,
            )
            assert r_on.status_code == 200
            assert r_on.headers.get("x-auto-saved") == "true"
            assert r_on.headers.get("x-cloud-sync-status") == "synced"
            assert r_on.headers.get("x-cloud-sync-rev") == "77"

            # 3) Hub cria um lançamento extra no servidor (para deslocar autoincremento de IDs!)
            hub_client_http.post(
                f"/contas/{hub_conta_id}/movimentar",
                json={"tipo": "entrada", "valor": 25.0, "descricao": "Outro Hub"},
                headers=h_hub_luiz,
            )

            # 4) PC fica OFFLINE -> faz movimentar na conta e depois cancela esse mesmo lançamento!
            net_state["online"] = False
            r_off_mov = pc_c.post(
                f"/contas/{hub_conta_id}/movimentar",
                json={"tipo": "saida", "valor": 40.0, "descricao": "Saida Offline Remap"},
                headers=h_pc,
            )
            assert r_off_mov.status_code == 200
            local_lanc_id = r_off_mov.json()["lancamento_id"]

            r_off_del = pc_c.delete(f"/lancamentos/{local_lanc_id}", headers=h_pc)
            assert r_off_del.status_code == 200

            # GET /cloud/status no PC expõe hub_outbox_count == 2!
            st_off = pc_c.get("/cloud/status", headers=h_pc).json()
            assert st_off["hub_sync_enabled"] is True
            assert st_off["hub_outbox_count"] == 2

            # 5) Internet volta -> clicar Backup (/cloud/backup-agora) drena outbox + remapeia ID + chama Hub!
            net_state["online"] = True
            r_bak = pc_c.post("/cloud/backup-agora", headers=h_pc)
            assert r_bak.status_code == 200, r_bak.text
            assert net_state["hub_backup_calls"] == 1
            assert r_bak.json()["status"]["hub_outbox_count"] == 0

            # "Saida Offline Remap" foi criada E cancelada corretamente no Hub (zero fantasma!)
            hub_descs = [it["descricao"] for it in hub_client_http.get("/lancamentos/?mes=0", headers=h_hub_luiz).json()["items"]]
            assert "Saida Offline Remap" not in hub_descs
            assert "Online PC" in hub_descs
            assert "Outro Hub" in hub_descs
        finally:
            pass
    finally:
        pc_env["cleanup"]()
        hub_env["cleanup"]()


def test_gdrive_mirror_com_cofre_ativo_expoe_url_e_envia_copia_sem_bloqueio(tmp_path: Path):
    """Ao conectar Google Drive com Cofre 24/7 já ativo, espelha imediatamente para o Drive e expõe gdrive_folder_url separado."""
    env = _build_test_app(tmp_path)
    try:
        mgr: CloudSyncManager = env["cloud_mgr"]
        _auth_headers(env["client"], "luiz", "senha123", "Francisco Luiz", is_first=True)
        mgr.vault_credentials = {"repo": "owner/vault", "github_token": "tok", "aes_key": "k"}
        mgr.meta["folder_url"] = "https://github.com/owner/vault"

        mirror_called = {"count": 0}

        def fake_fetch_email(force_refresh: bool = False):
            return "luiz@gmail.com"

        def fake_gdrive_sync(*, force: bool = False, reason: str = "manual", mirror_mode: bool = False):
            mirror_called["count"] += 1
            assert mirror_mode is True
            mgr.meta["gdrive_folder_url"] = "https://drive.google.com/drive/folders/folder123"
            mgr.meta["gdrive_last_sync_at"] = 1700000000.0
            return {"ok": True, "action": "synced", "folder_url": mgr.meta["gdrive_folder_url"]}

        mgr._fetch_account_email = fake_fetch_email  # type: ignore[method-assign]
        mgr._gdrive_sync_now = fake_gdrive_sync  # type: ignore[method-assign]

        # Mesmo que o caller passe restore_first=True, com Cofre ativo deve ESPELHAR para o Drive (nunca sobrescrever o Cofre)
        st = mgr.import_oauth_token(
            {"refresh_token": "rt_valid", "access_token": "at_valid"},
            restore_first=True,
            sync_immediately=True,
        )
        assert mirror_called["count"] == 1
        assert st["vault_connected"] is True
        assert st["gdrive_connected"] is True
        assert st["folder_url"] == "https://github.com/owner/vault"
        assert st["gdrive_folder_url"] == "https://drive.google.com/drive/folders/folder123"
        assert st["gdrive_last_sync_at"] == 1700000000.0
    finally:
        env["cleanup"]()
