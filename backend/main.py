import asyncio
import os
import re
import sys
import secrets
import unicodedata
from contextlib import asynccontextmanager
from pathlib import Path

# Garante que a pasta backend esteja sempre no sys.path
backend_dir = os.path.dirname(os.path.abspath(__file__))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import event
from sqlalchemy.orm import Session

from database import engine, Base, DATA_DIR, DB_PATH, CLOUD_CONFIG_DIR
import models
from tenancy import USER_OWNED_TABLES, normalize_legacy_issuer_card_colors
from services.cloud_sync import CloudSyncManager
from services.hub_sync import HubSyncASGIMiddleware, HubSyncClient
from routers import (
    auth,
    contas,
    cartoes,
    pessoas,
    lancamentos,
    modulos,
    dividas,
    relatorios,
    whatsapp,
    solicitacoes,
    cloud,
    sync_hub,
)


def ensure_schema_and_migrations() -> None:
    """Garante WAL mode, tabelas SQLite, isolamento multiusuário e migrações incrementais seguras."""
    with engine.begin() as connection:
        try:
            connection.exec_driver_sql("PRAGMA journal_mode=WAL;")
            connection.exec_driver_sql("PRAGMA busy_timeout=5000;")
        except Exception:
            pass

    Base.metadata.create_all(bind=engine)

    with engine.begin() as connection:
        colunas_usr = connection.exec_driver_sql("PRAGMA table_info(usuarios)").all()
        if not any(coluna[1] == "sync_rev" for coluna in colunas_usr):
            connection.exec_driver_sql(
                "ALTER TABLE usuarios ADD COLUMN sync_rev INTEGER NOT NULL DEFAULT 1"
            )
        connection.exec_driver_sql(
            "UPDATE usuarios SET sync_rev = 1 WHERE sync_rev IS NULL"
        )

        colunas_pag = connection.exec_driver_sql("PRAGMA table_info(pagamentos_pessoa)").all()
        if not any(coluna[1] == "forma_pagamento" for coluna in colunas_pag):
            connection.exec_driver_sql(
                "ALTER TABLE pagamentos_pessoa ADD COLUMN forma_pagamento VARCHAR(100)"
            )

        colunas_pes = connection.exec_driver_sql("PRAGMA table_info(pessoas)").all()
        if not any(coluna[1] == "token_acesso" for coluna in colunas_pes):
            connection.exec_driver_sql(
                "ALTER TABLE pessoas ADD COLUMN token_acesso VARCHAR(64)"
            )

        for tbl in USER_OWNED_TABLES:
            cols = connection.exec_driver_sql(f"PRAGMA table_info({tbl})").all()
            if not any(c[1] == "usuario_id" for c in cols):
                connection.exec_driver_sql(
                    f"ALTER TABLE {tbl} ADD COLUMN usuario_id INTEGER REFERENCES usuarios(id)"
                )
            connection.exec_driver_sql(
                f"CREATE INDEX IF NOT EXISTS ix_{tbl}_usuario_id ON {tbl} (usuario_id)"
            )

        primary_user = connection.exec_driver_sql(
            "SELECT id FROM usuarios ORDER BY id ASC LIMIT 1"
        ).fetchone()
        if primary_user:
            primary_uid = int(primary_user[0])
            for tbl in USER_OWNED_TABLES:
                connection.exec_driver_sql(
                    f"UPDATE {tbl} SET usuario_id = ? WHERE usuario_id IS NULL",
                    (primary_uid,),
                )

    with Session(bind=engine) as session:
        alterou_boot = False
        pessoas_sem_token = (
            session.query(models.Pessoa)
            .filter((models.Pessoa.token_acesso == None) | (models.Pessoa.token_acesso == ""))
            .all()
        )
        for p in pessoas_sem_token:
            p.token_acesso = secrets.token_urlsafe(12)
            alterou_boot = True

        # Normaliza eventuais URLs legadas (http://localhost:8000/uploads/...) para /uploads/...
        for model_cls, attr_name in (
            (models.Pessoa, "foto_path"),
            (models.Usuario, "logo_path"),
            (models.Modulo, "foto_path"),
            (models.Lancamento, "comprovante_path"),
            (models.SolicitacaoLancamento, "comprovante_path"),
        ):
            col = getattr(model_cls, attr_name)
            for row in session.query(model_cls).filter(col != None).all():
                raw_val = getattr(row, attr_name)
                if isinstance(raw_val, str) and "/uploads/" in raw_val and not raw_val.startswith("/uploads/"):
                    fname = os.path.basename(raw_val.replace("\\", "/").split("/uploads/", 1)[1].split("?", 1)[0])
                    if fname and fname not in (".", ".."):
                        setattr(row, attr_name, f"/uploads/{fname}")
                        alterou_boot = True

        # Normaliza cartões legados que receberam o antigo padrão intocado '#8B5CF6' para a cor real do emissor
        if normalize_legacy_issuer_card_colors(session):
            alterou_boot = True

        if alterou_boot:
            session.commit()


cloud_sync_manager = CloudSyncManager(
    data_dir=DATA_DIR,
    db_path=DB_PATH,
    config_dir=CLOUD_CONFIG_DIR,
    engine_disposer=engine.dispose,
    schema_migrator=ensure_schema_and_migrations,
)
cloud.set_cloud_manager(cloud_sync_manager)

# Em containers efêmeros (ex.: Render) ou multi-dispositivo, sincroniza/restaura do Google Drive ANTES de abrir o banco local
_boot_restore_ok = True
if cloud_sync_manager.is_connected():
    try:
        _boot_res = cloud_sync_manager.restore_from_drive(force=False, on_boot=True)
        _boot_restore_ok = bool(_boot_res.get("ok", False))
    except Exception as _boot_err:
        _boot_restore_ok = False
        print(f"[AVISO] Falha na restauração inicial do Google Drive: {_boot_err}")

ensure_schema_and_migrations()


@event.listens_for(Session, "after_commit")
def _auto_sync_after_sqlalchemy_commit(session: Session) -> None:
    if session.bind is engine:
        cloud_sync_manager.notify_change("db_commit")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if cloud_sync_manager.is_connected():
        if not _boot_restore_ok:
            # Se houve falha de rede transitória no boot, tenta restaurar antes de permitir auto-sync
            try:
                cloud_sync_manager.restore_from_drive(force=False, on_boot=True)
            except Exception:
                pass
        elif not cloud_sync_manager.status().get("last_sync_at"):
            cloud_sync_manager.notify_change("startup_check")
    try:
        # Garante backup automático local inicial se o banco já tiver dados
        if Path(DB_PATH).is_file():
            await asyncio.to_thread(cloud_sync_manager.create_local_auto_backup, reason="startup")
    except Exception:
        pass
    try:
        yield
    finally:
        # Descarrega qualquer alteração pendente antes do container encerrar (SIGTERM no Render)
        cloud_sync_manager.shutdown()


hub_sync_client = HubSyncClient(
    data_dir=DATA_DIR,
    db_path=DB_PATH,
    on_local_change=lambda reason: cloud_sync_manager.create_local_auto_backup(reason=reason),
)
cloud.set_hub_client(hub_sync_client)

app = FastAPI(
    title="Administração Financeira API",
    description="API REST para controle e administração financeira pessoal completa",
    version="2.4.0",
    lifespan=lifespan,
)

app.add_middleware(HubSyncASGIMiddleware, hub_client=hub_sync_client)

# Permite acesso local, Desktop Electron, Render e rede móvel
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Auto-Saved", "X-Cloud-Sync-Status", "X-Cloud-Sync-Rev", "Content-Disposition"],
)


def _safe_wal_checkpoint() -> None:
    try:
        with engine.begin() as conn:
            conn.exec_driver_sql("PRAGMA wal_checkpoint(PASSIVE);")
    except Exception:
        pass


@app.middleware("http")
async def auto_cloud_sync_on_mutations(request: Request, call_next):
    response = await call_next(request)
    if (
        request.method in ("POST", "PUT", "PATCH", "DELETE")
        and response.status_code < 400
        and not request.url.path.startswith("/cloud/")
        and not request.url.path.startswith("/sync/")
        and not request.url.path.startswith("/auth/login")
        and not request.url.path.startswith("/whatsapp/")
    ):
        reason = f"http_{request.method}_{request.url.path}"
        await asyncio.to_thread(_safe_wal_checkpoint)
        flush_res = await asyncio.to_thread(
            cloud_sync_manager.flush_after_mutation,
            reason=reason,
            sync_cloud_blocking=cloud_sync_manager.is_cloud_container,
        )
        local_ok = bool((flush_res.get("local") or {}).get("ok"))
        cloud_info = flush_res.get("cloud") or {}
        if cloud_info.get("ok") and not cloud_info.get("queued"):
            sync_state = "synced"
        elif cloud_info.get("queued"):
            sync_state = "queued"
        elif cloud_info.get("skipped"):
            sync_state = "local_only"
        else:
            sync_state = "error"
        response.headers["X-Auto-Saved"] = "true" if local_ok else "partial"
        response.headers["X-Cloud-Sync-Status"] = sync_state
        response.headers["X-Cloud-Sync-Rev"] = str(cloud_sync_manager.status().get("revision") or 0)
    return response


app.include_router(auth.router)
app.include_router(contas.router)
app.include_router(cartoes.router)
app.include_router(pessoas.router)
app.include_router(lancamentos.router)
app.include_router(modulos.router)
app.include_router(dividas.router)
app.include_router(relatorios.router)
app.include_router(whatsapp.router)
app.include_router(solicitacoes.router)
app.include_router(cloud.router)
app.include_router(sync_hub.router)

# Diretório persistente para PDFs gerados
pdfs_dir = os.path.join(DATA_DIR, "pdfs")
os.makedirs(pdfs_dir, exist_ok=True)
app.mount("/pdfs", StaticFiles(directory=pdfs_dir), name="pdfs")

# Diretório persistente para uploads (fotos de pessoas, comprovantes)
uploads_dir = os.path.join(DATA_DIR, "uploads")
os.makedirs(uploads_dir, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=uploads_dir), name="uploads")


@app.api_route("/health", methods=["GET", "HEAD"])
def health():
    return {
        "status": "ok",
        "sistema": "Administração Financeira",
        "versao": app.version,
        "git_sha": (os.environ.get("RENDER_GIT_COMMIT") or "")[:12],
        "nuvem": cloud_sync_manager.public_health_summary(),
    }


# Monta o frontend compilado (Vite dist) em produção se existir
frontend_dist = os.path.join(
    getattr(sys, "_MEIPASS", os.path.dirname(backend_dir)), "frontend", "dist"
)
if not os.path.exists(frontend_dist):
    frontend_dist = os.path.join(os.path.dirname(backend_dir), "frontend", "dist")

if os.path.exists(frontend_dist):
    frontend_root = Path(frontend_dist).resolve()
    assets_dir = frontend_root / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        normalized = full_path.replace("\\", "/")
        parts = [p for p in normalized.split("/") if p]
        if any(p == ".." for p in parts):
            raise HTTPException(status_code=404, detail="Recurso não encontrado.")
        if parts:
            candidate = (frontend_root / "/".join(parts)).resolve()
            if not candidate.is_relative_to(frontend_root):
                raise HTTPException(status_code=404, detail="Recurso não encontrado.")
            if candidate.is_file():
                return FileResponse(str(candidate))
        index_file = frontend_root / "index.html"
        if index_file.is_file():
            return FileResponse(str(index_file))
        return {"mensagem": "Administração Financeira API em execução.", "docs": "/docs"}
else:
    @app.get("/")
    def root():
        return {"mensagem": "Administração Financeira API em execução.", "docs": "/docs"}
