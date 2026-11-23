from io import BytesIO
import os
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import func, text
from sqlalchemy.orm import Session
from database import get_db, DATA_DIR
import models
import auth
from tenancy import USER_OWNED_TABLES, bump_user_sync_rev
from pydantic import BaseModel

router = APIRouter(prefix="/auth", tags=["auth"])
UPLOADS_DIR = Path(DATA_DIR) / "uploads"

# 'usuario' é o identificador de login — internamente guardado no campo email do banco
class LoginRequest(BaseModel):
    usuario: str
    senha: str

class SetupRequest(BaseModel):
    nome: str
    usuario: str
    senha: str

class RegisterRequest(BaseModel):
    nome: str
    usuario: str
    senha: str

class TrocaSenhaRequest(BaseModel):
    senha_atual: str
    nova_senha: str

class PerfilRequest(BaseModel):
    nome: str

def dados_perfil(usuario: models.Usuario):
    return {
        "id": usuario.id,
        "nome": usuario.nome,
        "usuario": usuario.email,
        "logo_path": usuario.logo_path,
    }

@router.get("/check-setup")
def check_setup(db: Session = Depends(get_db)):
    """Verifica se o sistema já foi configurado com usuário mestre."""
    qtd = db.query(models.Usuario).count()
    if qtd == 0 and (os.environ.get("RENDER") or os.environ.get("RENDER_SERVICE_ID")):
        try:
            from routers.cloud import get_cloud_manager

            mgr = get_cloud_manager()
            if not mgr.is_connected():
                return {"configured": True, "cloud_waking": True}
        except Exception:
            pass
    return {"configured": qtd > 0, "cloud_waking": False}

@router.post("/setup")
def setup_inicial(req: SetupRequest, db: Session = Depends(get_db)):
    """Cria o usuário inicial do sistema."""
    if db.query(models.Usuario).count() > 0:
        raise HTTPException(status_code=400, detail="O sistema já foi configurado.")

    # Guarda o nome de usuário no campo email (campo de identificação único)
    usuario_id = req.usuario.strip().lower()
    if db.query(models.Usuario).filter(models.Usuario.email == usuario_id).first():
        raise HTTPException(status_code=400, detail="Nome de usuário já em uso.")

    usuario = models.Usuario(
        nome=req.nome,
        email=usuario_id,
        senha_hash=auth.hash_senha(req.senha),
        sync_rev=1,
    )
    db.add(usuario)
    db.commit()
    db.refresh(usuario)

    # Atribui quaisquer registros legados sem dono ao usuário inicial
    for tbl in USER_OWNED_TABLES:
        db.execute(
            text(f"UPDATE {tbl} SET usuario_id = :uid WHERE usuario_id IS NULL"),
            {"uid": usuario.id},
        )
    db.commit()

    token = auth.criar_token(usuario)
    return {
        "access_token": token,
        "token_type": "bearer",
        "usuario": dados_perfil(usuario)
    }

@router.post("/register")
def registrar_novo_usuario(req: RegisterRequest, db: Session = Depends(get_db)):
    """Permite que qualquer pessoa crie seu perfil de administração financeira."""
    usuario_id = req.usuario.strip().lower()
    if not usuario_id or not req.nome.strip() or not req.senha:
        raise HTTPException(status_code=400, detail="Preencha todos os campos obrigatórios.")
    if len(req.senha) < 4:
        raise HTTPException(status_code=400, detail="A senha deve ter pelo menos 4 caracteres.")

    if db.query(models.Usuario).filter(models.Usuario.email == usuario_id).first():
        raise HTTPException(status_code=400, detail="Este nome de usuário já está em uso. Escolha outro.")

    usuario = models.Usuario(
        nome=req.nome.strip(),
        email=usuario_id,
        senha_hash=auth.hash_senha(req.senha),
        sync_rev=1,
    )
    db.add(usuario)
    db.commit()
    db.refresh(usuario)

    token = auth.criar_token(usuario)
    return {
        "access_token": token,
        "token_type": "bearer",
        "usuario": dados_perfil(usuario)
    }

@router.post("/login")
def login(req: LoginRequest, db: Session = Depends(get_db)):
    usuario_id = req.usuario.strip().lower()
    usuario = db.query(models.Usuario).filter(models.Usuario.email == usuario_id).first()
    if not usuario or not auth.verificar_senha(req.senha, usuario.senha_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuário ou senha incorretos."
        )

    token = auth.criar_token(usuario)
    return {
        "access_token": token,
        "token_type": "bearer",
        "usuario": dados_perfil(usuario)
    }

@router.put("/senha")
def trocar_senha(
    req: TrocaSenhaRequest,
    usuario: models.Usuario = Depends(auth.get_usuario_atual),
    db: Session = Depends(get_db)
):
    hash_atual = usuario.senha_hash
    if not auth.verificar_senha(req.senha_atual, hash_atual):
        raise HTTPException(status_code=400, detail="A senha atual está incorreta.")
    if len(req.nova_senha) < 6 or len(req.nova_senha.encode("utf-8")) > 72:
        raise HTTPException(status_code=400, detail="Use pelo menos 6 caracteres e até 72 bytes.")
    if req.nova_senha == req.senha_atual:
        raise HTTPException(status_code=400, detail="Escolha uma senha diferente da atual.")

    novo_hash = auth.hash_senha(req.nova_senha)
    alterados = db.query(models.Usuario).filter(
        models.Usuario.id == usuario.id, models.Usuario.senha_hash == hash_atual
    ).update(
        {
            models.Usuario.senha_hash: novo_hash,
            models.Usuario.sync_rev: func.coalesce(models.Usuario.sync_rev, 1) + 1,
        }
    )
    if not alterados:
        raise HTTPException(status_code=409, detail="A senha já foi alterada. Entre novamente.")
    db.commit()
    db.refresh(usuario)
    return {"access_token": auth.criar_token(usuario), "token_type": "bearer"}

@router.get("/me")
def me(usuario: models.Usuario = Depends(auth.get_usuario_atual)):
    return dados_perfil(usuario)

@router.put("/perfil")
def atualizar_perfil(req: PerfilRequest, usuario: models.Usuario = Depends(auth.get_usuario_atual), db: Session = Depends(get_db)):
    nome = req.nome.strip()
    if not 1 <= len(nome) <= 100:
        raise HTTPException(400, "Informe um nome de 1 a 100 caracteres.")
    usuario.nome = nome
    bump_user_sync_rev(db, usuario.id)
    db.commit()
    db.refresh(usuario)
    return dados_perfil(usuario)

def _remove_old_upload_safe(rel_path: str | None) -> None:
    if not rel_path or not rel_path.startswith("/uploads/"):
        return
    fname = Path(rel_path.removeprefix("/uploads/")).name
    if not fname or fname in {".", ".."}:
        return
    old_file = UPLOADS_DIR / fname
    if old_file.is_file():
        try:
            old_file.unlink()
        except OSError:
            pass


@router.post("/perfil/foto")
def atualizar_foto(file: UploadFile = File(...), usuario: models.Usuario = Depends(auth.get_usuario_atual), db: Session = Depends(get_db)):
    data = file.file.read(5 * 1024 * 1024 + 1)
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(400, "Escolha uma imagem de até 5 MB.")
    try:
        with Image.open(BytesIO(data)) as original:
            if original.format not in {"JPEG", "PNG", "WEBP"} or original.width * original.height > 24_000_000:
                raise ValueError()
            foto = ImageOps.exif_transpose(original).convert("RGB")
            foto.thumbnail((512, 512))
    except (OSError, UnidentifiedImageError, ValueError, Image.DecompressionBombError) as erro:
        raise HTTPException(400, "Escolha uma imagem JPG, PNG ou WebP válida.") from erro
    UPLOADS_DIR.mkdir(exist_ok=True)
    old_logo = usuario.logo_path
    nome_arquivo = f"perfil_{usuario.id}_{uuid4().hex}.jpg"
    foto.save(UPLOADS_DIR / nome_arquivo, "JPEG", quality=88)
    usuario.logo_path = f"/uploads/{nome_arquivo}"
    bump_user_sync_rev(db, usuario.id)
    db.commit()
    db.refresh(usuario)
    _remove_old_upload_safe(old_logo)
    return dados_perfil(usuario)

@router.delete("/perfil/foto")
def remover_foto(usuario: models.Usuario = Depends(auth.get_usuario_atual), db: Session = Depends(get_db)):
    old_logo = usuario.logo_path
    usuario.logo_path = None
    bump_user_sync_rev(db, usuario.id)
    db.commit()
    db.refresh(usuario)
    _remove_old_upload_safe(old_logo)
    return dados_perfil(usuario)
