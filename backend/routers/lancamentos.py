from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
import models
import auth
from pydantic import BaseModel
from typing import Optional, List
from datetime import date
import calendar

router = APIRouter(prefix="/lancamentos", tags=["lancamentos"])

class LancamentoCreate(BaseModel):
    descricao: str
    tipo: str  # compra_cartao, despesa_conta, emprestimo_dado, receita, transferencia
    valor_total: float
    total_parcelas: int = 1
    data_lancamento: date
    mes_fatura: Optional[int] = None
    ano_fatura: Optional[int] = None
    cartao_id: Optional[int] = None
    conta_id: Optional[int] = None
    conta_destino_id: Optional[int] = None
    pessoa_id: Optional[int] = None
    modulo_id: Optional[int] = None
    subcategoria_id: Optional[int] = None
    observacoes: Optional[str] = None

def determinar_mes_inicial_fatura(cartao: Optional[models.Cartao], data_compra: date, mes_escolhido: Optional[int], ano_escolhido: Optional[int]):
    if mes_escolhido and ano_escolhido:
        return mes_escolhido, ano_escolhido

    if cartao:
        # Se a compra foi feita após o dia de fechamento do cartão, entra na fatura do mês seguinte
        if data_compra.day > cartao.dia_fechamento:
            if data_compra.month == 12:
                return 1, data_compra.year + 1
            return data_compra.month + 1, data_compra.year
        return data_compra.month, data_compra.year

    return data_compra.month, data_compra.year

def gerar_parcelas(lancamento_id: int, valor_total: float, total_parcelas: int, mes_inicial: int, ano_inicial: int):
    parcelas = []
    total_parcelas = max(1, total_parcelas)
    valor_base = round(valor_total / total_parcelas, 2)
    soma_calculada = round(valor_base * total_parcelas, 2)
    diferenca = round(valor_total - soma_calculada, 2)

    cur_mes = mes_inicial
    cur_ano = ano_inicial

    for i in range(1, total_parcelas + 1):
        v = valor_base
        if i == total_parcelas:  # ajusta centavos residuais na última
            v = round(v + diferenca, 2)

        parcelas.append(models.Parcela(
            lancamento_id=lancamento_id,
            numero=i,
            valor=v,
            mes=cur_mes,
            ano=cur_ano,
            status="pendente"
        ))

        cur_mes += 1
        if cur_mes > 12:
            cur_mes = 1
            cur_ano += 1

    return parcelas

@router.get("/")
def listar_lancamentos(
    mes: Optional[int] = None,
    ano: Optional[int] = None,
    pessoa_id: Optional[int] = None,
    cartao_id: Optional[int] = None,
    conta_id: Optional[int] = None,
    modulo_id: Optional[int] = None,
    tipo: Optional[str] = None,
    limit: int = 200,
    offset: int = 0,
    db: Session = Depends(get_db),
    usuario = Depends(auth.get_usuario_atual)
):
    query = db.query(models.Lancamento).filter(models.Lancamento.cancelado == False)

    if pessoa_id:
        query = query.filter(models.Lancamento.pessoa_id == pessoa_id)
    if cartao_id:
        query = query.filter(models.Lancamento.cartao_id == cartao_id)
    if conta_id:
        query = query.filter(models.Lancamento.conta_id == conta_id)
    if modulo_id:
        query = query.filter(models.Lancamento.modulo_id == modulo_id)
    if tipo:
        query = query.filter(models.Lancamento.tipo == tipo)

    if mes and ano:
        query = query.filter(
            models.Lancamento.parcelas.any(
                (models.Parcela.mes == mes) & (models.Parcela.ano == ano)
            )
        )

    total = query.count()
    itens_db = query.order_by(models.Lancamento.data_lancamento.desc()).offset(offset).limit(limit).all()

    items = []
    for l in itens_db:
        items.append({
            "id": l.id,
            "descricao": l.descricao,
            "tipo": l.tipo,
            "valor_total": l.valor_total,
            "total_parcelas": l.total_parcelas,
            "data_lancamento": str(l.data_lancamento),
            "cartao": {"id": l.cartao.id, "nome": l.cartao.nome, "bandeira": l.cartao.bandeira, "cor": l.cartao.cor} if l.cartao else None,
            "conta": {"id": l.conta.id, "nome": l.conta.nome} if l.conta else None,
            "conta_destino": {"id": l.conta_destino.id, "nome": l.conta_destino.nome} if l.conta_destino else None,
            "pessoa": {"id": l.pessoa.id, "nome": l.pessoa.nome, "cor": l.pessoa.cor, "foto_path": l.pessoa.foto_path} if l.pessoa else None,
            "modulo": {"id": l.modulo.id, "nome": l.modulo.nome, "cor": l.modulo.cor} if l.modulo else None,
            "observacoes": l.observacoes,
            "parcelas": [
                {
                    "id": p.id,
                    "numero": p.numero,
                    "valor": p.valor,
                    "mes": p.mes,
                    "ano": p.ano,
                    "status": p.status
                }
                for p in l.parcelas
            ]
        })

    return {"total": total, "items": items}

@router.post("/")
def criar_lancamento(data: LancamentoCreate, db: Session = Depends(get_db), usuario = Depends(auth.get_usuario_atual)):
    cartao = None
    if data.cartao_id:
        cartao = db.query(models.Cartao).filter(models.Cartao.id == data.cartao_id).first()
        if not cartao or not cartao.ativo:
            raise HTTPException(400, "Selecione um cartão ativo.")

    lancamento = models.Lancamento(
        descricao=data.descricao,
        tipo=data.tipo,
        valor_total=round(data.valor_total, 2),
        total_parcelas=max(1, data.total_parcelas),
        data_lancamento=data.data_lancamento,
        mes_fatura=data.mes_fatura,
        ano_fatura=data.ano_fatura,
        cartao_id=data.cartao_id,
        conta_id=data.conta_id,
        conta_destino_id=data.conta_destino_id,
        pessoa_id=data.pessoa_id,
        modulo_id=data.modulo_id,
        subcategoria_id=data.subcategoria_id,
        observacoes=data.observacoes
    )
    db.add(lancamento)
    db.flush()

    mes_ini, ano_ini = determinar_mes_inicial_fatura(cartao, data.data_lancamento, data.mes_fatura, data.ano_fatura)
    parcelas = gerar_parcelas(lancamento.id, lancamento.valor_total, lancamento.total_parcelas, mes_ini, ano_ini)
    for p in parcelas:
        db.add(p)

    db.commit()
    db.refresh(lancamento)

    return {
        "id": lancamento.id,
        "descricao": lancamento.descricao,
        "tipo": lancamento.tipo,
        "valor_total": lancamento.valor_total,
        "total_parcelas": lancamento.total_parcelas,
        "parcelas_criadas": len(parcelas),
        "fatura_inicial": f"{mes_ini:02d}/{ano_ini}"
    }

@router.delete("/{id}")
def cancelar_lancamento(id: int, db: Session = Depends(get_db), usuario = Depends(auth.get_usuario_atual)):
    lanc = db.query(models.Lancamento).filter(models.Lancamento.id == id).first()
    if not lanc:
        raise HTTPException(status_code=404, detail="Lançamento não encontrado.")
    lanc.cancelado = True
    for p in lanc.parcelas:
        p.status = "cancelado"
    db.commit()
    return {"ok": True, "mensagem": "Lançamento cancelado com sucesso."}

@router.patch("/{id}/parcela/{numero}/status")
def alterar_status_parcela(id: int, numero: int, status: str, db: Session = Depends(get_db), usuario = Depends(auth.get_usuario_atual)):
    if status not in ["pendente", "pago", "cancelado"]:
        raise HTTPException(status_code=400, detail="Status inválido.")

    parcela = db.query(models.Parcela).filter(
        models.Parcela.lancamento_id == id,
        models.Parcela.numero == numero
    ).first()

    if not parcela:
        raise HTTPException(status_code=404, detail="Parcela não encontrada.")

    parcela.status = status
    if status == "pago":
        parcela.data_pagamento = date.today()
    else:
        parcela.data_pagamento = None

    db.commit()
    return {"ok": True, "mensagem": f"Parcela {numero} marcada como {status}."}
