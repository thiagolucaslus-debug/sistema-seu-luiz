import os
import sys
import shutil
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

# Determina o diretório de dados persistentes para banco SQLite, uploads e relatórios
if getattr(sys, "frozen", False):
    DATA_DIR = os.path.join(
        os.environ.get("LOCALAPPDATA", os.environ.get("APPDATA", os.path.expanduser("~"))),
        "AdministracaoFinanceira",
    )
    os.makedirs(DATA_DIR, exist_ok=True)
    exe_dir = os.path.dirname(sys.executable)
    bundle_backend_dir = os.path.join(getattr(sys, "_MEIPASS", exe_dir), "backend")

    # Copia banco existente do diretório da aplicação ou bundle caso ainda não exista no AppData
    dest_db = os.path.join(DATA_DIR, "financeiro.db")
    if not os.path.exists(dest_db):
        for orig_db in (
            os.path.join(exe_dir, "financeiro.db"),
            os.path.join(bundle_backend_dir, "financeiro.db"),
        ):
            if os.path.exists(orig_db):
                try:
                    shutil.copy2(orig_db, dest_db)
                    break
                except Exception:
                    pass

    # Copia fotos/comprovantes iniciais se ainda não existirem em AppData/uploads
    dest_uploads = os.path.join(DATA_DIR, "uploads")
    os.makedirs(dest_uploads, exist_ok=True)
    for orig_uploads in (
        os.path.join(exe_dir, "uploads"),
        os.path.join(bundle_backend_dir, "uploads"),
    ):
        if os.path.isdir(orig_uploads):
            try:
                for fname in os.listdir(orig_uploads):
                    src_f = os.path.join(orig_uploads, fname)
                    dst_f = os.path.join(dest_uploads, fname)
                    if os.path.isfile(src_f) and not os.path.exists(dst_f):
                        shutil.copy2(src_f, dst_f)
            except Exception:
                pass
else:
    DATA_DIR = os.environ.get("SEU_LUIZ_DATA_DIR") or os.path.dirname(os.path.abspath(__file__))
    os.makedirs(DATA_DIR, exist_ok=True)

# Diretório seguro para credenciais OAuth locais (fora do repositório Git no Windows)
if os.environ.get("CLOUD_CONFIG_DIR"):
    CLOUD_CONFIG_DIR = os.environ["CLOUD_CONFIG_DIR"]
elif os.name == "nt":
    CLOUD_CONFIG_DIR = os.path.join(
        os.environ.get("LOCALAPPDATA", os.environ.get("APPDATA", DATA_DIR)),
        "AdministracaoFinanceira",
    )
else:
    CLOUD_CONFIG_DIR = DATA_DIR

os.makedirs(CLOUD_CONFIG_DIR, exist_ok=True)

DB_PATH = os.path.join(DATA_DIR, "financeiro.db")
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
