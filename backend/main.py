import os
import sys
import secrets
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
from services.cloud_sync import CloudSyncManager
from routers import (
    auth,
    contas,
    cartoes,
    pessoas,
    lancamentos,
    modulos,
    relatorios,
    whatsapp,
    solicitacoes,
    cloud,
)


def ensure_schema_and_migrations() -> None:
    """Garante WAL mode, tabelas SQLite e migrações incrementais seguras."""
    with engine.begin() as connection:
        try:
            connection.exec_driver_sql("PRAGMA journal_mode=WAL;")
            connection.exec_driver_sql("PRAGMA busy_timeout=5000;")
        except Exception:
            pass

    Base.metadata.create_all(bind=engine)

    with engine.begin() as connection:
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

    with Session(bind=engine) as session:
        pessoas_sem_token = (
            session.query(models.Pessoa)
            .filter((models.Pessoa.token_acesso == None) | (models.Pessoa.token_acesso == ""))
            .all()
        )
        for p in pessoas_sem_token:
            p.token_acesso = secrets.token_urlsafe(12)
        if pessoas_sem_token:
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
        yield
    finally:
        # Descarrega qualquer alteração pendente antes do container encerrar (SIGTERM no Render)
        cloud_sync_manager.shutdown()


app = FastAPI(
    title="Administração Financeira API",
    description="API REST para controle e administração financeira pessoal completa",
    version="2.1.0",
    lifespan=lifespan,
)

# Permite acesso local, de túnel (Cloudflare), Render e rede móvel
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def auto_cloud_sync_on_mutations(request: Request, call_next):
    response = await call_next(request)
    if (
        request.method in ("POST", "PUT", "PATCH", "DELETE")
        and response.status_code < 400
        and not request.url.path.startswith("/cloud/")
        and not request.url.path.startswith("/auth/login")
        and not request.url.path.startswith("/whatsapp/")
    ):
        cloud_sync_manager.notify_change(f"http_{request.method}_{request.url.path}")
    return response


app.include_router(auth.router)
app.include_router(contas.router)
app.include_router(cartoes.router)
app.include_router(pessoas.router)
app.include_router(lancamentos.router)
app.include_router(modulos.router)
app.include_router(relatorios.router)
app.include_router(whatsapp.router)
app.include_router(solicitacoes.router)
app.include_router(cloud.router)

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
