import io
import json
import os
import re
import sqlite3
import tempfile
import time
import unittest
import urllib.parse
import zipfile
from datetime import date
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import models
from database import Base, get_db
from routers import auth as auth_router, cartoes, cloud as cloud_router, lancamentos, pessoas
from services.cloud_sync import (
    CloudSyncManager,
    create_sqlite_snapshot,
    encode_compact_oauth_token,
    parse_oauth_payload,
)


class FakeGoogleDriveServer:
    """Simula os endpoints reais do Google OAuth2 + Google Drive API v3 em memória."""

    def __init__(self, email: str = "seuluiz.teste@gmail.com"):
        self.email = email
        self.valid_access_token = "ya29.valid_token_1"
        self.token_counter = 1
        self.force_next_401 = False
        self.force_next_503 = False
        self.corrupt_downloads = False
        self.files: dict[str, dict] = {}
        self.resumable_sessions: dict[str, dict] = {}
        self._id_seq = 100

    def _next_id(self) -> str:
        self._id_seq += 1
        return f"gdrive_{self._id_seq}"

    def inject_remote_file(self, name: str, parent_id: str, content: bytes, mime: str = "application/octet-stream") -> str:
        fid = self._next_id()
        self.files[fid] = {
            "id": fid,
            "name": name,
            "parents": [parent_id],
            "mimeType": mime,
            "trashed": False,
            "content": content,
            "size": str(len(content)),
            "webViewLink": f"https://drive.google.com/file/d/{fid}/view",
        }
        return fid

    def __call__(
        self,
        method: str,
        url: str,
        headers: dict[str, str] | None = None,
        data: bytes | None = None,
        timeout: float = 35.0,
    ) -> tuple[int, dict[str, str], bytes]:
        headers = headers or {}
        parsed = urllib.parse.urlparse(url)
        qs = urllib.parse.parse_qs(parsed.query)

        # 1. Endpoint OAuth Token
        if parsed.netloc == "oauth2.googleapis.com" and parsed.path == "/token":
            form = urllib.parse.parse_qs((data or b"").decode("utf-8"))
            grant = (form.get("grant_type") or [""])[0]
            if grant == "authorization_code":
                code = (form.get("code") or [""])[0]
                if code != "valid_oauth_code":
                    return 400, {}, json.dumps({"error": "invalid_grant"}).encode()
                self.token_counter += 1
                self.valid_access_token = f"ya29.valid_token_{self.token_counter}"
                return (
                    200,
                    {"Content-Type": "application/json"},
                    json.dumps(
                        {
                            "access_token": self.valid_access_token,
                            "refresh_token": "1//refresh_token_seu_luiz",
                            "expires_in": 3600,
                            "token_type": "Bearer",
                        }
                    ).encode(),
                )
            if grant == "refresh_token":
                rt = (form.get("refresh_token") or [""])[0]
                if not rt.startswith("1//"):
                    return 400, {}, json.dumps({"error": "invalid_grant"}).encode()
                self.token_counter += 1
                self.valid_access_token = f"ya29.valid_token_{self.token_counter}"
                return (
                    200,
                    {"Content-Type": "application/json"},
                    json.dumps(
                        {
                            "access_token": self.valid_access_token,
                            "expires_in": 3600,
                            "token_type": "Bearer",
                        }
                    ).encode(),
                )
            return 400, {}, b'{"error":"unsupported_grant_type"}'

        # Sessão Resumable PUT
        if parsed.path.startswith("/resumable/"):
            sess_id = parsed.path.rsplit("/", 1)[-1]
            sess = self.resumable_sessions[sess_id]
            sess["buf"].extend(data or b"")
            if len(sess["buf"]) >= sess["total"]:
                raw_bytes = bytes(sess["buf"])
                fid = sess["existing_id"] or self._next_id()
                existing = self.files.get(fid, {})
                parents = existing.get("parents") or sess["meta"].get("parents") or ["root"]
                self.files[fid] = {
                    "id": fid,
                    "name": sess["meta"].get("name") or existing.get("name"),
                    "parents": parents,
                    "mimeType": sess["mime"],
                    "trashed": False,
                    "content": raw_bytes,
                    "size": str(len(raw_bytes)),
                }
                return 200, {}, json.dumps({"id": fid, "name": self.files[fid]["name"], "size": str(len(raw_bytes))}).encode()
            return 308, {"Range": f"bytes=0-{len(sess['buf']) - 1}"}, b""

        # Simula erro transitório 503 ou expiração 401
        if self.force_next_503:
            self.force_next_503 = False
            return 503, {}, b'{"error":"backendError"}'

        auth_hdr = headers.get("Authorization") or ""
        if self.force_next_401 or auth_hdr != f"Bearer {self.valid_access_token}":
            self.force_next_401 = False
            return 401, {}, b'{"error":"Invalid Credentials"}'

        # 2. Drive About
        if parsed.path == "/drive/v3/about":
            return (
                200,
                {"Content-Type": "application/json"},
                json.dumps({"user": {"emailAddress": self.email, "displayName": "Seu Luiz"}}).encode(),
            )

        # 3. Upload Multipart / Resumable
        if parsed.path.startswith("/upload/drive/v3/files"):
            parts = [p for p in parsed.path.split("/") if p]
            existing_id = parts[4] if len(parts) >= 5 else None
            upload_type = (qs.get("uploadType") or [""])[0]

            if upload_type == "resumable":
                meta = json.loads((data or b"{}").decode("utf-8"))
                total = int(headers.get("X-Upload-Content-Length") or 0)
                mime = headers.get("X-Upload-Content-Type") or "application/octet-stream"
                sid = self._next_id()
                self.resumable_sessions[sid] = {
                    "meta": meta,
                    "total": total,
                    "mime": mime,
                    "existing_id": existing_id,
                    "buf": bytearray(),
                }
                return 200, {"Location": f"https://www.googleapis.com/resumable/{sid}"}, b"{}"

            if upload_type == "multipart":
                ct = headers.get("Content-Type") or ""
                m_bound = re.search(r"boundary=([^\s;]+)", ct)
                boundary = m_bound.group(1).encode("utf-8")
                segments = (data or b"").split(b"--" + boundary)
                meta_part = segments[1].split(b"\r\n\r\n", 1)[1].rstrip(b"\r\n")
                file_part = segments[2].split(b"\r\n\r\n", 1)[1]
                if file_part.endswith(b"\r\n"):
                    file_part = file_part[:-2]
                meta = json.loads(meta_part.decode("utf-8"))
                fid = existing_id or self._next_id()
                prev = self.files.get(fid, {})
                parents = prev.get("parents") or meta.get("parents") or ["root"]
                self.files[fid] = {
                    "id": fid,
                    "name": meta.get("name") or prev.get("name"),
                    "parents": parents,
                    "mimeType": meta.get("mimeType") or "application/octet-stream",
                    "trashed": False,
                    "content": file_part,
                    "size": str(len(file_part)),
                }
                return (
                    200,
                    {"Content-Type": "application/json"},
                    json.dumps({"id": fid, "name": self.files[fid]["name"], "size": str(len(file_part))}).encode(),
                )

        # 4. Criar pasta (POST /drive/v3/files)
        if parsed.path == "/drive/v3/files" and method.upper() == "POST":
            meta = json.loads((data or b"{}").decode("utf-8"))
            fid = self._next_id()
            self.files[fid] = {
                "id": fid,
                "name": meta["name"],
                "mimeType": meta["mimeType"],
                "parents": meta.get("parents") or ["root"],
                "trashed": False,
                "content": b"",
                "size": "0",
                "webViewLink": f"https://drive.google.com/drive/folders/{fid}",
            }
            return (
                200,
                {"Content-Type": "application/json"},
                json.dumps(
                    {
                        "id": fid,
                        "name": meta["name"],
                        "webViewLink": f"https://drive.google.com/drive/folders/{fid}",
                    }
                ).encode(),
            )

        # 5. Listar arquivos / pastas (GET /drive/v3/files)
        if parsed.path == "/drive/v3/files" and method.upper() == "GET":
            q = (qs.get("q") or [""])[0]
            parent_m = re.search(r"'([^']+)'\s+in\s+parents", q)
            parent_id = parent_m.group(1) if parent_m else "root"
            want_folder = "mimeType = 'application/vnd.google-apps.folder'" in q
            exclude_folder = "mimeType != 'application/vnd.google-apps.folder'" in q
            name_m = re.search(r"name\s*=\s*'((?:\\'|[^'])*)'", q)
            want_name = name_m.group(1).replace("\\'", "'").replace("\\\\", "\\") if name_m else None

            matched = []
            for item in self.files.values():
                if item.get("trashed"):
                    continue
                if parent_id not in (item.get("parents") or []):
                    continue
                is_fld = item.get("mimeType") == "application/vnd.google-apps.folder"
                if want_folder and not is_fld:
                    continue
                if exclude_folder and is_fld:
                    continue
                if want_name is not None and item.get("name") != want_name:
                    continue
                matched.append(
                    {
                        "id": item["id"],
                        "name": item["name"],
                        "size": item.get("size", "0"),
                        "webViewLink": item.get("webViewLink", ""),
                    }
                )
            return 200, {"Content-Type": "application/json"}, json.dumps({"files": matched}).encode()

        # 6. Download de arquivo (GET /drive/v3/files/{id}?alt=media)
        if parsed.path.startswith("/drive/v3/files/") and method.upper() == "GET":
            fid = parsed.path.rsplit("/", 1)[-1]
            item = self.files.get(fid)
            if not item:
                return 404, {}, b'{"error":"notFound"}'
            if self.corrupt_downloads and item["name"] == "financeiro.db":
                return 200, {}, b"NOT_A_VALID_SQLITE_BINARY_PAYLOAD"
            return 200, {"Content-Type": "application/octet-stream"}, item["content"]

        return 404, {}, f"Unhandled route: {method} {url}".encode()


def _build_test_environment(tmp_path: Path, fake_drive: FakeGoogleDriveServer, is_cloud: bool = False):
    data_dir = tmp_path / ("cloud_node" if is_cloud else "local_node")
    cfg_dir = data_dir / "cfg"
    data_dir.mkdir(parents=True, exist_ok=True)
    db_path = data_dir / "financeiro.db"

    eng = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    with eng.begin() as conn:
        conn.exec_driver_sql("PRAGMA journal_mode=WAL;")
    Base.metadata.create_all(bind=eng)
    Sess = sessionmaker(autocommit=False, autoflush=False, bind=eng)

    def ensure_schema():
        Base.metadata.create_all(bind=eng)

    mgr = CloudSyncManager(
        data_dir=data_dir,
        db_path=db_path,
        config_dir=cfg_dir,
        engine_disposer=eng.dispose,
        schema_migrator=ensure_schema,
        http_transport=fake_drive,
        debounce_seconds=0.15,
        max_wait_seconds=1.0,
        is_cloud_container=is_cloud,
    )

    app = FastAPI()
    app.include_router(auth_router.router)
    app.include_router(cartoes.router)
    app.include_router(pessoas.router)
    app.include_router(lancamentos.router)
    app.include_router(cloud_router.router)

    def override_db():
        with Sess() as db:
            yield db

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[cloud_router.get_cloud_manager] = lambda: mgr
    return app, eng, Sess, mgr, data_dir, db_path


class CloudSyncHardeningTests(unittest.TestCase):
    def test_fluxo_completo_oauth_backup_wal_e_restauracao_em_container_render(self):
        fake_drive = FakeGoogleDriveServer(email="luiz.financeiro@gmail.com")

        tmp = self.enterContext(tempfile.TemporaryDirectory())
        if True:
            root = Path(tmp)
            app1, eng1, Sess1, mgr1, data1, db1 = _build_test_environment(root, fake_drive, is_cloud=False)
            self.addCleanup(eng1.dispose)
            self.addCleanup(mgr1.shutdown)

            with TestClient(app1, base_url="http://127.0.0.1:8000") as client1:
                # Endpoints protegidos exigem autenticação
                self.assertEqual(client1.get("/cloud/status").status_code, 401)
                self.assertEqual(client1.post("/cloud/sync").status_code, 401)
                self.assertEqual(client1.post("/cloud/restore").status_code, 401)

                setup = client1.post(
                    "/auth/setup",
                    json={"nome": "Francisco Luiz", "usuario": "luiz", "senha": "SenhaForte123"},
                )
                self.assertEqual(setup.status_code, 200)
                headers1 = {"Authorization": f"Bearer {setup.json()['access_token']}"}

                # Inicia OAuth 1-clique em loopback sem precisar de arquivo externo
                auth_start = client1.post("/cloud/oauth/authorize", headers=headers1)
                self.assertEqual(auth_start.status_code, 200)
                state = auth_start.json()["state"]
                self.assertIn("accounts.google.com/o/oauth2/v2/auth", auth_start.json()["url"])

                cb = client1.get(f"/cloud/oauth/callback?state={state}&code=valid_oauth_code")
                self.assertEqual(cb.status_code, 200)
                self.assertIn("luiz.financeiro@gmail.com", cb.text)

                st = client1.get("/cloud/status", headers=headers1).json()
                self.assertTrue(st["connected"])
                self.assertEqual(st["account"], "luiz.financeiro@gmail.com")

                # Cria dados financeiros reais + arquivo em uploads/
                cartao = client1.post(
                    "/cartoes/",
                    headers=headers1,
                    json={"nome": "Atacadão Visa", "bandeira": "Visa", "limite": 5000},
                ).json()
                pessoa = client1.post(
                    "/pessoas/",
                    headers=headers1,
                    json={"nome": "Thais", "telefone": "11999998888"},
                ).json()
                compra = client1.post(
                    "/lancamentos/",
                    headers=headers1,
                    json={
                        "descricao": "Supermercado Mensal",
                        "tipo": "compra_cartao",
                        "valor_total": 450.0,
                        "total_parcelas": 3,
                        "data_lancamento": "2026-11-10",
                        "cartao_id": cartao["id"],
                        "pessoa_id": pessoa["id"],
                    },
                )
                self.assertEqual(compra.status_code, 200)
                (data1 / "uploads" / "comprovante_teste.jpg").write_bytes(b"\xff\xd8\xff\xe0COMPROVANTE_JPEG")

                # Força erro transitório 503 + renovação automática 401 para provar resiliência
                fake_drive.force_next_503 = True
                sync_res = client1.post("/cloud/sync", headers=headers1)
                self.assertEqual(sync_res.status_code, 200)
                self.assertEqual(sync_res.json()["sync_result"]["action"], "synced")
                self.assertEqual(sync_res.json()["uploads_synced_count"], 1)

                # Segunda sincronização sem mudanças não reenvia arquivos à toa
                up_to_date = mgr1.sync_now(force=False)
                self.assertEqual(up_to_date["action"], "up_to_date")

                # Exporta token compacto sem aspas (pronto para Render / GitHub Secrets)
                exp = client1.get("/cloud/export-token", headers=headers1)
                self.assertEqual(exp.status_code, 200)
                compact_token = exp.json()["compact_token"]
                self.assertTrue(compact_token.startswith("GDRIVE1:"))

                # Valida download de pacote ZIP completo
                zip_resp = client1.get("/cloud/backup-zip", headers=headers1)
                self.assertEqual(zip_resp.status_code, 200)
                with zipfile.ZipFile(io.BytesIO(zip_resp.content)) as zf:
                    self.assertIn("financeiro.db", zf.namelist())
                    self.assertIn("uploads/comprovante_teste.jpg", zf.namelist())

            # Injeta arquivo malicioso de path traversal na pasta uploads remota (deve ser ignorado)
            uploads_folders = [
                f["id"]
                for f in fake_drive.files.values()
                if f.get("name") == "uploads" and f.get("mimeType") == "application/vnd.google-apps.folder"
            ]
            fake_drive.inject_remote_file("../invasao.txt", uploads_folders[0], b"malicioso")

            # =====================================================================
            # SIMULAÇÃO DE CONTAINER RENDER REINICIADO / REDEPLOY EFÊMERO DO ZERO
            # =====================================================================
            old_env = os.environ.get("GOOGLE_DRIVE_OAUTH_JSON")
            os.environ["GOOGLE_DRIVE_OAUTH_JSON"] = compact_token
            try:
                app2, eng2, Sess2, mgr2, data2, db2 = _build_test_environment(
                    root, fake_drive, is_cloud=True
                )
                self.addCleanup(eng2.dispose)
                self.addCleanup(mgr2.shutdown)

                # No momento em que o container sobe, o banco está vazio (0 usuários)
                # Testa primeiro a trava Anti-Wipe caso alguém tentasse sincronizar antes de restaurar:
                anti_wipe = mgr2.sync_now(force=False)
                self.assertFalse(anti_wipe["ok"])
                self.assertTrue(anti_wipe.get("blocked_anti_wipe"))

                # Testa rejeição caso o download venha corrompido:
                fake_drive.corrupt_downloads = True
                bad_restore = mgr2.restore_from_drive(force=False, on_boot=True)
                self.assertFalse(bad_restore["ok"])
                fake_drive.corrupt_downloads = False

                # Agora executa o boot real do container com renovação automática de token 401:
                fake_drive.force_next_401 = True
                boot_restore = mgr2.restore_from_drive(force=False, on_boot=True)
                self.assertTrue(boot_restore["ok"])
                self.assertTrue(boot_restore["restored"])
                self.assertEqual(boot_restore["counts"]["usuarios"], 1)
                self.assertEqual(boot_restore["counts"]["lancamentos"], 1)
                self.assertEqual(boot_restore["counts"]["parcelas"], 3)

                # Comprovante restaurado e tentativa de path traversal bloqueada!
                self.assertEqual(
                    (data2 / "uploads" / "comprovante_teste.jpg").read_bytes(),
                    b"\xff\xd8\xff\xe0COMPROVANTE_JPEG",
                )
                self.assertFalse((data2 / "invasao.txt").exists())

                # Login e leitura dos lançamentos funcionam imediatamente no novo container!
                with TestClient(app2) as client2:
                    login2 = client2.post(
                        "/auth/login", json={"usuario": "luiz", "senha": "SenhaForte123"}
                    )
                    self.assertEqual(login2.status_code, 200)
                    headers2 = {"Authorization": f"Bearer {login2.json()['access_token']}"}
                    lancs = client2.get("/lancamentos/?mes=11&ano=2026", headers=headers2).json()
                    self.assertEqual(len(lancs["items"]), 1)
                    self.assertEqual(lancs["items"][0]["descricao"], "Supermercado Mensal")
            finally:
                if old_env is None:
                    os.environ.pop("GOOGLE_DRIVE_OAUTH_JSON", None)
                else:
                    os.environ["GOOGLE_DRIVE_OAUTH_JSON"] = old_env

    def test_debounce_automatico_e_upload_resumable_arquivo_grande(self):
        fake_drive = FakeGoogleDriveServer()
        tmp = self.enterContext(tempfile.TemporaryDirectory())
        if True:
            root = Path(tmp)
            app, eng, Sess, mgr, data_dir, db_path = _build_test_environment(root, fake_drive, is_cloud=False)
            self.addCleanup(eng.dispose)
            self.addCleanup(mgr.shutdown)

            compact, _ = encode_compact_oauth_token(
                {
                    "client_id": "202264815644.apps.googleusercontent.com",
                    "refresh_token": "1//refresh_token_debounce",
                    "account": "debounce@gmail.com",
                }
            )
            parsed = parse_oauth_payload(compact)
            self.assertEqual(parsed["account"], "debounce@gmail.com")
            mgr.import_oauth_token(compact, restore_first=False, sync_immediately=False)

            with Sess() as db:
                db.add(models.Usuario(nome="Luiz", email="luiz", senha_hash="hash"))
                db.commit()

            # Arquivo > 4 MB exercita o caminho resumable em blocos
            big_receipt = b"PDF_DATA_" * (500 * 1024)  # ~4.5 MB
            (data_dir / "uploads" / "extrato_grande.pdf").write_bytes(big_receipt)

            mgr.notify_change("rapid_write_1")
            mgr.notify_change("rapid_write_2")
            mgr.notify_change("rapid_write_3")

            deadline = time.time() + 4.0
            while time.time() < deadline and mgr.status()["revision"] < 1:
                time.sleep(0.05)

            st = mgr.status()
            self.assertGreaterEqual(st["revision"], 1)
            self.assertEqual(st["uploads_synced_count"], 1)
            self.assertFalse(st["pending_changes"])

    def test_main_app_health_e_cli_status(self):
        import subprocess
        import sys
        import main as backend_main

        with TestClient(backend_main.app) as client:
            health = client.get("/health")
            self.assertEqual(health.status_code, 200)
            body = health.json()
            self.assertEqual(body["status"], "ok")
            self.assertEqual(body["sistema"], "Administração Financeira")
            self.assertIn("nuvem", body)
            self.assertIn("drive_conectado", body["nuvem"])
            self.assertEqual(client.get("/cloud/status").status_code, 401)

        cli_script = Path(__file__).resolve().parent.parent / "scripts" / "configurar_nuvem_drive.py"
        proc = subprocess.run(
            [sys.executable, str(cli_script), "--status"],
            capture_output=True,
            text=True,
            timeout=20,
            check=True,
        )
        cli_json = json.loads(proc.stdout)
        self.assertIn("connected", cli_json)
        self.assertEqual(cli_json["keep_alive_interval_minutes"], 10)


if __name__ == "__main__":
    unittest.main()
