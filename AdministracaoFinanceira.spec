# -*- mode: python ; coding: utf-8 -*-
import os
from pathlib import Path

block_cipher = None

_spec_root = Path(SPECPATH).resolve()
_backend_root = _spec_root / "backend"


def _collect_clean_backend_datas():
    items = []
    skip_dirs = {"__pycache__", ".pytest_cache", "pdfs"}
    skip_files = {"google_drive_oauth.json", ".cloud_sync_meta.json"}
    for root, dirs, files in os.walk(_backend_root):
        dirs[:] = [d for d in dirs if d not in skip_dirs and not d.startswith(".")]
        rel_dir = Path(root).resolve().relative_to(_spec_root).as_posix()
        for fname in files:
            if (
                fname in skip_files
                or fname.startswith("test_")
                or fname.endswith((".pyc", ".pyo", ".db-wal", ".db-shm", ".log"))
            ):
                continue
            src = (Path(root) / fname).as_posix()
            items.append((src, rel_dir))
    return items


added_files = _collect_clean_backend_datas() + [
    ("frontend/dist", "frontend/dist"),
    ("app_icon.ico", "."),
]

hidden_imports = [
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    "reportlab",
    "reportlab.pdfgen",
    "reportlab.platypus",
    "reportlab.lib",
    "reportlab.lib.pagesizes",
    "reportlab.lib.colors",
    "reportlab.lib.styles",
    "sqlalchemy",
    "sqlalchemy.sql.default_comparator",
    "sqlalchemy.dialects.sqlite",
    "passlib",
    "passlib.handlers.bcrypt",
    "jose",
    "jose.jwt",
    "cryptography",
    "cryptography.hazmat.primitives.ciphers",
    "cryptography.hazmat.primitives.ciphers.algorithms",
    "cryptography.hazmat.primitives.ciphers.modes",
    "pydantic",
    "pydantic_core",
    "PIL",
    "multipart",
    "python_multipart",
]

a = Analysis(
    ["desktop_launcher.py"],
    pathex=[".", "backend"],
    binaries=[],
    datas=added_files,
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "matplotlib",
        "scipy",
        "numpy",
        "tkinter",
        "PIL.ImageTk",
        "pytest",
        "_pytest",
        "IPython",
        "jedi",
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="AdministracaoFinanceira",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon="app_icon.ico",
)
