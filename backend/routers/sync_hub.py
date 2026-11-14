from __future__ import annotations

import hashlib
import hmac
import os
import time
from datetime import date, datetime
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

import auth
import models
from database import DATA_DIR, get_db

router = APIRouter(prefix="/sync", tags=["sync"])


def compute_sync_proof(senha_hash: str, usuario_id: str, timestamp: int) -> str:
    msg = f"seu-luiz-sync:{usuario_id.strip().lower()}:{int(timestamp)}".encode("utf-8")
    return hmac.digest(senha_hash.encode("utf-8"), msg, "sha256").hex()


def _sha256_path(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(256 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _serialize_value(val: Any) -> Any:
    if isinstance(val, (datetime, date)):
        return val.isoformat()
    return val


def _row_to_dict(obj: Any) -> dict[str, Any]:
    return {
        col.name: _serialize_value(getattr(obj, col.name))
        for col in obj.__table__.columns
    }


def _collect_user_upload_filenames(db: Session, usuario: models.Usuario) -> set[str]:
    rels: set[str] = set()
    if usuario.logo_path:
        rels.add(usuario.logo_path)

    for (fp,) in (
        db.query(models.Pessoa.foto_path)
        .filter(models.Pessoa.usuario_id == usuario.id, models.Pessoa.foto_path != None)
        .all()
    ):
        if fp:
            rels.add(fp)

    for (mp,) in (
        db.query(models.Modulo.foto_path)
        .filter(models.Modulo.usuario_id == usuario.id, models.Modulo.foto_path != None)
        .all()
    ):
        if mp:
            rels.add(mp)

    for (cp,) in (
        db.query(models.Lancamento.comprovante_path)
        .filter(models.Lancamento.usuario_id == usuario.id, models.Lancamento.comprovante_path != None)
        .all()
    ):
        if cp:
            rels.add(cp)

    for (sp,) in (
        db.query(models.SolicitacaoLancamento.comprovante_path)
        .filter(
            models.SolicitacaoLancamento.usuario_id == usuario.id,
            models.SolicitacaoLancamento.comprovante_path != None,
        )
        .all()
    ):
        if sp:
            rels.add(sp)

    names: set[str] = set()
    for rel in rels:
        if isinstance(rel, str):
            norm = rel.strip().replace("\\", "/")
            if norm.startswith("/uploads/") or norm.startswith("uploads/"):
                fname = Path(norm.lstrip("/").removeprefix("uploads/")).name
                if fname and fname not in (".", ".."):
                    names.add(fname)
    return names


class SyncSessionRequest(BaseModel):
    usuario: str
    timestamp: int
    proof: str
    nome: Optional[str] = None
    senha_hash: Optional[str] = None
    auto_provision: bool = False


@router.post("/session")
def emitir_sessao_sync(req: SyncSessionRequest, db: Session = Depends(get_db)):
    """
    Autentica um cliente Desktop para sincronização usando prova HMAC baseada no senha_hash,
    ou provisiona na nuvem um perfil recém-criado em modo offline no PC.
    """
    now = int(time.time())
    if abs(now - int(req.timestamp)) > 600:
        raise HTTPException(status_code=401, detail="Timestamp de sincronização fora da janela permitida.")

    usuario_id = (req.usuario or "").strip().lower()
    if not usuario_id:
        raise HTTPException(status_code=400, detail="Usuário inválido.")

    usuario_db = db.query(models.Usuario).filter(models.Usuario.email == usuario_id).first()
    if usuario_db is not None:
        expected = compute_sync_proof(usuario_db.senha_hash, usuario_id, req.timestamp)
        if not hmac.compare_digest((req.proof or "").encode("ascii", errors="ignore"), expected.encode("ascii")):
            raise HTTPException(status_code=401, detail="Assinatura de sincronização inválida para este usuário.")
        return {
            "access_token": auth.criar_token(usuario_db),
            "token_type": "bearer",
            "sync_rev": int(usuario_db.sync_rev or 1),
            "provisioned": False,
            "usuario": {
                "id": usuario_db.id,
                "nome": usuario_db.nome,
                "usuario": usuario_db.email,
                "logo_path": usuario_db.logo_path,
            },
        }

    if (
        req.auto_provision
        and req.senha_hash
        and req.senha_hash.startswith(("$2a$", "$2b$", "$2y$"))
        and 50 <= len(req.senha_hash) <= 120
    ):
        expected_new = compute_sync_proof(req.senha_hash, usuario_id, req.timestamp)
        if not hmac.compare_digest((req.proof or "").encode("ascii", errors="ignore"), expected_new.encode("ascii")):
            raise HTTPException(status_code=401, detail="Prova criptográfica inválida.")
        novo = models.Usuario(
            nome=(req.nome or usuario_id).strip()[:100] or usuario_id,
            email=usuario_id,
            senha_hash=req.senha_hash,
            sync_rev=1,
        )
        db.add(novo)
        db.commit()
        db.refresh(novo)
        return {
            "access_token": auth.criar_token(novo),
            "token_type": "bearer",
            "sync_rev": int(novo.sync_rev or 1),
            "provisioned": True,
            "usuario": {
                "id": novo.id,
                "nome": novo.nome,
                "usuario": novo.email,
                "logo_path": novo.logo_path,
            },
        }

    raise HTTPException(status_code=404, detail="Usuário não encontrado no hub em nuvem.")


@router.get("/version")
def obter_versao_usuario(usuario: models.Usuario = Depends(auth.get_usuario_atual)):
    return {
        "usuario_id": usuario.id,
        "usuario": usuario.email,
        "sync_rev": int(usuario.sync_rev or 1),
    }


@router.get("/snapshot")
def obter_snapshot_usuario(
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(auth.get_usuario_atual),
):
    """Retorna a fatia isolada completa do usuário autenticado para espelhamento SQLite local."""
    contas = (
        db.query(models.ContaBancaria)
        .filter(models.ContaBancaria.usuario_id == usuario.id)
        .order_by(models.ContaBancaria.id.asc())
        .all()
    )
    cartoes = (
        db.query(models.Cartao)
        .filter(models.Cartao.usuario_id == usuario.id)
        .order_by(models.Cartao.id.asc())
        .all()
    )
    pessoas = (
        db.query(models.Pessoa)
        .filter(models.Pessoa.usuario_id == usuario.id)
        .order_by(models.Pessoa.id.asc())
        .all()
    )
    modulos = (
        db.query(models.Modulo)
        .filter(models.Modulo.usuario_id == usuario.id)
        .order_by(models.Modulo.id.asc())
        .all()
    )
    modulo_ids = [m.id for m in modulos]
    subcategorias = (
        db.query(models.Subcategoria)
        .filter(models.Subcategoria.modulo_id.in_(modulo_ids))
        .order_by(models.Subcategoria.id.asc())
        .all()
        if modulo_ids
        else []
    )
    lancamentos = (
        db.query(models.Lancamento)
        .filter(models.Lancamento.usuario_id == usuario.id)
        .order_by(models.Lancamento.id.asc())
        .all()
    )
    lanc_ids = [l.id for l in lancamentos]
    parcelas = (
        db.query(models.Parcela)
        .filter(models.Parcela.lancamento_id.in_(lanc_ids))
        .order_by(models.Parcela.id.asc())
        .all()
        if lanc_ids
        else []
    )
    pagamentos_pessoa = (
        db.query(models.PagamentoPessoa)
        .filter(models.PagamentoPessoa.usuario_id == usuario.id)
        .order_by(models.PagamentoPessoa.id.asc())
        .all()
    )
    pagamentos_fatura = (
        db.query(models.PagamentoFatura)
        .filter(models.PagamentoFatura.usuario_id == usuario.id)
        .order_by(models.PagamentoFatura.id.asc())
        .all()
    )
    solicitacoes = (
        db.query(models.SolicitacaoLancamento)
        .filter(models.SolicitacaoLancamento.usuario_id == usuario.id)
        .order_by(models.SolicitacaoLancamento.id.asc())
        .all()
    )

    uploads_dir = Path(DATA_DIR) / "uploads"
    uploads_meta = []
    for fname in sorted(_collect_user_upload_filenames(db, usuario)):
        fpath = uploads_dir / fname
        if fpath.is_file():
            uploads_meta.append(
                {
                    "filename": fname,
                    "size": fpath.stat().st_size,
                    "sha256": _sha256_path(fpath),
                }
            )

    return {
        "sync_rev": int(usuario.sync_rev or 1),
        "usuario": {
            "id": usuario.id,
            "nome": usuario.nome,
            "email": usuario.email,
            "senha_hash": usuario.senha_hash,
            "logo_path": usuario.logo_path,
            "sync_rev": int(usuario.sync_rev or 1),
        },
        "contas_bancarias": [_row_to_dict(x) for x in contas],
        "cartoes": [_row_to_dict(x) for x in cartoes],
        "pessoas": [_row_to_dict(x) for x in pessoas],
        "modulos": [_row_to_dict(x) for x in modulos],
        "subcategorias": [_row_to_dict(x) for x in subcategorias],
        "lancamentos": [_row_to_dict(x) for x in lancamentos],
        "parcelas": [_row_to_dict(x) for x in parcelas],
        "pagamentos_pessoa": [_row_to_dict(x) for x in pagamentos_pessoa],
        "pagamentos_fatura": [_row_to_dict(x) for x in pagamentos_fatura],
        "solicitacoes_lancamento": [_row_to_dict(x) for x in solicitacoes],
        "uploads": uploads_meta,
    }


@router.get("/uploads/{filename}")
def baixar_upload_usuario(
    filename: str,
    db: Session = Depends(get_db),
    usuario: models.Usuario = Depends(auth.get_usuario_atual),
):
    safe_name = Path(filename).name
    if not safe_name or safe_name != filename or safe_name in (".", ".."):
        raise HTTPException(status_code=404, detail="Arquivo inválido.")
    allowed = _collect_user_upload_filenames(db, usuario)
    if safe_name not in allowed:
        raise HTTPException(status_code=404, detail="Arquivo não pertence a este usuário.")
    fpath = Path(DATA_DIR) / "uploads" / safe_name
    if not fpath.is_file():
        raise HTTPException(status_code=404, detail="Arquivo não encontrado.")
    return FileResponse(str(fpath))
