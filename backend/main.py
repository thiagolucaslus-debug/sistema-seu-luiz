import os
import sys
import secrets

# Garante que a pasta backend esteja sempre no sys.path
backend_dir = os.path.dirname(os.path.abspath(__file__))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from database import engine, Base, DATA_DIR
import models

# Configura WAL mode e timeout no SQLite para evitar locks de concorrência
with engine.begin() as connection:
    try:
        connection.exec_driver_sql("PRAGMA journal_mode=WAL;")
        connection.exec_driver_sql("PRAGMA busy_timeout=5000;")
    except Exception:
        pass

# Cria todas as tabelas no SQLite se não existirem
Base.metadata.create_all(bind=engine)

# Migrações manuais seguras para tabelas existentes
with engine.begin() as connection:
    # 1. Coluna forma_pagamento em pagamentos_pessoa
    colunas_pag = connection.exec_driver_sql("PRAGMA table_info(pagamentos_pessoa)").all()
    if not any(coluna[1] == "forma_pagamento" for coluna in colunas_pag):
        connection.exec_driver_sql("ALTER TABLE pagamentos_pessoa ADD COLUMN forma_pagamento VARCHAR(100)")

    # 2. Coluna token_acesso em pessoas
    colunas_pes = connection.exec_driver_sql("PRAGMA table_info(pessoas)").all()
    if not any(coluna[1] == "token_acesso" for coluna in colunas_pes):
        connection.exec_driver_sql("ALTER TABLE pessoas ADD COLUMN token_acesso VARCHAR(64)")

# Gera token_acesso único para qualquer pessoa existente que não tenha
from sqlalchemy.orm import Session
with Session(bind=engine) as session:
    pessoas_sem_token = session.query(models.Pessoa).filter(
        (models.Pessoa.token_acesso == None) | (models.Pessoa.token_acesso == "")
    ).all()
    for p in pessoas_sem_token:
        p.token_acesso = secrets.token_urlsafe(12)
    if pessoas_sem_token:
        session.commit()

app = FastAPI(
    title="Administração Financeira API",
    description="API REST para controle e administração financeira pessoal completa",
    version="2.0.0"
)

# Permite acesso local, de túnel (Cloudflare) e de rede móvel
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Importação dos routers
from routers import auth, contas, cartoes, pessoas, lancamentos, modulos, relatorios, whatsapp, solicitacoes

app.include_router(auth.router)
app.include_router(contas.router)
app.include_router(cartoes.router)
app.include_router(pessoas.router)
app.include_router(lancamentos.router)
app.include_router(modulos.router)
app.include_router(relatorios.router)
app.include_router(whatsapp.router)
app.include_router(solicitacoes.router)

# Diretório persistente para PDFs gerados
pdfs_dir = os.path.join(DATA_DIR, "pdfs")
os.makedirs(pdfs_dir, exist_ok=True)
app.mount("/pdfs", StaticFiles(directory=pdfs_dir), name="pdfs")

# Diretório persistente para uploads (fotos de pessoas, comprovantes)
uploads_dir = os.path.join(DATA_DIR, "uploads")
os.makedirs(uploads_dir, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=uploads_dir), name="uploads")

@app.get("/health")
def health():
    return {"status": "ok", "sistema": "Administração Financeira"}

# Monta o frontend compilado (Vite dist) em produção se existir
from fastapi.responses import FileResponse
frontend_dist = os.path.join(getattr(sys, '_MEIPASS', os.path.dirname(backend_dir)), "frontend", "dist")
if not os.path.exists(frontend_dist):
    frontend_dist = os.path.join(os.path.dirname(backend_dir), "frontend", "dist")

if os.path.exists(frontend_dist):
    assets_dir = os.path.join(frontend_dist, "assets")
    if os.path.exists(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        target = os.path.join(frontend_dist, full_path)
        if full_path and os.path.isfile(target):
            return FileResponse(target)
        index_file = os.path.join(frontend_dist, "index.html")
        if os.path.exists(index_file):
            return FileResponse(index_file)
        return {"mensagem": "Administração Financeira API em execução.", "docs": "/docs"}
else:
    @app.get("/")
    def root():
        return {"mensagem": "Administração Financeira API em execução.", "docs": "/docs"}

