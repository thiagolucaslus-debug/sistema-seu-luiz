from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import extract
from database import get_db
import models
import auth
from services.calculos import calcular_saldo_conta
from pydantic import BaseModel
from typing import Optional, List
from datetime import date
import calendar

router = APIRouter(prefix="/contas", tags=["contas"])

class ContaCreate(BaseModel):
    nome: str
    banco: str
    agencia: Optional[str] = None
    conta: Optional[str] = None
    saldo_inicial: float = 0.0
    tipo: str = "corrente"
    cor: str = "#3B82F6"

class ContaUpdate(BaseModel):
    nome: Optional[str] = None
    banco: Optional[str] = None
    agencia: Optional[str] = None
    conta: Optional[str] = None
    saldo_inicial: Optional[float] = None
    tipo: Optional[str] = None
    cor: Optional[str] = None
    ativa: Optional[bool] = None

@router.get("/")
def listar_contas(db: Session = Depends(get_db), usuario = Depends(auth.get_usuario_atual)):
    contas = db.query(models.ContaBancaria).filter(models.ContaBancaria.ativa == True).all()
    resultado = []
    for c in contas:
        saldo_atual = calcular_saldo_conta(db, c.id)
        resultado.append({
            "id": c.id,
            "nome": c.nome,
            "banco": c.banco,
            "agencia": c.agencia,
            "conta": c.conta,
            "saldo_inicial": c.saldo_inicial,
            "saldo_atual": saldo_atual,
            "tipo": c.tipo,
            "cor": c.cor,
            "ativa": c.ativa
        })
    return resultado

@router.post("/")
def criar_conta(data: ContaCreate, db: Session = Depends(get_db), usuario = Depends(auth.get_usuario_atual)):
    conta = models.ContaBancaria(**data.model_dump())
    db.add(conta)
    db.commit()
    db.refresh(conta)
    return conta

@router.put("/{id}")
def atualizar_conta(id: int, data: ContaUpdate, db: Session = Depends(get_db), usuario = Depends(auth.get_usuario_atual)):
    conta = db.query(models.ContaBancaria).filter(models.ContaBancaria.id == id).first()
    if not conta:
        raise HTTPException(status_code=404, detail="Conta bancária não encontrada.")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(conta, k, v)
    db.commit()
    db.refresh(conta)
    return conta

@router.delete("/{id}")
def desativar_conta(id: int, db: Session = Depends(get_db), usuario = Depends(auth.get_usuario_atual)):
    conta = db.query(models.ContaBancaria).filter(models.ContaBancaria.id == id).first()
    if not conta:
        raise HTTPException(status_code=404, detail="Conta bancária não encontrada.")
    conta.ativa = False
    db.commit()
    return {"ok": True, "mensagem": "Conta desativada com sucesso."}

@router.get("/{id}/extrato")
def extrato_conta(id: int, mes: Optional[int] = None, ano: Optional[int] = None, db: Session = Depends(get_db), usuario = Depends(auth.get_usuario_atual)):
    conta = db.query(models.ContaBancaria).filter(models.ContaBancaria.id == id).first()
    if not conta:
        raise HTTPException(status_code=404, detail="Conta bancária não encontrada.")

    saldo_atual = calcular_saldo_conta(db, id)

    # Busca lançamentos vinculados a esta conta
    q_lanc = db.query(models.Lancamento).filter(
        (models.Lancamento.conta_id == id) | (models.Lancamento.conta_destino_id == id),
        models.Lancamento.cancelado == False
    )

    if mes and ano:
        q_lanc = q_lanc.filter(
            extract('month', models.Lancamento.data_lancamento) == mes,
            extract('year', models.Lancamento.data_lancamento) == ano
        )

    lancamentos = q_lanc.order_by(models.Lancamento.data_lancamento.desc()).all()

    movimentacoes = []
    for l in lancamentos:
        entrada = (l.tipo == "receita") or (l.tipo == "transferencia" and l.conta_destino_id == id)
        movimentacoes.append({
            "id": l.id,
            "data": str(l.data_lancamento),
            "descricao": l.descricao,
            "tipo": l.tipo,
            "valor": l.valor_total,
            "entrada": entrada,
            "pessoa": l.pessoa.nome if l.pessoa else None,
            "modulo": l.modulo.nome if l.modulo else None
        })

    # Adiciona pagamentos recebidos de pessoas creditados nesta conta
    q_pags = db.query(models.PagamentoPessoa).filter(models.PagamentoPessoa.conta_id == id)
    if mes and ano:
        _, ult = calendar.monthrange(ano, mes)
        q_pags = q_pags.filter(
            models.PagamentoPessoa.data >= date(ano, mes, 1),
            models.PagamentoPessoa.data <= date(ano, mes, ult)
        )
    for p in q_pags.all():
        movimentacoes.append({
            "id": f"pp_{p.id}",
            "data": str(p.data),
            "descricao": f"Pagamento recebido de {p.pessoa.nome}",
            "tipo": "pagamento_pessoa",
            "valor": p.valor,
            "entrada": True,
            "pessoa": p.pessoa.nome,
            "modulo": "Pagamento Recebido"
        })

    # Adiciona pagamentos de faturas debitados desta conta
    q_fat = db.query(models.PagamentoFatura).filter(models.PagamentoFatura.conta_id == id)
    if mes and ano:
        _, ult = calendar.monthrange(ano, mes)
        q_fat = q_fat.filter(
            models.PagamentoFatura.data >= date(ano, mes, 1),
            models.PagamentoFatura.data <= date(ano, mes, ult)
        )
    for f in q_fat.all():
        movimentacoes.append({
            "id": f"pf_{f.id}",
            "data": str(f.data),
            "descricao": f"Pagamento Fatura {f.cartao.nome} ({f.mes:02d}/{f.ano})",
            "tipo": "pagamento_fatura",
            "valor": f.valor,
            "entrada": False,
            "pessoa": None,
            "modulo": "Fatura de Cartão"
        })

    movimentacoes.sort(key=lambda x: x["data"], reverse=True)

    return {
        "conta": {
            "id": conta.id,
            "nome": conta.nome,
            "banco": conta.banco,
            "saldo_inicial": conta.saldo_inicial,
            "saldo_atual": saldo_atual,
            "cor": conta.cor
        },
        "movimentacoes": movimentacoes
    }
