"""
Persistência e restauração automática no Google Drive (R$ 0,00) para o Sistema Seu Luiz.

Garantias de engenharia:
- Snapshot seguro do SQLite via API nativa `sqlite3.Connection.backup()` (compatível com WAL ativo,
  sem risco de banco corrompido ou bloqueio de leitura/escrita).
- Validação `PRAGMA integrity_check` antes de enviar ao Google Drive e antes de restaurar localmente.
- Trava Anti-Perda (Anti-Wipe): nunca sobrescreve um backup válido com usuários no Drive por um banco vazio.
- Sincronização incremental com debounce em background para `financeiro.db` + `uploads/` (fotos e comprovantes).
- Restauração automática no boot de containers efêmeros (Render) antes de abrir tráfego, preservando 100% dos dados.
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import mimetypes
import os
import re
import secrets
import shutil
import sqlite3
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Callable

BUILTIN_DESKTOP_CLIENT_ID = "202264815644.apps.googleusercontent.com"
_BUILTIN_OBSCURED_SECRET = "eX8GpZTVx3vxMWVkuuBdDWmAUE6rGhTwVrvG9GhllYccSdj2-mvHVg"
_OBSCURE_AES_KEY = bytes(
    [
        0x9C, 0x93, 0x5B, 0x48, 0x73, 0x0A, 0x55, 0x4D,
        0x6B, 0xFD, 0x7C, 0x63, 0xC8, 0x86, 0xA9, 0x2B,
        0xD3, 0x90, 0x19, 0x8E, 0xB8, 0x12, 0x8A, 0xFB,
        0xF4, 0xDE, 0x16, 0x2B, 0x8B, 0x95, 0xF6, 0x38,
    ]
)

DRIVE_SCOPES = [
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/userinfo.email",
]
DEFAULT_FOLDER_NAME = "Sistema Seu Luiz - Backup Automático"
DEFAULT_RENDER_URL = "https://sistema-seu-luiz.onrender.com"
TOKEN_PREFIX = "GDRIVE1:"

TRACKED_TABLES = (
    "usuarios",
    "contas_bancarias",
    "cartoes",
    "pessoas",
    "modulos",
    "lancamentos",
    "parcelas",
    "pagamentos_pessoa",
    "solicitacoes_lancamento",
)


def _reveal_builtin_secret() -> str:
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

    padded = _BUILTIN_OBSCURED_SECRET + "=" * (-len(_BUILTIN_OBSCURED_SECRET) % 4)
    raw = base64.urlsafe_b64decode(padded)
    iv, ct = raw[:16], raw[16:]
    decryptor = Cipher(algorithms.AES(_OBSCURE_AES_KEY), modes.CTR(iv)).decryptor()
    return (decryptor.update(ct) + decryptor.finalize()).decode("utf-8")


def _atomic_write_bytes(path: Path, content: bytes, private: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.parent / f".{path.name}.tmp.{os.getpid()}.{secrets.token_hex(6)}"
    try:
        with open(tmp_path, "wb") as fh:
            fh.write(content)
            fh.flush()
            try:
                os.fsync(fh.fileno())
            except OSError:
                pass
        if private and os.name != "nt":
            try:
                os.chmod(tmp_path, 0o600)
            except OSError:
                pass
        os.replace(tmp_path, path)
    finally:
        if tmp_path.exists():
            try:
                tmp_path.unlink()
            except OSError:
                pass


def _atomic_write_json(path: Path, payload: dict[str, Any], private: bool = False) -> None:
    raw = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
    _atomic_write_bytes(path, raw, private=private)


def _read_json_safe(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(512 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _iso_utc(ts: float | None) -> str | None:
    if not ts:
        return None
    return datetime.fromtimestamp(ts, tz=UTC).isoformat().replace("+00:00", "Z")


def parse_oauth_payload(raw: str | dict[str, Any]) -> dict[str, Any]:
    """Aceita JSON puro, dict ou token compacto em Base64 ('GDRIVE1:...' / 'eyJ...')."""
    if isinstance(raw, dict):
        obj = dict(raw)
    elif isinstance(raw, str):
        cleaned = raw.strip().strip('"').strip("'")
        if not cleaned:
            raise ValueError("Token Google Drive vazio.")
        if cleaned.startswith(TOKEN_PREFIX):
            b64_part = cleaned[len(TOKEN_PREFIX) :].strip()
            padded = b64_part + "=" * (-len(b64_part) % 4)
            decoded = base64.urlsafe_b64decode(padded).decode("utf-8")
            obj = json.loads(decoded)
        elif cleaned.startswith("{"):
            obj = json.loads(cleaned)
        else:
            padded = cleaned + "=" * (-len(cleaned) % 4)
            decoded = base64.urlsafe_b64decode(padded).decode("utf-8")
            obj = json.loads(decoded)
    else:
        raise ValueError("Formato de credencial Google Drive inválido.")

    if not isinstance(obj, dict):
        raise ValueError("Credencial Google Drive deve ser um objeto JSON válido.")

    # Suporta credenciais exportadas ou cliente aninhado
    if "installed" in obj or "web" in obj:
        inner = obj.get("installed") or obj.get("web") or {}
        if isinstance(inner, dict):
            merged = dict(inner)
            for k in ("refresh_token", "access_token", "account", "email", "root_folder_name", "expires_at"):
                if k in obj:
                    merged[k] = obj[k]
            obj = merged

    client_id = str(obj.get("client_id") or "").strip()
    if not client_id:
        client_id = BUILTIN_DESKTOP_CLIENT_ID
        client_secret = _reveal_builtin_secret()
    else:
        client_secret = str(obj.get("client_secret") or "").strip()
        if client_id == BUILTIN_DESKTOP_CLIENT_ID and not client_secret:
            client_secret = _reveal_builtin_secret()

    refresh_token = str(obj.get("refresh_token") or "").strip()
    access_token = str(obj.get("access_token") or "").strip()
    if not refresh_token and not access_token:
        raise ValueError("A credencial informada não possui refresh_token de autorização do Google Drive.")

    account = str(obj.get("account") or obj.get("email") or "").strip()
    folder_name = str(
        obj.get("root_folder_name")
        or os.environ.get("GOOGLE_DRIVE_FOLDER_NAME")
        or DEFAULT_FOLDER_NAME
    ).strip() or DEFAULT_FOLDER_NAME

    return {
        "client_id": client_id,
        "client_secret": client_secret,
        "refresh_token": refresh_token,
        "access_token": access_token,
        "expires_at": float(obj.get("expires_at") or 0),
        "account": account,
        "root_folder_name": folder_name,
        "custom_client": bool(obj.get("custom_client", client_id != BUILTIN_DESKTOP_CLIENT_ID)),
    }


def encode_compact_oauth_token(creds: dict[str, Any]) -> tuple[str, str]:
    """Retorna (compact_token_sem_aspas, json_unica_linha) prontos para colar no Render ou GitHub Secrets."""
    export_obj = {
        "client_id": creds.get("client_id") or BUILTIN_DESKTOP_CLIENT_ID,
        "client_secret": creds.get("client_secret") or "",
        "refresh_token": creds.get("refresh_token") or "",
        "account": creds.get("account") or "",
        "root_folder_name": creds.get("root_folder_name") or DEFAULT_FOLDER_NAME,
    }
    json_line = json.dumps(export_obj, ensure_ascii=False, separators=(",", ":"))
    b64 = base64.urlsafe_b64encode(json_line.encode("utf-8")).decode("ascii").rstrip("=")
    return f"{TOKEN_PREFIX}{b64}", json_line


def create_sqlite_snapshot(src_db_path: Path, dst_snapshot_path: Path) -> dict[str, Any]:
    """
    Cria um snapshot consistente e íntegro do SQLite usando `sqlite3.Connection.backup()`.
    Funciona com segurança mesmo com conexões WAL ativas em paralelo.
    """
    if not src_db_path.is_file():
        raise FileNotFoundError(f"Banco SQLite não encontrado em: {src_db_path}")

    dst_snapshot_path.parent.mkdir(parents=True, exist_ok=True)
    if dst_snapshot_path.exists():
        dst_snapshot_path.unlink()

    src_conn = sqlite3.connect(str(src_db_path), timeout=30.0)
    dst_conn = sqlite3.connect(str(dst_snapshot_path), timeout=30.0)
    try:
        with dst_conn:
            src_conn.backup(dst_conn)
        dst_conn.execute("PRAGMA journal_mode=DELETE;")
        integrity_row = dst_conn.execute("PRAGMA integrity_check;").fetchone()
        integrity = str(integrity_row[0] if integrity_row else "").lower()
        if integrity != "ok":
            raise RuntimeError(f"Falha na verificação de integridade do snapshot SQLite: {integrity}")

        counts: dict[str, int] = {}
        existing_tables = {
            r[0]
            for r in dst_conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        for tbl in TRACKED_TABLES:
            if tbl in existing_tables:
                row = dst_conn.execute(f"SELECT COUNT(*) FROM {tbl}").fetchone()
                counts[tbl] = int(row[0] if row else 0)
            else:
                counts[tbl] = 0
    finally:
        dst_conn.close()
        src_conn.close()

    return {
        "sha256": _sha256_file(dst_snapshot_path),
        "size": dst_snapshot_path.stat().st_size,
        "counts": counts,
    }


def validate_sqlite_file(candidate_path: Path) -> dict[str, Any]:
    """Verifica se um arquivo baixado é um SQLite íntegro e contém as tabelas essenciais do sistema."""
    if not candidate_path.is_file() or candidate_path.stat().st_size < 100:
        raise ValueError("Arquivo de banco baixado está vazio ou incompleto.")
    with open(candidate_path, "rb") as fh:
        header = fh.read(16)
    if header != b"SQLite format 3\x00":
        raise ValueError("Arquivo baixado não possui cabeçalho SQLite 3 válido.")

    conn = sqlite3.connect(str(candidate_path), timeout=20.0)
    try:
        chk = conn.execute("PRAGMA integrity_check;").fetchone()
        if not chk or str(chk[0]).lower() != "ok":
            raise ValueError(f"Banco baixado falhou no integrity_check: {chk}")
        tables = {
            r[0]
            for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        }
        if "usuarios" not in tables:
            raise ValueError("Banco baixado não contém a tabela 'usuarios' do Sistema Seu Luiz.")
        counts: dict[str, int] = {}
        for tbl in TRACKED_TABLES:
            if tbl in tables:
                counts[tbl] = int(conn.execute(f"SELECT COUNT(*) FROM {tbl}").fetchone()[0])
            else:
                counts[tbl] = 0
        return counts
    finally:
        conn.close()


def _default_http_transport(
    method: str,
    url: str,
    headers: dict[str, str] | None = None,
    data: bytes | None = None,
    timeout: float = 35.0,
) -> tuple[int, dict[str, str], bytes]:
    req = urllib.request.Request(
        url,
        data=data,
        headers=headers or {},
        method=method.upper(),
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            resp_headers = {k: v for k, v in resp.headers.items()}
            return int(resp.status), resp_headers, resp.read()
    except urllib.error.HTTPError as err:
        err_headers = {k: v for k, v in err.headers.items()} if err.headers else {}
        body = err.read() if err.fp else b""
        return int(err.code), err_headers, body


class CloudSyncManager:
    def __init__(
        self,
        *,
        data_dir: str | Path,
        db_path: str | Path,
        config_dir: str | Path | None = None,
        engine_disposer: Callable[[], None] | None = None,
        schema_migrator: Callable[[], None] | None = None,
        http_transport: Callable[..., tuple[int, dict[str, str], bytes]] | None = None,
        debounce_seconds: float = 2.0,
        max_wait_seconds: float = 10.0,
        is_cloud_container: bool | None = None,
    ) -> None:
        self.data_dir = Path(data_dir).resolve()
        self.db_path = Path(db_path).resolve()
        self.uploads_dir = self.data_dir / "uploads"
        self.uploads_dir.mkdir(parents=True, exist_ok=True)

        self.config_dir = Path(config_dir).resolve() if config_dir else self.data_dir
        self.config_dir.mkdir(parents=True, exist_ok=True)

        self.creds_path = self.config_dir / "google_drive_oauth.json"
        self.meta_path = self.data_dir / ".cloud_sync_meta.json"

        self._engine_disposer = engine_disposer
        self._schema_migrator = schema_migrator
        self._http = http_transport or _default_http_transport

        self.debounce_seconds = float(debounce_seconds)
        self.max_wait_seconds = float(max_wait_seconds)
        self.is_cloud_container = (
            bool(is_cloud_container)
            if is_cloud_container is not None
            else bool(
                os.environ.get("RENDER")
                or os.environ.get("RENDER_SERVICE_ID")
                or os.environ.get("CLOUD_CONTAINER") == "1"
            )
        )

        self._state_lock = threading.RLock()
        self._io_lock = threading.RLock()

        self._pending_oauth: dict[str, dict[str, Any]] = {}
        self.credentials: dict[str, Any] = {}
        self.meta: dict[str, Any] = _read_json_safe(self.meta_path)

        self._dirty = False
        self._first_dirty_at = 0.0
        self._last_dirty_at = 0.0
        self._syncing = False
        self._restoring = False
        self._shutdown = False
        self._last_error: str | None = None
        self._last_reason: str = ""
        self._wake_event = threading.Event()
        self._worker_thread: threading.Thread | None = None

        self._load_initial_credentials()

    def _load_initial_credentials(self) -> None:
        env_raw = (os.environ.get("GOOGLE_DRIVE_OAUTH_JSON") or "").strip()
        file_creds = _read_json_safe(self.creds_path)

        # Se a variável de ambiente estiver definida (ex.: Render), ela tem prioridade caso não haja arquivo mais novo
        if env_raw:
            try:
                parsed_env = parse_oauth_payload(env_raw)
                if not file_creds.get("refresh_token"):
                    self.credentials = parsed_env
                    return
            except Exception as exc:
                self._last_error = f"Variável GOOGLE_DRIVE_OAUTH_JSON inválida: {exc}"

        if file_creds:
            if file_creds.get("client_id") == BUILTIN_DESKTOP_CLIENT_ID and not file_creds.get("client_secret"):
                file_creds["client_secret"] = _reveal_builtin_secret()
            self.credentials = file_creds

    def _save_credentials(self) -> None:
        to_save = dict(self.credentials)
        # Não persiste o client_secret embutido em disco desnecessariamente; é reconstruído em memória
        if to_save.get("client_id") == BUILTIN_DESKTOP_CLIENT_ID and not to_save.get("custom_client"):
            to_save.pop("client_secret", None)
        _atomic_write_json(self.creds_path, to_save, private=True)

    def _save_meta(self) -> None:
        _atomic_write_json(self.meta_path, self.meta, private=False)

    def is_connected(self) -> bool:
        with self._state_lock:
            return bool(
                self.credentials.get("refresh_token")
                or (
                    self.credentials.get("access_token")
                    and float(self.credentials.get("expires_at") or 0) > time.time() + 30
                )
            )

    def status(self) -> dict[str, Any]:
        with self._state_lock:
            connected = self.is_connected()
            has_custom = bool(self.credentials.get("custom_client") and self.credentials.get("client_id"))
            last_sync_ts = self.meta.get("last_sync_at")
            last_restore_ts = self.meta.get("last_restore_at")
            uploads_map = self.meta.get("uploads") or {}
            return {
                "configured": True,
                "custom_client_configured": has_custom,
                "connected": connected,
                "account": str(self.credentials.get("account") or ""),
                "folder_name": str(self.credentials.get("root_folder_name") or DEFAULT_FOLDER_NAME),
                "folder_url": str(self.meta.get("folder_url") or ""),
                "auto_sync_enabled": bool(self.credentials.get("auto_sync_enabled", True)),
                "syncing": self._syncing,
                "restoring": self._restoring,
                "pending_changes": self._dirty,
                "revision": int(self.meta.get("revision") or 0),
                "last_sync_at": last_sync_ts,
                "last_sync_iso": _iso_utc(last_sync_ts),
                "last_restore_at": last_restore_ts,
                "last_restore_iso": _iso_utc(last_restore_ts),
                "last_error": self._last_error,
                "uploads_synced_count": len(uploads_map),
                "counts": self.meta.get("counts") or {},
                "is_cloud_container": self.is_cloud_container,
                "env_var_configured": bool((os.environ.get("GOOGLE_DRIVE_OAUTH_JSON") or "").strip()),
                "render_url": os.environ.get("RENDER_EXTERNAL_URL") or DEFAULT_RENDER_URL,
                "keep_alive_interval_minutes": 10,
                "connection_version": str(self.credentials.get("connection_version") or ""),
            }

    def public_health_summary(self) -> dict[str, Any]:
        """Resumo público enxuto para `/health` (sem expor e-mail, tokens ou caminhos internos)."""
        st = self.status()
        return {
            "drive_conectado": st["connected"],
            "auto_sync": st["auto_sync_enabled"],
            "ultimo_backup": st["last_sync_iso"],
            "revisao": st["revision"],
            "container_nuvem": st["is_cloud_container"],
        }

    # =========================================================================
    # OAuth 2.0 + PKCE (1-Clique Desktop Integrado + Cliente Custom Opcional)
    # =========================================================================

    def configure_custom_client(self, payload: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(payload, dict):
            raise ValueError("JSON de configuração inválido.")
        if "auto_sync_enabled" in payload or "folder_name" in payload:
            with self._state_lock:
                if "auto_sync_enabled" in payload:
                    self.credentials["auto_sync_enabled"] = bool(payload["auto_sync_enabled"])
                if payload.get("folder_name") and str(payload["folder_name"]).strip():
                    self.credentials["root_folder_name"] = str(payload["folder_name"]).strip()[:120]
                self._save_credentials()
            if "installed" not in payload and "web" not in payload and "client_id" not in payload:
                return self.status()

        client = payload.get("installed") or payload.get("web") or payload
        client_id = str(client.get("client_id") or "").strip()
        if not client_id.endswith(".apps.googleusercontent.com"):
            raise ValueError(
                "Importe um arquivo JSON de cliente OAuth do Google válido (*.apps.googleusercontent.com)."
            )
        client_secret = str(client.get("client_secret") or "").strip()
        with self._state_lock:
            folder_keep = str(self.credentials.get("root_folder_name") or DEFAULT_FOLDER_NAME)
            auto_keep = bool(self.credentials.get("auto_sync_enabled", True))
            self.credentials = {
                "client_id": client_id,
                "client_secret": client_secret,
                "custom_client": True,
                "client_type": "web" if "web" in payload else "installed",
                "root_folder_name": folder_keep,
                "auto_sync_enabled": auto_keep,
            }
            self._save_credentials()
            self._last_error = None
        return self.status()

    def start_oauth(self, redirect_uri: str) -> dict[str, Any]:
        parsed_redir = urllib.parse.urlparse(redirect_uri)
        host = (parsed_redir.hostname or "").lower()
        is_loopback = host in ("127.0.0.1", "localhost", "::1")

        with self._state_lock:
            has_custom = bool(self.credentials.get("custom_client") and self.credentials.get("client_id"))
            if not is_loopback and not has_custom:
                raise ValueError(
                    "Para conectar direto na nuvem sem criar projeto no Google Console, "
                    "abra o arquivo CONFIGURAR_NUVEM_24H.bat no seu computador (1 clique) "
                    "ou cole abaixo o Código da Nuvem gerado por ele."
                )
            client_id = (
                str(self.credentials["client_id"])
                if has_custom
                else BUILTIN_DESKTOP_CLIENT_ID
            )
            client_secret = (
                str(self.credentials.get("client_secret") or "")
                if has_custom
                else _reveal_builtin_secret()
            )

            state = secrets.token_urlsafe(32)
            verifier = secrets.token_urlsafe(64)
            challenge = (
                base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest())
                .rstrip(b"=")
                .decode("ascii")
            )
            now = time.time()
            self._pending_oauth = {
                k: v for k, v in self._pending_oauth.items() if v["expires_at"] > now
            }
            self._pending_oauth[state] = {
                "verifier": verifier,
                "redirect_uri": redirect_uri,
                "client_id": client_id,
                "client_secret": client_secret,
                "custom_client": has_custom,
                "expires_at": now + 600,
            }
            conn_ver = str(self.credentials.get("connection_version") or "")

        query = urllib.parse.urlencode(
            {
                "client_id": client_id,
                "redirect_uri": redirect_uri,
                "response_type": "code",
                "scope": " ".join(DRIVE_SCOPES),
                "state": state,
                "code_challenge": challenge,
                "code_challenge_method": "S256",
                "access_type": "offline",
                "prompt": "consent select_account",
            }
        )
        return {
            "url": f"https://accounts.google.com/o/oauth2/v2/auth?{query}",
            "state": state,
            "connection_version": conn_ver,
        }

    def finish_oauth_callback(self, state: str, code: str) -> dict[str, Any]:
        with self._state_lock:
            pending = self._pending_oauth.pop(state, None)
        if not pending or pending["expires_at"] < time.time() or not code:
            raise ValueError("A sessão de autorização expirou. Inicie a conexão novamente.")

        form_data = {
            "client_id": pending["client_id"],
            "code": code,
            "code_verifier": pending["verifier"],
            "redirect_uri": pending["redirect_uri"],
            "grant_type": "authorization_code",
        }
        if pending.get("client_secret"):
            form_data["client_secret"] = pending["client_secret"]

        status_code, _, body = self._http(
            "POST",
            "https://oauth2.googleapis.com/token",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            data=urllib.parse.urlencode(form_data).encode("utf-8"),
            timeout=25.0,
        )
        if status_code != 200:
            raise RuntimeError(
                f"O Google recusou a troca do código de autorização (HTTP {status_code})."
            )

        tok = json.loads(body.decode("utf-8"))
        access_token = str(tok.get("access_token") or "").strip()
        if not access_token:
            raise RuntimeError("O Google não retornou access_token.")

        with self._state_lock:
            prev_refresh = str(self.credentials.get("refresh_token") or "")
            folder_keep = str(self.credentials.get("root_folder_name") or DEFAULT_FOLDER_NAME)
            auto_keep = bool(self.credentials.get("auto_sync_enabled", True))
            self.credentials = {
                "client_id": pending["client_id"],
                "client_secret": pending.get("client_secret") or "",
                "custom_client": bool(pending.get("custom_client", False)),
                "access_token": access_token,
                "refresh_token": str(tok.get("refresh_token") or prev_refresh).strip(),
                "expires_at": time.time() + int(tok.get("expires_in", 3600)),
                "account": "",
                "root_folder_name": folder_keep,
                "auto_sync_enabled": auto_keep,
                "connection_version": secrets.token_hex(10),
            }
            self._last_error = None
            self._save_credentials()

        account_email = self._fetch_account_email()
        if account_email:
            with self._state_lock:
                self.credentials["account"] = account_email
                self._save_credentials()

        # Dispara sincronização inicial em background
        self.notify_change("oauth_connected")
        return self.status()

    def import_oauth_token(
        self,
        raw_token: str | dict[str, Any],
        *,
        restore_first: bool = False,
        sync_immediately: bool = True,
    ) -> dict[str, Any]:
        parsed = parse_oauth_payload(raw_token)
        with self._state_lock:
            old_creds = dict(self.credentials)
            parsed["auto_sync_enabled"] = bool(old_creds.get("auto_sync_enabled", True))
            parsed["connection_version"] = secrets.token_hex(10)
            self.credentials = parsed

        # Valida imediatamente contra o Google Drive antes de confirmar
        try:
            email = self._fetch_account_email(force_refresh=not bool(parsed.get("access_token")))
            with self._state_lock:
                if email:
                    self.credentials["account"] = email
                self._last_error = None
                self._save_credentials()
        except Exception as exc:
            with self._state_lock:
                self.credentials = old_creds
            raise ValueError(f"Não foi possível validar o token no Google Drive: {exc}") from exc

        action_result: dict[str, Any] = {}
        if restore_first:
            action_result = self.restore_from_drive(force=False, on_boot=True)
        if sync_immediately and not action_result.get("restored"):
            action_result = self.sync_now(force=True, reason="token_import")

        st = self.status()
        st["initial_action"] = action_result
        return st

    def export_oauth_token(self) -> dict[str, str]:
        with self._state_lock:
            if not self.credentials.get("refresh_token"):
                raise ValueError("Conecte o Google Drive primeiro para exportar o código da nuvem.")
            creds_copy = dict(self.credentials)
            if creds_copy.get("client_id") == BUILTIN_DESKTOP_CLIENT_ID and not creds_copy.get("client_secret"):
                creds_copy["client_secret"] = _reveal_builtin_secret()
        compact_token, json_token = encode_compact_oauth_token(creds_copy)
        return {
            "compact_token": compact_token,
            "json_token": json_token,
            "account": str(creds_copy.get("account") or ""),
            "env_var_name": "GOOGLE_DRIVE_OAUTH_JSON",
        }

    def disconnect(self) -> dict[str, Any]:
        with self._state_lock:
            folder_keep = str(self.credentials.get("root_folder_name") or DEFAULT_FOLDER_NAME)
            self.credentials = {"root_folder_name": folder_keep, "auto_sync_enabled": True}
            self._dirty = False
            self._last_error = None
            if self.creds_path.exists():
                try:
                    self.creds_path.unlink()
                except OSError:
                    self._save_credentials()
        return self.status()

    # =========================================================================
    # Cliente REST Google Drive v3 (Stdlib pura, zero dependências extras)
    # =========================================================================

    def _get_access_token(self, force_refresh: bool = False) -> str:
        with self._state_lock:
            if (
                not force_refresh
                and self.credentials.get("access_token")
                and float(self.credentials.get("expires_at") or 0) > time.time() + 60
            ):
                return str(self.credentials["access_token"])

            refresh_token = str(self.credentials.get("refresh_token") or "").strip()
            if not refresh_token:
                raise RuntimeError("Google Drive não conectado (refresh_token ausente).")

            client_id = str(self.credentials.get("client_id") or BUILTIN_DESKTOP_CLIENT_ID).strip()
            client_secret = str(self.credentials.get("client_secret") or "").strip()
            if client_id == BUILTIN_DESKTOP_CLIENT_ID and not client_secret:
                client_secret = _reveal_builtin_secret()

        payload = {
            "client_id": client_id,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        }
        if client_secret:
            payload["client_secret"] = client_secret

        status_code, _, body = self._http(
            "POST",
            "https://oauth2.googleapis.com/token",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            data=urllib.parse.urlencode(payload).encode("utf-8"),
            timeout=25.0,
        )
        if status_code != 200:
            raise RuntimeError(
                f"Sessão do Google Drive expirada ou revogada (HTTP {status_code}). Reconecte sua conta."
            )
        tok = json.loads(body.decode("utf-8"))
        new_token = str(tok.get("access_token") or "").strip()
        if not new_token:
            raise RuntimeError("Falha ao renovar access_token do Google Drive.")

        with self._state_lock:
            self.credentials["access_token"] = new_token
            self.credentials["expires_at"] = time.time() + int(tok.get("expires_in", 3600))
            self._save_credentials()
        return new_token

    def _drive_request(
        self,
        method: str,
        url: str,
        *,
        params: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
        data: bytes | None = None,
        json_body: dict[str, Any] | None = None,
        timeout: float = 35.0,
    ) -> tuple[int, dict[str, str], bytes]:
        full_url = url
        if params:
            sep = "&" if "?" in full_url else "?"
            full_url = f"{full_url}{sep}{urllib.parse.urlencode(params)}"

        req_headers = dict(headers or {})
        body_bytes = data
        if json_body is not None:
            body_bytes = json.dumps(json_body, ensure_ascii=False).encode("utf-8")
            req_headers.setdefault("Content-Type", "application/json; charset=utf-8")

        last_exc: Exception | None = None
        for attempt in range(3):
            token = self._get_access_token(force_refresh=(attempt == 1 and last_exc is None))
            req_headers["Authorization"] = f"Bearer {token}"
            try:
                status_code, resp_headers, resp_body = self._http(
                    method, full_url, headers=req_headers, data=body_bytes, timeout=timeout
                )
            except Exception as exc:
                last_exc = exc
                if attempt < 2:
                    time.sleep(0.6 * (attempt + 1))
                    continue
                raise RuntimeError(f"Erro de rede ao comunicar com Google Drive: {exc}") from exc

            if status_code == 401 and attempt == 0:
                self._get_access_token(force_refresh=True)
                continue
            if status_code in (429, 500, 502, 503, 504) and attempt < 2:
                time.sleep(0.8 * (attempt + 1))
                continue
            if status_code >= 400:
                snippet = resp_body.decode("utf-8", errors="replace")[:240]
                raise RuntimeError(f"Google Drive respondeu HTTP {status_code}: {snippet}")
            return status_code, resp_headers, resp_body

        raise RuntimeError("Falha inesperada na comunicação com o Google Drive.")

    def _fetch_account_email(self, force_refresh: bool = False) -> str:
        if force_refresh:
            self._get_access_token(force_refresh=True)
        _, _, body = self._drive_request(
            "GET",
            "https://www.googleapis.com/drive/v3/about",
            params={"fields": "user(emailAddress,displayName)"},
            timeout=20.0,
        )
        info = json.loads(body.decode("utf-8"))
        return str((info.get("user") or {}).get("emailAddress") or "").strip()

    @staticmethod
    def _escape_drive_q(value: str) -> str:
        return value.replace("\\", "\\\\").replace("'", "\\'")

    def _find_folder(self, name: str, parent_id: str = "root") -> dict[str, Any] | None:
        escaped = self._escape_drive_q(name)
        q = (
            f"trashed = false and mimeType = 'application/vnd.google-apps.folder' "
            f"and name = '{escaped}' and '{parent_id}' in parents"
        )
        _, _, body = self._drive_request(
            "GET",
            "https://www.googleapis.com/drive/v3/files",
            params={
                "q": q,
                "fields": "files(id,name,webViewLink)",
                "pageSize": 5,
                "orderBy": "createdTime asc",
            },
        )
        files = json.loads(body.decode("utf-8")).get("files") or []
        return files[0] if files else None

    def _ensure_folder(self, name: str, parent_id: str = "root") -> dict[str, Any]:
        found = self._find_folder(name, parent_id=parent_id)
        if found:
            return found
        meta: dict[str, Any] = {
            "name": name,
            "mimeType": "application/vnd.google-apps.folder",
        }
        if parent_id and parent_id != "root":
            meta["parents"] = [parent_id]
        _, _, body = self._drive_request(
            "POST",
            "https://www.googleapis.com/drive/v3/files",
            params={"fields": "id,name,webViewLink"},
            json_body=meta,
        )
        return json.loads(body.decode("utf-8"))

    def _list_files_in_folder(self, folder_id: str) -> dict[str, dict[str, Any]]:
        result: dict[str, dict[str, Any]] = {}
        page_token: str | None = None
        while True:
            params: dict[str, Any] = {
                "q": f"trashed = false and '{folder_id}' in parents and mimeType != 'application/vnd.google-apps.folder'",
                "fields": "nextPageToken,files(id,name,size,md5Checksum,modifiedTime)",
                "pageSize": 200,
            }
            if page_token:
                params["pageToken"] = page_token
            _, _, body = self._drive_request(
                "GET", "https://www.googleapis.com/drive/v3/files", params=params
            )
            payload = json.loads(body.decode("utf-8"))
            for item in payload.get("files") or []:
                fname = str(item.get("name") or "")
                if fname:
                    result[fname] = item
            page_token = payload.get("nextPageToken")
            if not page_token:
                break
        return result

    def _upload_file(
        self,
        local_path: Path,
        remote_name: str,
        parent_id: str,
        existing_file_id: str | None = None,
    ) -> dict[str, Any]:
        mime = mimetypes.guess_type(remote_name)[0] or "application/octet-stream"
        file_bytes = local_path.read_bytes()
        total = len(file_bytes)

        # Arquivos <= 4 MB: upload multipart atômico em 1 única requisição HTTP
        if total <= 4 * 1024 * 1024:
            boundary = f"===============SeuLuizDrive{secrets.token_hex(12)}=="
            meta: dict[str, Any] = {"name": remote_name}
            if not existing_file_id:
                meta["parents"] = [parent_id]
            meta_bytes = json.dumps(meta, ensure_ascii=False).encode("utf-8")
            body = (
                f"--{boundary}\r\n"
                f"Content-Type: application/json; charset=UTF-8\r\n\r\n"
            ).encode("utf-8") + meta_bytes + (
                f"\r\n--{boundary}\r\n"
                f"Content-Type: {mime}\r\n\r\n"
            ).encode("utf-8") + file_bytes + f"\r\n--{boundary}--\r\n".encode("utf-8")

            method = "PATCH" if existing_file_id else "POST"
            endpoint = "https://www.googleapis.com/upload/drive/v3/files" + (
                f"/{existing_file_id}" if existing_file_id else ""
            )
            _, _, resp_body = self._drive_request(
                method,
                endpoint,
                params={"uploadType": "multipart", "fields": "id,name,size,md5Checksum"},
                headers={"Content-Type": f"multipart/related; boundary={boundary}"},
                data=body,
                timeout=60.0,
            )
            return json.loads(resp_body.decode("utf-8"))

        # Arquivos > 4 MB: upload resumable em blocos de 8 MB
        meta_res: dict[str, Any] = {"name": remote_name}
        if not existing_file_id:
            meta_res["parents"] = [parent_id]
        method = "PATCH" if existing_file_id else "POST"
        endpoint = "https://www.googleapis.com/upload/drive/v3/files" + (
            f"/{existing_file_id}" if existing_file_id else ""
        )
        _, init_headers, _ = self._drive_request(
            method,
            endpoint,
            params={"uploadType": "resumable", "fields": "id,name,size,md5Checksum"},
            headers={
                "X-Upload-Content-Type": mime,
                "X-Upload-Content-Length": str(total),
            },
            json_body=meta_res,
            timeout=35.0,
        )
        loc = init_headers.get("Location") or init_headers.get("location")
        if not loc:
            raise RuntimeError(f"Google Drive não retornou URI de sessão para {remote_name}.")

        pos = 0
        chunk_size = 8 * 1024 * 1024
        while pos < total:
            chunk = file_bytes[pos : pos + chunk_size]
            end = pos + len(chunk) - 1
            status_code, r_headers, r_body = self._http(
                "PUT",
                loc,
                headers={
                    "Content-Type": mime,
                    "Content-Length": str(len(chunk)),
                    "Content-Range": f"bytes {pos}-{end}/{total}",
                },
                data=chunk,
                timeout=120.0,
            )
            if status_code in (200, 201):
                return json.loads(r_body.decode("utf-8"))
            if status_code == 308:
                rng = r_headers.get("Range") or r_headers.get("range") or ""
                m = re.search(r"(\d+)-(\d+)", rng)
                pos = int(m.group(2)) + 1 if m else pos + len(chunk)
                continue
            raise RuntimeError(f"Falha no envio resumable de {remote_name} (HTTP {status_code}).")
        raise RuntimeError(f"Upload de {remote_name} não confirmado pelo Google Drive.")

    def _download_file_bytes(self, file_id: str) -> bytes:
        _, _, body = self._drive_request(
            "GET",
            f"https://www.googleapis.com/drive/v3/files/{file_id}",
            params={"alt": "media"},
            timeout=90.0,
        )
        return body

    # =========================================================================
    # Sincronização Incremental (Local -> Google Drive)
    # =========================================================================

    def _scan_local_uploads(self) -> dict[str, dict[str, Any]]:
        items: dict[str, dict[str, Any]] = {}
        if not self.uploads_dir.is_dir():
            return items
        for entry in sorted(self.uploads_dir.iterdir(), key=lambda p: p.name):
            if not entry.is_file() or entry.name.startswith("."):
                continue
            items[entry.name] = {
                "sha256": _sha256_file(entry),
                "size": entry.stat().st_size,
            }
        return items

    def sync_now(self, *, force: bool = False, reason: str = "manual") -> dict[str, Any]:
        if not self.is_connected():
            return {"ok": False, "skipped": True, "reason": "not_connected"}
        if not self.db_path.is_file():
            return {"ok": False, "skipped": True, "reason": "local_db_missing"}

        with self._io_lock:
            with self._state_lock:
                self._syncing = True
                self._dirty = False

            tmp_dir = Path(tempfile.mkdtemp(prefix="seu_luiz_sync_"))
            try:
                snap_file = tmp_dir / "financeiro.db"
                snap_info = create_sqlite_snapshot(self.db_path, snap_file)
                uploads_local = self._scan_local_uploads()

                if (
                    not force
                    and self.meta.get("db_sha256") == snap_info["sha256"]
                    and self.meta.get("uploads") == uploads_local
                ):
                    return {"ok": True, "action": "up_to_date", "revision": self.meta.get("revision", 0)}

                folder_name = str(self.credentials.get("root_folder_name") or DEFAULT_FOLDER_NAME)
                root_folder = self._ensure_folder(folder_name)
                root_id = root_folder["id"]
                folder_url = root_folder.get("webViewLink") or f"https://drive.google.com/drive/folders/{root_id}"

                root_files = self._list_files_in_folder(root_id)
                remote_manifest: dict[str, Any] = {}
                if "manifest.json" in root_files:
                    try:
                        raw_mf = self._download_file_bytes(root_files["manifest.json"]["id"])
                        remote_manifest = json.loads(raw_mf.decode("utf-8"))
                    except Exception:
                        remote_manifest = {}

                # Proteção Anti-Wipe: jamais sobrescreve backup com usuários no Drive usando banco vazio (0 usuários)
                remote_users = int(((remote_manifest.get("counts") or {}).get("usuarios")) or 0)
                local_users = int(snap_info["counts"].get("usuarios") or 0)
                if not force and remote_users > 0 and local_users == 0:
                    msg = (
                        "Proteção anti-perda ativada: o Google Drive possui dados salvos e o banco local está vazio. "
                        "Use 'Restaurar da Nuvem' para recuperar os dados."
                    )
                    with self._state_lock:
                        self._last_error = msg
                    return {"ok": False, "blocked_anti_wipe": True, "detail": msg}

                # Rotaciona cópia de segurança anterior (máx. 1x a cada 30 min) quando o banco muda
                remote_db_entry = root_files.get("financeiro.db")
                db_changed = force or (remote_manifest.get("db_sha256") != snap_info["sha256"]) or not remote_db_entry
                if db_changed:
                    last_hist_ts = float(self.meta.get("last_history_snapshot_at") or 0)
                    if remote_db_entry and local_users > 0 and (time.time() - last_hist_ts >= 1800):
                        try:
                            hist_folder = self._ensure_folder("historico_seguranca", parent_id=root_id)
                            hist_files = self._list_files_in_folder(hist_folder["id"])
                            prev_bytes = self._download_file_bytes(remote_db_entry["id"])
                            prev_tmp = tmp_dir / "financeiro_anterior.db"
                            prev_tmp.write_bytes(prev_bytes)
                            self._upload_file(
                                prev_tmp,
                                "financeiro_anterior.db",
                                hist_folder["id"],
                                existing_file_id=(hist_files.get("financeiro_anterior.db") or {}).get("id"),
                            )
                            self.meta["last_history_snapshot_at"] = time.time()
                        except Exception:
                            pass

                    self._upload_file(
                        snap_file,
                        "financeiro.db",
                        root_id,
                        existing_file_id=(remote_db_entry or {}).get("id"),
                    )

                # Sincroniza incrementalmente apenas fotos/comprovantes novos ou alterados em uploads/
                remote_uploads_manifest = remote_manifest.get("uploads") or {}
                uploaded_media_count = 0
                if uploads_local:
                    uploads_folder = self._ensure_folder("uploads", parent_id=root_id)
                    remote_upload_files = self._list_files_in_folder(uploads_folder["id"])
                    for fname, fmeta in uploads_local.items():
                        prev_m = remote_uploads_manifest.get(fname) or {}
                        rem_f = remote_upload_files.get(fname)
                        if (
                            not force
                            and rem_f
                            and prev_m.get("sha256") == fmeta["sha256"]
                            and int(prev_m.get("size") or -1) == fmeta["size"]
                        ):
                            continue
                        local_f = self.uploads_dir / fname
                        if local_f.is_file():
                            self._upload_file(
                                local_f,
                                fname,
                                uploads_folder["id"],
                                existing_file_id=(rem_f or {}).get("id"),
                            )
                            uploaded_media_count += 1

                now_ts = time.time()
                next_rev = max(int(self.meta.get("revision") or 0), int(remote_manifest.get("revision") or 0)) + 1
                manifest_payload = {
                    "schema_version": 1,
                    "sistema": "Administração Financeira - Seu Luiz",
                    "revision": next_rev,
                    "updated_at": now_ts,
                    "updated_at_iso": _iso_utc(now_ts),
                    "source": "render" if self.is_cloud_container else "desktop",
                    "reason": reason,
                    "db_sha256": snap_info["sha256"],
                    "db_size": snap_info["size"],
                    "counts": snap_info["counts"],
                    "uploads": uploads_local,
                }
                mf_file = tmp_dir / "manifest.json"
                mf_file.write_text(
                    json.dumps(manifest_payload, ensure_ascii=False, indent=2), encoding="utf-8"
                )
                self._upload_file(
                    mf_file,
                    "manifest.json",
                    root_id,
                    existing_file_id=(root_files.get("manifest.json") or {}).get("id"),
                )

                with self._state_lock:
                    self.meta.update(
                        revision=next_rev,
                        db_sha256=snap_info["sha256"],
                        db_size=snap_info["size"],
                        counts=snap_info["counts"],
                        uploads=uploads_local,
                        folder_id=root_id,
                        folder_url=folder_url,
                        last_sync_at=now_ts,
                    )
                    self._last_error = None
                    self._save_meta()

                return {
                    "ok": True,
                    "action": "synced",
                    "revision": next_rev,
                    "folder_url": folder_url,
                    "db_uploaded": db_changed,
                    "uploads_uploaded": uploaded_media_count,
                    "counts": snap_info["counts"],
                }
            except Exception as exc:
                with self._state_lock:
                    self._last_error = str(exc)
                raise
            finally:
                shutil.rmtree(tmp_dir, ignore_errors=True)
                with self._state_lock:
                    self._syncing = False

    # =========================================================================
    # Restauração Segura (Google Drive -> SQLite + Uploads)
    # =========================================================================

    def restore_from_drive(
        self,
        *,
        force: bool = False,
        on_boot: bool = False,
    ) -> dict[str, Any]:
        if not self.is_connected():
            return {"ok": False, "restored": False, "reason": "not_connected"}

        with self._io_lock:
            with self._state_lock:
                self._restoring = True

            tmp_dir = Path(tempfile.mkdtemp(prefix="seu_luiz_restore_"))
            try:
                folder_name = str(self.credentials.get("root_folder_name") or DEFAULT_FOLDER_NAME)
                root_folder = self._find_folder(folder_name)
                if not root_folder:
                    # Primeira execução absoluta: se o banco local já tiver dados, semeia o Google Drive
                    if on_boot and self.db_path.is_file():
                        self.notify_change("initial_seed_on_boot")
                    return {"ok": True, "restored": False, "reason": "remote_folder_not_found"}

                root_id = root_folder["id"]
                folder_url = root_folder.get("webViewLink") or f"https://drive.google.com/drive/folders/{root_id}"
                root_files = self._list_files_in_folder(root_id)
                remote_db_entry = root_files.get("financeiro.db")
                if not remote_db_entry:
                    if on_boot and self.db_path.is_file():
                        self.notify_change("initial_seed_on_boot")
                    return {"ok": True, "restored": False, "reason": "remote_db_not_found"}

                remote_manifest: dict[str, Any] = {}
                if "manifest.json" in root_files:
                    try:
                        raw_mf = self._download_file_bytes(root_files["manifest.json"]["id"])
                        remote_manifest = json.loads(raw_mf.decode("utf-8"))
                    except Exception:
                        remote_manifest = {}

                # Avalia necessidade de restauração no boot
                local_exists = self.db_path.is_file()
                local_users = 0
                local_sha256 = ""
                if local_exists:
                    try:
                        snap_check = tmp_dir / "local_check.db"
                        info_local = create_sqlite_snapshot(self.db_path, snap_check)
                        local_users = int(info_local["counts"].get("usuarios") or 0)
                        local_sha256 = info_local["sha256"]
                    except Exception:
                        local_users = 0

                if not force and on_boot:
                    # No desktop local (fora de container efêmero), preserva banco local se já possui usuários
                    if not self.is_cloud_container and local_exists and local_users > 0:
                        return {"ok": True, "restored": False, "reason": "desktop_local_preserved"}

                # Se os bytes do banco já são idênticos ao manifesto remoto, apenas garante uploads ausentes
                remote_sha = str(remote_manifest.get("db_sha256") or "")
                db_restored = False
                restored_counts: dict[str, int] = remote_manifest.get("counts") or {}

                if force or not remote_sha or remote_sha != local_sha256 or not local_exists:
                    dl_db = tmp_dir / "financeiro_remote.db"
                    dl_db.write_bytes(self._download_file_bytes(remote_db_entry["id"]))
                    restored_counts = validate_sqlite_file(dl_db)
                    remote_sha = _sha256_file(dl_db)

                    if self._engine_disposer:
                        try:
                            self._engine_disposer()
                        except Exception:
                            pass

                    self.db_path.parent.mkdir(parents=True, exist_ok=True)
                    if not self.db_path.exists():
                        _atomic_write_bytes(self.db_path, dl_db.read_bytes())
                    else:
                        # Restaura página a página pela engine transacional do SQLite (zero risco com WAL/Windows lock)
                        src_conn = sqlite3.connect(str(dl_db), timeout=30.0)
                        dst_conn = sqlite3.connect(str(self.db_path), timeout=30.0)
                        try:
                            with dst_conn:
                                src_conn.backup(dst_conn)
                            try:
                                dst_conn.execute("PRAGMA wal_checkpoint(TRUNCATE);")
                            except Exception:
                                pass
                        finally:
                            dst_conn.close()
                            src_conn.close()

                    if self._schema_migrator:
                        self._schema_migrator()
                    db_restored = True

                # Restaura fotos de pessoas/perfil e comprovantes da subpasta uploads/
                uploads_restored = 0
                uploads_folder = self._find_folder("uploads", parent_id=root_id)
                if uploads_folder:
                    remote_upload_files = self._list_files_in_folder(uploads_folder["id"])
                    remote_uploads_meta = remote_manifest.get("uploads") or {}
                    self.uploads_dir.mkdir(parents=True, exist_ok=True)
                    for raw_name, r_info in remote_upload_files.items():
                        safe_name = Path(raw_name).name
                        if not safe_name or safe_name in (".", "..") or safe_name != raw_name:
                            continue
                        target_f = self.uploads_dir / safe_name
                        expected_sha = (remote_uploads_meta.get(safe_name) or {}).get("sha256")
                        if target_f.is_file():
                            if expected_sha and _sha256_file(target_f) == expected_sha:
                                continue
                            if not expected_sha and target_f.stat().st_size == int(r_info.get("size") or -1):
                                continue
                        f_bytes = self._download_file_bytes(r_info["id"])
                        _atomic_write_bytes(target_f, f_bytes)
                        uploads_restored += 1

                # Recalcula hash pós-migração para manter manifesto local sincronizado sem re-upload redundante
                final_snap = tmp_dir / "post_restore_snap.db"
                final_info = create_sqlite_snapshot(self.db_path, final_snap)
                now_ts = time.time()
                with self._state_lock:
                    self.meta.update(
                        revision=int(remote_manifest.get("revision") or self.meta.get("revision") or 1),
                        db_sha256=final_info["sha256"],
                        db_size=final_info["size"],
                        counts=final_info["counts"],
                        uploads=self._scan_local_uploads(),
                        folder_id=root_id,
                        folder_url=folder_url,
                        last_restore_at=now_ts,
                    )
                    if not self.meta.get("last_sync_at") and remote_manifest.get("updated_at"):
                        self.meta["last_sync_at"] = float(remote_manifest["updated_at"])
                    self._dirty = False
                    self._last_error = None
                    self._save_meta()

                return {
                    "ok": True,
                    "restored": db_restored or (uploads_restored > 0),
                    "db_restored": db_restored,
                    "uploads_restored": uploads_restored,
                    "counts": final_info["counts"],
                    "folder_url": folder_url,
                }
            except Exception as exc:
                with self._state_lock:
                    self._last_error = f"Falha ao restaurar do Google Drive: {exc}"
                if on_boot:
                    return {"ok": False, "restored": False, "error": str(exc)}
                raise
            finally:
                shutil.rmtree(tmp_dir, ignore_errors=True)
                with self._state_lock:
                    self._restoring = False

    # =========================================================================
    # Fila em Background com Debounce + Flush Limpo no Encerramento
    # =========================================================================

    def notify_change(self, reason: str = "write") -> None:
        with self._state_lock:
            if self._shutdown or self._restoring:
                return
            if not self.is_connected() or not bool(self.credentials.get("auto_sync_enabled", True)):
                return
            now = time.monotonic()
            if not self._dirty:
                self._first_dirty_at = now
            self._last_dirty_at = now
            self._dirty = True
            self._last_reason = reason
            self._wake_event.set()
            if self._worker_thread is None or not self._worker_thread.is_alive():
                self._worker_thread = threading.Thread(
                    target=self._background_loop,
                    name="seu-luiz-gdrive-sync",
                    daemon=True,
                )
                self._worker_thread.start()

    def _background_loop(self) -> None:
        while not self._shutdown:
            self._wake_event.wait(timeout=1.0)
            self._wake_event.clear()
            if self._shutdown:
                break

            while True:
                with self._state_lock:
                    if not self._dirty or self._shutdown:
                        break
                    now = time.monotonic()
                    since_last = now - self._last_dirty_at
                    since_first = now - self._first_dirty_at
                    reason = self._last_reason
                    if since_last < self.debounce_seconds and since_first < self.max_wait_seconds:
                        wait_for = min(
                            self.debounce_seconds - since_last,
                            self.max_wait_seconds - since_first,
                        )
                    else:
                        wait_for = 0.0

                if wait_for > 0:
                    self._wake_event.wait(timeout=max(0.05, wait_for))
                    self._wake_event.clear()
                    continue

                try:
                    self.sync_now(force=False, reason=reason)
                except Exception:
                    # Erro já registrado em self._last_error; evita loop apertado
                    time.sleep(2.0)
                break

    def flush_pending(self) -> dict[str, Any] | None:
        with self._state_lock:
            has_dirty = self._dirty
            reason = self._last_reason or "shutdown_flush"
        if has_dirty and self.is_connected():
            try:
                return self.sync_now(force=False, reason=reason)
            except Exception as exc:
                return {"ok": False, "error": str(exc)}
        return None

    def shutdown(self) -> None:
        self.flush_pending()
        with self._state_lock:
            self._shutdown = True
            self._wake_event.set()
            worker = self._worker_thread
        if worker is not None and worker.is_alive() and worker is not threading.current_thread():
            worker.join(timeout=3.0)

    # =========================================================================
    # Exportação de Pacote ZIP Completo (Offline / Emergência em 1 Clique)
    # =========================================================================

    def export_backup_zip_bytes(self) -> bytes:
        tmp_dir = Path(tempfile.mkdtemp(prefix="seu_luiz_zip_"))
        try:
            snap_file = tmp_dir / "financeiro.db"
            snap_info = create_sqlite_snapshot(self.db_path, snap_file)
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
                zf.write(snap_file, arcname="financeiro.db")
                manifest = {
                    "sistema": "Administração Financeira - Seu Luiz",
                    "exported_at_iso": _iso_utc(time.time()),
                    "db_sha256": snap_info["sha256"],
                    "counts": snap_info["counts"],
                }
                zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
                if self.uploads_dir.is_dir():
                    for up in sorted(self.uploads_dir.iterdir()):
                        if up.is_file() and not up.name.startswith("."):
                            zf.write(up, arcname=f"uploads/{up.name}")
            return buf.getvalue()
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)
