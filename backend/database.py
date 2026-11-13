import os
import sys
import shutil
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

# Determina o diretório de dados persistentes para banco SQLite, uploads e relatórios
if getattr(sys, 'frozen', False):
    DATA_DIR = os.path.join(
        os.environ.get('LOCALAPPDATA', os.environ.get('APPDATA', os.path.expanduser('~'))),
        'AdministracaoFinanceira'
    )
    os.makedirs(DATA_DIR, exist_ok=True)
    # Copia banco existente do diretório da aplicação caso ainda não exista no AppData
    exe_dir = os.path.dirname(sys.executable)
    orig_db = os.path.join(exe_dir, 'financeiro.db')
    dest_db = os.path.join(DATA_DIR, 'financeiro.db')
    if not os.path.exists(dest_db) and os.path.exists(orig_db):
        try:
            shutil.copy2(orig_db, dest_db)
        except Exception:
            pass
else:
    DATA_DIR = os.path.dirname(os.path.abspath(__file__))

DB_PATH = os.path.join(DATA_DIR, 'financeiro.db')
DATABASE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
