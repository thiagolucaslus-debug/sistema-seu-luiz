from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
import models
import auth
from tenancy import bump_user_sync_rev
from services.calculos import calcular_total_fatura_cartao
from pydantic import BaseModel
from typing import Optional, List
from datetime import date
import calendar

router = APIRouter(prefix="/cartoes", tags=["cartoes"])

class CartaoCreate(BaseModel):
    nome: str
    bandeira: str = "Visa"
    dia_fechamento: int = 20
    dia_vencimento: int = 27
    limite: float = 0.0
    cor: str = "#2563eb"

class CartaoUpdate(BaseModel):
    nome: Optional[str] = None
    bandeira: Optional[str] = None
    dia_fechamento: Optional[int] = None
    dia_vencimento: Optional[int] = None
    limite: Optional[float] = None
    cor: Optional[str] = None
    ativo: Optional[bool] = None

class PagarFaturaRequest(BaseModel):
    mes: int
    ano: int
    valor: float
    data: date
    conta_id: Optional[int] = None

@router.get("/")
def listar_cartoes(inativos: bool = False, db: Session = Depends(get_db), usuario = Depends(auth.get_usuario_atual)):
    hoje = date.today()
    cartoes = (
        db.query(models.Cartao)
        .filter(
            models.Cartao.usuario_id == usuario.id,
            models.Cartao.ativo == (not inativos),
        )
        .all()
    )
    resultado = []
    for c in cartoes:
        fatura_atual = calcular_total_fatura_cartao(db, c.id, hoje.month, hoje.year)
        resultado.append({
            "id": c.id,
            "nome": c.nome,
            "bandeira": c.bandeira,
            "dia_fechamento": c.dia_fechamento,
            "dia_vencimento": c.dia_vencimento,
            "limite": c.limite,
            "cor": c.cor,
            "ativo": c.ativo,
            "fatura_mes_atual": fatura_atual
        })
    return resultado

@router.post("/")
def criar_cartao(data: CartaoCreate, db: Session = Depends(get_db), usuario = Depends(auth.get_usuario_atual)):
    cartao = models.Cartao(**data.model_dump(), usuario_id=usuario.id)
    db.add(cartao)
    bump_user_sync_rev(db, usuario.id)
    db.commit()
    db.refresh(cartao)
    return cartao

@router.put("/{id}")
def atualizar_cartao(id: int, data: CartaoUpdate, db: Session = Depends(get_db), usuario = Depends(auth.get_usuario_atual)):
    cartao = (
        db.query(models.Cartao)
        .filter(models.Cartao.id == id, models.Cartao.usuario_id == usuario.id)
        .first()
    )
    if not cartao:
        raise HTTPException(status_code=404, detail="Cartão não encontrado.")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(cartao, k, v)
    bump_user_sync_rev(db, usuario.id)
    db.commit()
    db.refresh(cartao)
    return cartao

@router.delete("/{id}")
def desativar_cartao(id: int, db: Session = Depends(get_db), usuario = Depends(auth.get_usuario_atual)):
    cartao = (
        db.query(models.Cartao)
        .filter(models.Cartao.id == id, models.Cartao.usuario_id == usuario.id)
        .first()
    )
    if not cartao:
        raise HTTPException(status_code=404, detail="Cartão não encontrado.")
    cartao.ativo = False
    bump_user_sync_rev(db, usuario.id)
    db.commit()
    return {"ok": True, "mensagem": "Cartão desativado."}

@router.get("/{id}/faturas")
def faturas_cartao(id: int, meses_atras: int = 6, meses_frente: int = 6, db: Session = Depends(get_db), usuario = Depends(auth.get_usuario_atual)):
    cartao = (
        db.query(models.Cartao)
        .filter(models.Cartao.id == id, models.Cartao.usuario_id == usuario.id)
        .first()
    )
    if not cartao:
        raise HTTPException(status_code=404, detail="Cartão não encontrado.")

    hoje = date.today()
    meses_lista = []

    # Meses passados até meses futuros
    for i in range(-meses_atras, meses_frente + 1):
        m = hoje.month + i
        a = hoje.year
        while m <= 0:
            m += 12
            a -= 1
        while m > 12:
            m -= 12
            a += 1
        meses_lista.append((a, m))

    nomes_meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

    faturas = []
    for a, m in meses_lista:
        info = calcular_total_fatura_cartao(db, id, m, a)

        # Lançamentos detalhados da fatura
        parcelas = db.query(models.Parcela).join(models.Lancamento).filter(
            models.Lancamento.cartao_id == id,
            models.Parcela.mes == m,
            models.Parcela.ano == a,
            models.Parcela.status != "cancelado",
            models.Lancamento.cancelado == False
        ).order_by(models.Lancamento.data_lancamento.asc()).all()

        itens = []
        for p in parcelas:
            l = p.lancamento
            itens.append({
                "parcela_id": p.id,
                "lancamento_id": l.id,
                "numero": p.numero,
                "total_parcelas": l.total_parcelas,
                "descricao": l.descricao,
                "parcela": f"{p.numero}/{l.total_parcelas}" if l.total_parcelas > 1 else "À vista",
                "valor": p.valor,
                "status": p.status,
                "pessoa": l.pessoa.nome if l.pessoa else "Você",
                "pessoa_foto": l.pessoa.foto_path if l.pessoa else None,
                "pessoa_cor": l.pessoa.cor if l.pessoa else None,
                "modulo": l.modulo.nome if l.modulo else None,
                "data_compra": str(l.data_lancamento),
                "data_lancamento": str(l.data_lancamento),
            })

        faturas.append({
            "mes": m,
            "ano": a,
            "nome_mes": f"{nomes_meses[m-1]}/{a}",
            "is_atual": (m == hoje.month and a == hoje.year),
            "is_passado": (a < hoje.year or (a == hoje.year and m < hoje.month)),
            "total": info["total"],
            "pago": info["fatura_paga"],
            "valor_pago": info["valor_pago_fatura"],
            "data_pagamento": info["data_pagamento_fatura"],
            "itens": itens,
            "lancamentos": itens,
        })

    return {
        "cartao": {
            "id": cartao.id,
            "nome": cartao.nome,
            "bandeira": cartao.bandeira,
            "limite": cartao.limite,
            "cor": cartao.cor,
            "dia_fechamento": cartao.dia_fechamento,
            "dia_vencimento": cartao.dia_vencimento
        },
        "faturas": faturas
    }

@router.post("/{id}/pagar-fatura")
def pagar_fatura(id: int, req: PagarFaturaRequest, db: Session = Depends(get_db), usuario = Depends(auth.get_usuario_atual)):
    cartao = (
        db.query(models.Cartao)
        .filter(models.Cartao.id == id, models.Cartao.usuario_id == usuario.id)
        .first()
    )
    if not cartao:
        raise HTTPException(status_code=404, detail="Cartão não encontrado.")

    if req.conta_id is not None:
        conta_ok = (
            db.query(models.ContaBancaria)
            .filter(
                models.ContaBancaria.id == req.conta_id,
                models.ContaBancaria.usuario_id == usuario.id,
            )
            .first()
        )
        if not conta_ok:
            raise HTTPException(status_code=400, detail="Conta bancária inválida.")

    existente = db.query(models.PagamentoFatura).filter(
        models.PagamentoFatura.cartao_id == id,
        models.PagamentoFatura.usuario_id == usuario.id,
        models.PagamentoFatura.mes == req.mes,
        models.PagamentoFatura.ano == req.ano
    ).first()

    if existente:
        existente.valor = req.valor
        existente.data = req.data
        existente.conta_id = req.conta_id
        bump_user_sync_rev(db, usuario.id)
        db.commit()
        return {"ok": True, "mensagem": f"Pagamento da fatura {req.mes:02d}/{req.ano} atualizado com sucesso."}

    pag = models.PagamentoFatura(
        usuario_id=usuario.id,
        cartao_id=id,
        mes=req.mes,
        ano=req.ano,
        valor=req.valor,
        data=req.data,
        conta_id=req.conta_id
    )
    db.add(pag)
    bump_user_sync_rev(db, usuario.id)
    db.commit()
    return {"ok": True, "mensagem": f"Pagamento da fatura {req.mes:02d}/{req.ano} registrado."}
