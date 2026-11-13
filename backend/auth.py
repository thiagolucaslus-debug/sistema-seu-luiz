import bcrypt
import hmac
from datetime import UTC, datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from database import get_db
import models

SECRET_KEY = "seu-luiz-sistema-financeiro-secret-key-2024"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24 * 7  # 7 dias

security = HTTPBearer(auto_error=False)

def hash_senha(senha: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(senha.encode('utf-8'), salt).decode('utf-8')

def verificar_senha(senha: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(senha.encode('utf-8'), hashed.encode('utf-8'))
    except Exception:
        return False

def _assinatura_sessao(usuario: models.Usuario) -> str:
    return hmac.digest(SECRET_KEY.encode(), usuario.senha_hash.encode(), "sha256").hex()


def criar_token(usuario: models.Usuario) -> str:
    expire = datetime.now(UTC) + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    return jwt.encode(
        {"sub": usuario.email, "sessao": _assinatura_sessao(usuario), "exp": expire},
        SECRET_KEY, algorithm=ALGORITHM
    )

def get_usuario_atual(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db)
):
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token não fornecido"
        )
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        email = payload.get("sub")
        if not email:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token inválido"
            )
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido ou expirado"
        )

    usuario = db.query(models.Usuario).filter(models.Usuario.email == email).first()
    if not usuario:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuário não encontrado"
        )
    assinatura = payload.get("sessao")
    if not isinstance(assinatura, str) or not hmac.compare_digest(
        assinatura.encode(), _assinatura_sessao(usuario).encode()
    ):
        raise HTTPException(status_code=401, detail="Sessão expirada. Entre novamente.")
    return usuario
