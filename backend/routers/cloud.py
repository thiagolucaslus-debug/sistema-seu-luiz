from __future__ import annotations

import hashlib
import hmac
import os
import re
import sqlite3
from datetime import datetime
from html import escape
from typing import Any, Optional

from fastapi import APIRouter, Body, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel
from sqlalchemy.orm import object_session

import auth
import models
from services.cloud_sync import CloudSyncManager

router = APIRouter(prefix="/cloud", tags=["cloud"])

# Compromisso criptográfico unidirecional (SHA-256) para hidratação automática segura pelo GitHub Actions
DEFAULT_VAULT_HYDRATE_SHA256 = "acbadc614164fd8b0089d5435a96b69a88a9e19adb5c788d8eaad0ea5354c62b"

_manager_instance: CloudSyncManager | None = None


def set_cloud_manager(manager: CloudSyncManager) -> None:
    global _manager_instance
    _manager_instance = manager


def get_cloud_manager() -> CloudSyncManager:
    if _manager_instance is None:
        raise RuntimeError("CloudSyncManager ainda não foi inicializado.")
    return _manager_instance


class TokenImportRequest(BaseModel):
    token: str
    restore_first: bool = False
    sync_immediately: bool = True


class RestoreRequest(BaseModel):
    force: bool = True


class VaultHydrateRequest(BaseModel):
    hydrate_secret: str
    github_token: str
    repo: str
    aes_key: str
    branch: str = "main"


def _resolve_redirect_uri(request: Request) -> str:
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    return f"{proto}://{host}/cloud/oauth/callback"


def _oauth_result_html(ok: bool, title: str, message: str) -> HTMLResponse:
    accent = "#15825b" if ok else "#c32341"
    badge = "Conectado com sucesso" if ok else "Autorização não concluída"
    html = f"""<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{escape(title)} — Administração Financeira</title>
  <style>
    body {{
      margin: 0; min-height: 100vh; display: grid; place-items: center;
      font-family: Inter, system-ui, -apple-system, sans-serif;
      background: #10151d; color: #f3f6fb; padding: 24px;
    }}
    .box {{
      max-width: 440px; width: 100%; background: #1a202b; border: 1px solid #343e4d;
      border-radius: 18px; padding: 28px; box-shadow: 0 20px 48px rgba(0,0,0,.45);
      text-align: center;
    }}
    .pill {{
      display: inline-block; padding: 5px 12px; border-radius: 999px;
      font-size: 12px; font-weight: 700; background: {accent}22; color: {accent};
      border: 1px solid {accent}55; margin-bottom: 14px;
    }}
    h1 {{ margin: 0 0 10px; font-size: 20px; }}
    p {{ margin: 0 0 20px; color: #aab4c3; font-size: 14px; line-height: 1.5; }}
    button, a {{
      display: inline-block; background: #2563eb; color: #fff; text-decoration: none;
      border: 0; border-radius: 10px; padding: 10px 18px; font-weight: 600; cursor: pointer;
    }}
  </style>
</head>
<body>
  <main class="box">
    <span class="pill">{escape(badge)}</span>
    <h1>{escape(title)}</h1>
    <p>{escape(message)}</p>
    <button type="button" onclick="window.close(); window.location.href='/configuracoes';">Voltar ao Painel</button>
  </main>
  <script>
    if ({'true' if ok else 'false'}) {{
      setTimeout(() => {{
        try {{ window.close(); }} catch (e) {{}}
      }}, 1400);
    }}
  </script>
</body>
</html>"""
    return HTMLResponse(
        content=html,
        status_code=200 if ok else 400,
        headers={"Cache-Control": "no-store", "X-Frame-Options": "DENY"},
    )


def _is_primary_owner(usuario: models.Usuario, mgr: CloudSyncManager) -> bool:
    if not mgr.db_path.is_file():
        return True
    conn = sqlite3.connect(str(mgr.db_path), timeout=10.0)
    try:
        row = conn.execute("SELECT id FROM usuarios ORDER BY id ASC LIMIT 1").fetchone()
        if not row:
            return True
        return int(row[0]) == int(usuario.id)
    except Exception:
        return False
    finally:
        conn.close()


def _require_primary_owner(usuario: models.Usuario, mgr: CloudSyncManager) -> None:
    if not _is_primary_owner(usuario, mgr):
        raise HTTPException(
            status_code=403,
            detail="Apenas o administrador principal pode alterar ou desconectar a configuração global de nuvem.",
        )


def _user_scoped_counts(usuario_id: int, mgr: CloudSyncManager) -> tuple[dict[str, int], int]:
    counts = {"usuarios": 1}
    if not mgr.db_path.is_file():
        return counts, 0
    conn = sqlite3.connect(str(mgr.db_path), timeout=10.0)
    try:
        tables = {
            r[0]
            for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        }
        for tbl in (
            "contas_bancarias",
            "cartoes",
            "pessoas",
            "modulos",
            "lancamentos",
            "pagamentos_pessoa",
            "pagamentos_fatura",
            "solicitacoes_lancamento",
            "dividas",
            "divida_parcelas",
        ):
            if tbl in tables:
                cols = {r[1] for r in conn.execute(f"PRAGMA table_info({tbl})").fetchall()}
                if "usuario_id" in cols:
                    counts[tbl] = int(
                        conn.execute(
                            f"SELECT COUNT(*) FROM {tbl} WHERE usuario_id = ?", (int(usuario_id),)
                        ).fetchone()[0]
                    )
        if "subcategorias" in tables and "modulos" in tables:
            counts["subcategorias"] = int(
                conn.execute(
                    "SELECT COUNT(*) FROM subcategorias WHERE modulo_id IN (SELECT id FROM modulos WHERE usuario_id = ?)",
                    (int(usuario_id),),
                ).fetchone()[0]
            )
        if "parcelas" in tables and "lancamentos" in tables:
            counts["parcelas"] = int(
                conn.execute(
                    "SELECT COUNT(*) FROM parcelas WHERE lancamento_id IN (SELECT id FROM lancamentos WHERE usuario_id = ?)",
                    (int(usuario_id),),
                ).fetchone()[0]
            )
        rels: set[str] = set()
        for tbl, col, wh in (
            ("usuarios", "logo_path", "id = ?"),
            ("pessoas", "foto_path", "usuario_id = ?"),
            ("modulos", "foto_path", "usuario_id = ?"),
            ("lancamentos", "comprovante_path", "usuario_id = ?"),
            ("solicitacoes_lancamento", "comprovante_path", "usuario_id = ?"),
        ):
            if tbl in tables:
                cols = {r[1] for r in conn.execute(f"PRAGMA table_info({tbl})").fetchall()}
                if col in cols:
                    for (val,) in conn.execute(
                        f"SELECT {col} FROM {tbl} WHERE {wh} AND {col} IS NOT NULL",
                        (int(usuario_id),),
                    ).fetchall():
                        if isinstance(val, str) and val.strip():
                            rels.add(val.strip())
        return counts, len(rels)
    except Exception:
        return counts, 0
    finally:
        conn.close()


def _scoped_status_for_user(usuario: models.Usuario, mgr: CloudSyncManager) -> dict[str, Any]:
    st = mgr.status()
    if _is_primary_owner(usuario, mgr):
        st["is_primary_owner"] = True
        return st
    user_counts, user_uploads = _user_scoped_counts(usuario.id, mgr)
    st["is_primary_owner"] = False
    st["account"] = "Nuvem Automática 24/7 (Perfil Isolado)" if st.get("connected") else ""
    st["folder_url"] = ""
    st["counts"] = user_counts
    st["uploads_synced_count"] = user_uploads
    return st


@router.get("/status")
def obter_status_nuvem(
    usuario: models.Usuario = Depends(auth.get_usuario_atual),
    mgr: CloudSyncManager = Depends(get_cloud_manager),
):
    return _scoped_status_for_user(usuario, mgr)


@router.post("/configure-client")
def configurar_cliente_oauth(
    payload: dict[str, Any] = Body(...),
    usuario: models.Usuario = Depends(auth.get_usuario_atual),
    mgr: CloudSyncManager = Depends(get_cloud_manager),
):
    _require_primary_owner(usuario, mgr)
    try:
        return mgr.configure_custom_client(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/oauth/authorize")
def iniciar_autorizacao_google(
    request: Request,
    usuario: models.Usuario = Depends(auth.get_usuario_atual),
    mgr: CloudSyncManager = Depends(get_cloud_manager),
):
    _require_primary_owner(usuario, mgr)
    try:
        redirect_uri = _resolve_redirect_uri(request)
        return mgr.start_oauth(redirect_uri=redirect_uri)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/oauth/callback")
def concluir_autorizacao_google(
    state: Optional[str] = Query(default=None),
    code: Optional[str] = Query(default=None),
    error: Optional[str] = Query(default=None),
    mgr: CloudSyncManager = Depends(get_cloud_manager),
):
    if error:
        return _oauth_result_html(
            False,
            "Autorização cancelada",
            "O login no Google foi cancelado. Você pode tentar novamente nas Configurações do sistema.",
        )
    if not state or not code:
        return _oauth_result_html(
            False,
            "Parâmetros ausentes",
            "Não recebemos o código de confirmação do Google. Inicie a conexão novamente pelo painel.",
        )
    try:
        st = mgr.finish_oauth_callback(state=state, code=code)
        conta = st.get("account") or "Conta Google vinculada"
        return _oauth_result_html(
            True,
            "Google Drive Conectado!",
            f"{conta} vinculada com sucesso. O salvamento automático já está ativo. Esta aba fechará sozinha.",
        )
    except Exception as exc:
        return _oauth_result_html(False, "Falha ao conectar Google Drive", str(exc))


def _release_user_session(usuario: models.Usuario) -> None:
    """Libera a conexão SQLite da requisição atual antes de restaurar/checkpointar o WAL."""
    sess = object_session(usuario)
    if sess is not None:
        try:
            sess.expunge_all()
            sess.close()
        except Exception:
            pass


def _issue_refreshed_token_after_restore(
    mgr: CloudSyncManager, preferred_email: str
) -> str | None:
    """Reemite JWT compatível com o hash do banco restaurado para manter a sessão ativa sem relogin."""
    if not mgr.db_path.is_file():
        return None
    conn = sqlite3.connect(str(mgr.db_path), timeout=10.0)
    try:
        row = conn.execute(
            "SELECT email, senha_hash FROM usuarios WHERE email = ? LIMIT 1",
            (preferred_email,),
        ).fetchone()
        if row is None:
            all_rows = conn.execute("SELECT email, senha_hash FROM usuarios LIMIT 2").fetchall()
            if len(all_rows) == 1:
                row = all_rows[0]
        if not row:
            return None
        detached_user = models.Usuario(email=row[0], senha_hash=row[1])
        return auth.criar_token(detached_user)
    except Exception:
        return None
    finally:
        conn.close()


@router.post("/token")
def importar_token_nuvem(
    req: TokenImportRequest,
    usuario: models.Usuario = Depends(auth.get_usuario_atual),
    mgr: CloudSyncManager = Depends(get_cloud_manager),
):
    _require_primary_owner(usuario, mgr)
    user_email = str(usuario.email or "")
    _release_user_session(usuario)
    try:
        res = mgr.import_oauth_token(
            req.token,
            restore_first=req.restore_first,
            sync_immediately=req.sync_immediately,
        )
        if req.restore_first:
            new_tok = _issue_refreshed_token_after_restore(mgr, user_email)
            if new_tok:
                res["access_token"] = new_tok
        return res
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Falha ao comunicar com Google Drive: {exc}") from exc


@router.get("/export-token")
def exportar_token_nuvem(
    usuario: models.Usuario = Depends(auth.get_usuario_atual),
    mgr: CloudSyncManager = Depends(get_cloud_manager),
):
    _require_primary_owner(usuario, mgr)
    try:
        return mgr.export_oauth_token()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/sync")
def sincronizar_agora(
    usuario: models.Usuario = Depends(auth.get_usuario_atual),
    mgr: CloudSyncManager = Depends(get_cloud_manager),
):
    if not mgr.is_connected():
        raise HTTPException(
            status_code=400,
            detail="Conecte sua conta de nuvem antes de enviar o backup.",
        )
    user_id = int(usuario.id)
    user_email = str(usuario.email or "")
    try:
        result = mgr.sync_now(force=True, reason=f"manual_{user_email}")
        detached = models.Usuario(id=user_id, email=user_email)
        status_now = _scoped_status_for_user(detached, mgr)
        status_now["sync_result"] = result
        return status_now
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Falha ao salvar na nuvem: {exc}") from exc


@router.post("/restore")
def restaurar_agora(
    req: RestoreRequest = Body(default=RestoreRequest()),
    usuario: models.Usuario = Depends(auth.get_usuario_atual),
    mgr: CloudSyncManager = Depends(get_cloud_manager),
):
    _require_primary_owner(usuario, mgr)
    if not mgr.is_connected():
        raise HTTPException(
            status_code=400,
            detail="Conecte sua conta Google Drive antes de restaurar o backup.",
        )
    user_email = str(usuario.email or "")
    _release_user_session(usuario)
    try:
        result = mgr.restore_from_drive(force=req.force, on_boot=False)
        if not result.get("ok"):
            raise HTTPException(
                status_code=400,
                detail=result.get("error") or "Não foi possível restaurar o backup.",
            )
        if result.get("reason") in ("remote_folder_not_found", "remote_db_not_found"):
            raise HTTPException(
                status_code=404,
                detail="Nenhum backup encontrado ainda na pasta do Google Drive.",
            )
        status_now = mgr.status()
        status_now["restore_result"] = result
        new_tok = _issue_refreshed_token_after_restore(mgr, user_email)
        if new_tok:
            status_now["access_token"] = new_tok
        return status_now
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Falha ao restaurar do Google Drive: {exc}") from exc


@router.delete("/disconnect")
def desconectar_nuvem(
    usuario: models.Usuario = Depends(auth.get_usuario_atual),
    mgr: CloudSyncManager = Depends(get_cloud_manager),
):
    _require_primary_owner(usuario, mgr)
    return mgr.disconnect()


@router.get("/backup-zip")
def baixar_backup_zip(
    usuario: models.Usuario = Depends(auth.get_usuario_atual),
    mgr: CloudSyncManager = Depends(get_cloud_manager),
):
    is_owner = _is_primary_owner(usuario, mgr)
    try:
        zip_bytes = mgr.export_backup_zip_bytes(
            usuario_id=int(usuario.id),
            include_unclaimed_uploads=is_owner,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Erro ao gerar pacote de backup: {exc}") from exc
    stamp = datetime.now().strftime("%Y-%m-%d_%H-%M")
    raw_slug = re.sub(r"[^a-z0-9_-]+", "_", str(usuario.email or "perfil").strip().lower()).strip("_") or "perfil"
    filename = f"backup_{raw_slug}_{stamp}.zip"
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/backup-agora")
def executar_backup_completo_agora(
    usuario: models.Usuario = Depends(auth.get_usuario_atual),
    mgr: CloudSyncManager = Depends(get_cloud_manager),
):
    """
    Salva imediatamente o arquivo de backup automático local (`backups_automaticos/`)
    e força sincronização com a nuvem (Cofre 24/7 e/ou Google Drive) se conectada.
    Disponível em 1 clique no topo do painel para TODOS os perfis.
    """
    user_id = int(usuario.id)
    user_email = str(usuario.email or "")
    local_res = mgr.create_local_auto_backup(reason=f"topbar_backup_{user_email}", force_history=True)

    cloud_synced = False
    cloud_error: str | None = None
    cloud_result: dict[str, Any] | None = None
    if mgr.is_connected():
        try:
            cloud_result = mgr.sync_now(force=True, reason=f"topbar_backup_{user_email}")
            cloud_synced = bool(cloud_result.get("ok"))
            if not cloud_synced:
                cloud_error = str(cloud_result.get("detail") or cloud_result.get("error") or "")
        except Exception as exc:
            cloud_error = str(exc)

    detached = models.Usuario(id=user_id, email=user_email)
    status_now = _scoped_status_for_user(detached, mgr)
    return {
        "ok": True,
        "local_backup": local_res,
        "cloud_synced": cloud_synced,
        "cloud_error": cloud_error,
        "cloud_result": cloud_result,
        "status": status_now,
        "counts": status_now.get("counts") or {},
        "mensagem": (
            "Backup salvo na nuvem e no arquivo local com sucesso!"
            if cloud_synced
            else "Backup salvo no arquivo local do sistema!"
        ),
    }


@router.post("/restore-backup")
async def restaurar_backup_arquivo(
    file: UploadFile = File(...),
    usuario: models.Usuario = Depends(auth.get_usuario_atual),
    mgr: CloudSyncManager = Depends(get_cloud_manager),
):
    """
    Restaura um arquivo de backup (.zip ou .json) baixado pelo botão Backup,
    isoladamente para o perfil autenticado (sem afetar outros perfis).
    """
    user_id = int(usuario.id)
    user_email = str(usuario.email or "")
    filename = str(file.filename or "backup.zip")
    raw_bytes = await file.read()
    _release_user_session(usuario)
    try:
        result = mgr.import_user_backup_bytes(user_id, filename, raw_bytes)
        detached = models.Usuario(id=user_id, email=user_email)
        status_now = _scoped_status_for_user(detached, mgr)
        result["status"] = status_now
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Falha ao restaurar arquivo de backup: {exc}") from exc


@router.post("/vault/hydrate")
def hidratar_cofre_criptografado(
    req: VaultHydrateRequest,
    mgr: CloudSyncManager = Depends(get_cloud_manager),
):
    """
    Hidrata o cofre criptografado 24/7 em containers efêmeros validando o compromisso SHA-256,
    sem armazenar tokens ou chaves de criptografia no código-fonte público.
    """
    expected_hash = (
        os.environ.get("CLOUD_VAULT_HYDRATE_SHA256") or DEFAULT_VAULT_HYDRATE_SHA256
    ).strip().lower()
    provided_hash = hashlib.sha256((req.hydrate_secret or "").encode("utf-8")).hexdigest().lower()
    if not hmac.compare_digest(provided_hash.encode("ascii"), expected_hash.encode("ascii")):
        raise HTTPException(status_code=403, detail="Assinatura de hidratação inválida.")

    try:
        return mgr.hydrate_vault(
            github_token=req.github_token,
            repo=req.repo,
            aes_key=req.aes_key,
            branch=req.branch,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Falha ao hidratar cofre em nuvem: {exc}") from exc
