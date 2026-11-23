from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
import models
import auth
from tenancy import bump_user_sync_rev
from pydantic import BaseModel
from typing import Optional, List
from datetime import date

router = APIRouter(prefix="/modulos", tags=["modulos"])

TIPOS_NAO_DESPESA = ("receita", "transferencia", "compra_para_mim")

class ModuloCreate(BaseModel):
    nome: str
    icone: str = "folder"
    cor: str = "#F59E0B"

class ModuloUpdate(BaseModel):
    nome: Optional[str] = None
    icone: Optional[str] = None
    cor: Optional[str] = None
    ativo: Optional[bool] = None

class SubcategoriaCreate(BaseModel):
    nome: str
    modulo_id: int

@router.get("/")
def listar_modulos(mes: Optional[int] = None, ano: Optional[int] = None, db: Session = Depends(get_db), usuario = Depends(auth.get_usuario_atual)):
    hoje = date.today()
    modulos = (
        db.query(models.Modulo)
        .filter(models.Modulo.usuario_id == usuario.id, models.Modulo.ativo == True)
        .all()
    )
    resultado = []
    for m in modulos:
        # Gastos reais deste mês vinculados a este módulo (exclui receitas/transferências/abatimentos, alinhado ao Dashboard)
        parcelas_mes = db.query(models.Parcela).join(models.Lancamento).filter(
            models.Lancamento.usuario_id == usuario.id,
            models.Lancamento.modulo_id == m.id,
            models.Lancamento.tipo.notin_(TIPOS_NAO_DESPESA),
            models.Parcela.mes == (mes or hoje.month),
            models.Parcela.ano == (ano or hoje.year),
            models.Parcela.status != "cancelado",
            models.Lancamento.cancelado == False
        ).all()
        total_mes = sum(p.valor for p in parcelas_mes)

        resultado.append({
            "id": m.id,
            "nome": m.nome,
            "icone": m.icone,
            "cor": m.cor,
            "total_mes_atual": round(total_mes, 2),
            "subcategorias": [{"id": s.id, "nome": s.nome} for s in m.subcategorias],
            "ativo": m.ativo
        })
    return resultado

@router.post("/")
def criar_modulo(data: ModuloCreate, db: Session = Depends(get_db), usuario = Depends(auth.get_usuario_atual)):
    modulo = models.Modulo(**data.model_dump(), usuario_id=usuario.id)
    db.add(modulo)
    bump_user_sync_rev(db, usuario.id)
    db.commit()
    db.refresh(modulo)
    return modulo

@router.put("/{id}")
def atualizar_modulo(id: int, data: ModuloUpdate, db: Session = Depends(get_db), usuario = Depends(auth.get_usuario_atual)):
    modulo = (
        db.query(models.Modulo)
        .filter(models.Modulo.id == id, models.Modulo.usuario_id == usuario.id)
        .first()
    )
    if not modulo:
        raise HTTPException(status_code=404, detail="Módulo não encontrado.")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(modulo, k, v)
    bump_user_sync_rev(db, usuario.id)
    db.commit()
    db.refresh(modulo)
    return modulo

@router.delete("/{id}")
def desativar_modulo(id: int, db: Session = Depends(get_db), usuario = Depends(auth.get_usuario_atual)):
    modulo = (
        db.query(models.Modulo)
        .filter(models.Modulo.id == id, models.Modulo.usuario_id == usuario.id)
        .first()
    )
    if not modulo:
        raise HTTPException(status_code=404, detail="Módulo não encontrado.")
    modulo.ativo = False
    bump_user_sync_rev(db, usuario.id)
    db.commit()
    return {"ok": True, "mensagem": "Módulo desativado."}

@router.post("/subcategorias")
def criar_subcategoria(data: SubcategoriaCreate, db: Session = Depends(get_db), usuario = Depends(auth.get_usuario_atual)):
    modulo = (
        db.query(models.Modulo)
        .filter(models.Modulo.id == data.modulo_id, models.Modulo.usuario_id == usuario.id)
        .first()
    )
    if not modulo:
        raise HTTPException(status_code=404, detail="Módulo não encontrado.")
    sub = models.Subcategoria(**data.model_dump())
    db.add(sub)
    bump_user_sync_rev(db, usuario.id)
    db.commit()
    db.refresh(sub)
    return sub

@router.get("/{id}/gastos")
def gastos_modulo(id: int, mes: Optional[int] = None, ano: Optional[int] = None, db: Session = Depends(get_db), usuario = Depends(auth.get_usuario_atual)):
    hoje = date.today()
    mes = mes or hoje.month
    ano = ano or hoje.year

    modulo = (
        db.query(models.Modulo)
        .filter(models.Modulo.id == id, models.Modulo.usuario_id == usuario.id)
        .first()
    )
    if not modulo:
        raise HTTPException(status_code=404, detail="Módulo não encontrado.")

    parcelas = db.query(models.Parcela).join(models.Lancamento).filter(
        models.Lancamento.usuario_id == usuario.id,
        models.Lancamento.modulo_id == id,
        models.Lancamento.tipo.notin_(TIPOS_NAO_DESPESA),
        models.Parcela.mes == mes,
        models.Parcela.ano == ano,
        models.Parcela.status != "cancelado",
        models.Lancamento.cancelado == False
    ).order_by(models.Lancamento.data_lancamento.desc()).all()

    itens = []
    for p in parcelas:
        l = p.lancamento
        itens.append({
            "lancamento_id": l.id,
            "descricao": l.descricao,
            "tipo": l.tipo,
            "valor": p.valor,
            "parcela": f"{p.numero}/{l.total_parcelas}" if l.total_parcelas > 1 else "À vista",
            "pessoa": l.pessoa.nome if l.pessoa else "Você",
            "cartao": l.cartao.nome if l.cartao else None,
            "conta": l.conta.nome if l.conta else None,
            "data_lancamento": str(l.data_lancamento)
        })

    return {
        "modulo": {"id": modulo.id, "nome": modulo.nome, "cor": modulo.cor, "icone": modulo.icone},
        "mes": mes,
        "ano": ano,
        "total": round(sum(p.valor for p in parcelas), 2),
        "lancamentos": itens
    }
