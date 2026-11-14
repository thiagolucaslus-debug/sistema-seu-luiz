"""
Prepara os artefatos portateis 100% autocontidos para o instalador Electron Windows:
1. Gera icon.ico (multi-resolucao) e icon.png para Administracao Financeira.
2. Monta desktop/portable_runtime/python_runtime (Python 3.12 + CRT DLLs + requirements do backend).
3. Monta desktop/portable_runtime/nodejs (node.exe portatil para servico WhatsApp opcional).
4. Monta desktop/app_engine_clean (codigo limpo do backend + frontend/dist + whatsapp-service, sem dados pessoais).
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

DESKTOP_DIR = Path(__file__).resolve().parent
REPO_ROOT = DESKTOP_DIR.parent
PORTABLE_DIR = DESKTOP_DIR / "portable_runtime"
PY_RUNTIME_DIR = PORTABLE_DIR / "python_runtime"
NODE_RUNTIME_DIR = PORTABLE_DIR / "nodejs"
ENGINE_CLEAN_DIR = DESKTOP_DIR / "app_engine_clean"


def generate_icons() -> None:
    size = 512
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Fundo arredondado azul-marinho profundo com borda esmeralda
    pad = 24
    draw.rounded_rectangle(
        [pad, pad, size - pad, size - pad],
        radius=112,
        fill=(13, 25, 48, 255),
        outline=(16, 185, 129, 255),
        width=14,
    )

    # Barra de destaque superior interna esmeralda/ciano
    draw.rounded_rectangle(
        [pad + 36, pad + 38, size - pad - 36, pad + 58],
        radius=10,
        fill=(16, 185, 129, 230),
    )

    # Texto "AF" centralizado
    font = None
    for candidate in (
        r"C:\Windows\Fonts\segoeuib.ttf",
        r"C:\Windows\Fonts\arialbd.ttf",
        r"C:\Windows\Fonts\calibrib.ttf",
    ):
        if Path(candidate).is_file():
            font = ImageFont.truetype(candidate, 220)
            break
    if font is None:
        font = ImageFont.load_default()

    text = "AF"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    tx = (size - tw) // 2 - bbox[0]
    ty = (size - th) // 2 - bbox[1] + 18

    draw.text((tx + 4, ty + 6), text, font=font, fill=(0, 0, 0, 120))
    draw.text((tx, ty), text, font=font, fill=(248, 250, 252, 255))

    png_256 = img.resize((256, 256), Image.Resampling.LANCZOS)
    png_path = DESKTOP_DIR / "icon.png"
    ico_path = DESKTOP_DIR / "icon.ico"
    png_256.save(png_path, format="PNG")
    img.save(
        ico_path,
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print(f"[OK] Icones gerados: {ico_path} ({ico_path.stat().st_size} bytes)")


def build_python_runtime() -> None:
    base_py = Path(sys.executable).resolve().parent
    print(f"[INFO] Construindo python_runtime limpo a partir de: {base_py}")
    if PY_RUNTIME_DIR.exists():
        shutil.rmtree(PY_RUNTIME_DIR)
    PY_RUNTIME_DIR.mkdir(parents=True, exist_ok=True)

    # Copia executaveis e DLLs da raiz do Python 3.12
    for item in base_py.iterdir():
        if item.is_file() and item.suffix.lower() in (".exe", ".dll", ".pyd", "._pth"):
            if item.name.lower().startswith("python") or "vcruntime" in item.name.lower():
                shutil.copy2(item, PY_RUNTIME_DIR / item.name)

    # Copia DLLs extras de CRT do runtime de referencia se disponiveis (garante execucao em Windows limpo)
    ref_py = Path(r"D:\ROBO EDITOR\desktop\portable_runtime\python_runtime")
    if ref_py.is_dir():
        for dll in ref_py.glob("*.dll"):
            dst_dll = PY_RUNTIME_DIR / dll.name
            if not dst_dll.exists():
                shutil.copy2(dll, dst_dll)

    # Copia pasta DLLs (.pyd / .dll do stdlib, ignorando tcl/tk pesados)
    src_dlls = base_py / "DLLs"
    dst_dlls = PY_RUNTIME_DIR / "DLLs"
    dst_dlls.mkdir(parents=True, exist_ok=True)
    for item in src_dlls.iterdir():
        low = item.name.lower()
        if any(skip in low for skip in ("tcl", "tk86", "_tkinter")):
            continue
        if item.is_file():
            shutil.copy2(item, dst_dlls / item.name)

    # Copia stdlib (Lib/) sem site-packages, test, tkinter, idlelib, turtledemo, ensurepip
    skip_lib_dirs = {
        "site-packages",
        "test",
        "tests",
        "idlelib",
        "tkinter",
        "turtledemo",
        "ensurepip",
        "__pycache__",
    }
    shutil.copytree(
        base_py / "Lib",
        PY_RUNTIME_DIR / "Lib",
        ignore=lambda cur, names: [n for n in names if n in skip_lib_dirs or n.endswith(".pyc")],
    )
    site_packages = PY_RUNTIME_DIR / "Lib" / "site-packages"
    site_packages.mkdir(parents=True, exist_ok=True)
    (PY_RUNTIME_DIR / "Scripts").mkdir(parents=True, exist_ok=True)

    # Instala exclusivamente os pacotes de backend/requirements.txt no site-packages portatil
    req_file = REPO_ROOT / "backend" / "requirements.txt"
    subprocess.run(
        [
            sys.executable,
            "-m",
            "pip",
            "install",
            "--upgrade",
            "--no-warn-script-location",
            "--target",
            str(site_packages),
            "-r",
            str(req_file),
        ],
        check=True,
    )

    # Limpa caches desnecessarios para reduzir tamanho do instalador
    for pycache in PY_RUNTIME_DIR.rglob("__pycache__"):
        shutil.rmtree(pycache, ignore_errors=True)

    # Smoke test 100% isolado (PYTHONNOUSERSITE=1)
    portable_exe = PY_RUNTIME_DIR / "python.exe"
    env = dict(os.environ)
    env["PYTHONNOUSERSITE"] = "1"
    env["PYTHONPATH"] = ""
    subprocess.run(
        [
            str(portable_exe),
            "-c",
            (
                "import fastapi, uvicorn, sqlalchemy, pydantic, reportlab, multipart, "
                "PIL, openpyxl, bcrypt, cryptography, jose, dateutil, aiofiles; "
                "print('[OK] Smoke test python_runtime isolado aprovado!')"
            ),
        ],
        env=env,
        check=True,
    )


def build_node_runtime() -> None:
    if NODE_RUNTIME_DIR.exists():
        shutil.rmtree(NODE_RUNTIME_DIR)
    NODE_RUNTIME_DIR.mkdir(parents=True, exist_ok=True)

    for cand in (
        Path(r"D:\ROBO EDITOR\desktop\portable_runtime\nodejs\node.exe"),
        Path(r"C:\Program Files\nodejs\node.exe"),
    ):
        if cand.is_file():
            shutil.copy2(cand, NODE_RUNTIME_DIR / "node.exe")
            print(f"[OK] node.exe portatil copiado de: {cand}")
            return
    print("[WARN] node.exe nao encontrado; servico WhatsApp opcional ficara desativado.")


def stage_clean_engine() -> None:
    if ENGINE_CLEAN_DIR.exists():
        shutil.rmtree(ENGINE_CLEAN_DIR)
    ENGINE_CLEAN_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Launcher
    shutil.copy2(REPO_ROOT / "desktop_launcher.py", ENGINE_CLEAN_DIR / "desktop_launcher.py")

    # 2. Backend (apenas codigo-fonte limpo — ZERO financeiro.db, ZERO uploads pessoais, ZERO segredos)
    dst_backend = ENGINE_CLEAN_DIR / "backend"
    dst_backend.mkdir(parents=True, exist_ok=True)
    for py_file in (REPO_ROOT / "backend").glob("*.py"):
        if py_file.name.startswith("test_"):
            continue
        shutil.copy2(py_file, dst_backend / py_file.name)
    shutil.copy2(REPO_ROOT / "backend" / "requirements.txt", dst_backend / "requirements.txt")

    for sub in ("routers", "services"):
        dst_sub = dst_backend / sub
        dst_sub.mkdir(parents=True, exist_ok=True)
        for py_file in (REPO_ROOT / "backend" / sub).glob("*.py"):
            if py_file.name.startswith("test_"):
                continue
            shutil.copy2(py_file, dst_sub / py_file.name)

    (dst_backend / "uploads").mkdir(parents=True, exist_ok=True)
    (dst_backend / "pdfs").mkdir(parents=True, exist_ok=True)

    # 3. Frontend compilado (frontend/dist)
    src_dist = REPO_ROOT / "frontend" / "dist"
    if not (src_dist / "index.html").is_file():
        raise RuntimeError(f"Build do frontend ausente em {src_dist}. Rode npm run build primeiro.")
    shutil.copytree(src_dist, ENGINE_CLEAN_DIR / "frontend" / "dist")

    # 4. WhatsApp service limpo (sem sessao .wwebjs_auth pessoal)
    src_wa = REPO_ROOT / "whatsapp-service"
    if src_wa.is_dir():
        dst_wa = ENGINE_CLEAN_DIR / "whatsapp-service"
        dst_wa.mkdir(parents=True, exist_ok=True)
        for fname in ("package.json", "package-lock.json", "sender.js"):
            fsrc = src_wa / fname
            if fsrc.is_file():
                shutil.copy2(fsrc, dst_wa / fname)
        if (src_wa / "node_modules").is_dir():
            # Ignora cache local do puppeteer se existir para nao inflar o instalador
            shutil.copytree(
                src_wa / "node_modules",
                dst_wa / "node_modules",
                ignore=lambda cur, names: [
                    n for n in names if n in (".cache", ".wwebjs_auth", ".wwebjs_cache")
                ],
            )

    print(f"[OK] Engine limpa preparada em: {ENGINE_CLEAN_DIR}")


if __name__ == "__main__":
    generate_icons()
    build_python_runtime()
    build_node_runtime()
    stage_clean_engine()
    print("[DONE] Artefatos portateis prontos para electron-builder!")
