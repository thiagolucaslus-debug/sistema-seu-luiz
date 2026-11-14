from __future__ import annotations

from datetime import datetime
from html import escape
from typing import Any, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel

import auth
import models
from services.cloud_sync import CloudSyncManager

router = APIRouter(prefix="/cloud", tags=["cloud"])

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


@router.get("/status")
def obter_status_nuvem(
    usuario: models.Usuario = Depends(auth.get_usuario_atual),
    mgr: CloudSyncManager = Depends(get_cloud_manager),
):
    return mgr.status()


@router.post("/configure-client")
def configurar_cliente_oauth(
    payload: dict[str, Any] = Body(...),
    usuario: models.Usuario = Depends(auth.get_usuario_atual),
    mgr: CloudSyncManager = Depends(get_cloud_manager),
):
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


@router.post("/token")
def importar_token_nuvem(
    req: TokenImportRequest,
    usuario: models.Usuario = Depends(auth.get_usuario_atual),
    mgr: CloudSyncManager = Depends(get_cloud_manager),
):
    try:
        return mgr.import_oauth_token(
            req.token,
            restore_first=req.restore_first,
            sync_immediately=req.sync_immediately,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Falha ao comunicar com Google Drive: {exc}") from exc


@router.get("/export-token")
def exportar_token_nuvem(
    usuario: models.Usuario = Depends(auth.get_usuario_atual),
    mgr: CloudSyncManager = Depends(get_cloud_manager),
):
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
            detail="Conecte sua conta Google Drive antes de enviar o backup.",
        )
    try:
        result = mgr.sync_now(force=True, reason=f"manual_{usuario.email}")
        status_now = mgr.status()
        status_now["sync_result"] = result
        return status_now
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Falha ao salvar no Google Drive: {exc}") from exc


@router.post("/restore")
def restaurar_agora(
    req: RestoreRequest = Body(default=RestoreRequest()),
    usuario: models.Usuario = Depends(auth.get_usuario_atual),
    mgr: CloudSyncManager = Depends(get_cloud_manager),
):
    if not mgr.is_connected():
        raise HTTPException(
            status_code=400,
            detail="Conecte sua conta Google Drive antes de restaurar o backup.",
        )
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
    return mgr.disconnect()


@router.get("/backup-zip")
def baixar_backup_zip(
    usuario: models.Usuario = Depends(auth.get_usuario_atual),
    mgr: CloudSyncManager = Depends(get_cloud_manager),
):
    try:
        zip_bytes = mgr.export_backup_zip_bytes()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Erro ao gerar pacote de backup: {exc}") from exc
    stamp = datetime.now().strftime("%Y-%m-%d_%H-%M")
    filename = f"backup_sistema_seu_luiz_{stamp}.zip"
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
