from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session
from database import get_db
import models
import auth
from tenancy import bump_user_sync_rev
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
    busca: Optional[str] = None,
    limit: int = 200,
    offset: int = 0,
    db: Session = Depends(get_db),
    usuario = Depends(auth.get_usuario_atual)
):
    query = db.query(models.Lancamento).filter(
        models.Lancamento.usuario_id == usuario.id,
        models.Lancamento.cancelado == False,
    )

    if pessoa_id:
        query = query.filter(models.Lancamento.pessoa_id == pessoa_id)
    if cartao_id:
        query = query.filter(models.Lancamento.cartao_id == cartao_id)
    if conta_id:
        query = query.filter(
            or_(
                models.Lancamento.conta_id == conta_id,
                models.Lancamento.conta_destino_id == conta_id,
            )
        )
    if modulo_id:
        query = query.filter(models.Lancamento.modulo_id == modulo_id)
    if tipo:
        query = query.filter(models.Lancamento.tipo == tipo)
    if busca and busca.strip():
        termo = f"%{busca.strip()}%"
        query = query.filter(
            or_(
                models.Lancamento.descricao.ilike(termo),
                models.Lancamento.observacoes.ilike(termo),
            )
        )

    limit = max(1, min(int(limit or 200), 1000))
    offset = max(0, int(offset or 0))

    if mes and ano:
        _, ultimo_dia = calendar.monthrange(ano, mes)
        inicio_mes = date(ano, mes, 1)
        fim_mes = date(ano, mes, ultimo_dia)
        query = query.filter(
            or_(
                models.Lancamento.parcelas.any(
                    (models.Parcela.mes == mes)
                    & (models.Parcela.ano == ano)
                    & (models.Parcela.status != "cancelado")
                ),
                and_(
                    models.Lancamento.data_lancamento >= inicio_mes,
                    models.Lancamento.data_lancamento <= fim_mes,
                ),
            )
        )

    total = query.count()
    itens_db = (
        query.order_by(models.Lancamento.data_lancamento.desc(), models.Lancamento.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    items = []
    for l in itens_db:
        parcelas_ordenadas = sorted(l.parcelas, key=lambda p: p.numero)
        ativas = [p for p in parcelas_ordenadas if p.status != "cancelado"]
        primeira_ativa = ativas[0] if ativas else (parcelas_ordenadas[0] if parcelas_ordenadas else None)
        mes_fat_ini = l.mes_fatura or (primeira_ativa.mes if primeira_ativa else l.data_lancamento.month)
        ano_fat_ini = l.ano_fatura or (primeira_ativa.ano if primeira_ativa else l.data_lancamento.year)
        parcela_mes = None
        if mes and ano:
            p_match = next(
                (p for p in ativas if p.mes == mes and p.ano == ano),
                None,
            )
            if p_match:
                parcela_mes = {
                    "id": p_match.id,
                    "numero": p_match.numero,
                    "valor": p_match.valor,
                    "mes": p_match.mes,
                    "ano": p_match.ano,
                    "status": p_match.status,
                }
        items.append({
            "id": l.id,
            "descricao": l.descricao,
            "tipo": l.tipo,
            "valor_total": l.valor_total,
            "total_parcelas": l.total_parcelas,
            "data_lancamento": str(l.data_lancamento),
            "mes_fatura": mes_fat_ini,
            "ano_fatura": ano_fat_ini,
            "fatura_inicial": f"{mes_fat_ini:02d}/{ano_fat_ini}",
            "parcela_mes": parcela_mes,
            "cartao": {"id": l.cartao.id, "nome": l.cartao.nome, "bandeira": l.cartao.bandeira, "cor": l.cartao.cor} if l.cartao else None,
            "conta": {"id": l.conta.id, "nome": l.conta.nome} if l.conta else None,
            "conta_destino": {"id": l.conta_destino.id, "nome": l.conta_destino.nome} if l.conta_destino else None,
            "pessoa": {"id": l.pessoa.id, "nome": l.pessoa.nome, "cor": l.pessoa.cor, "foto_path": l.pessoa.foto_path} if l.pessoa else None,
            "modulo": {"id": l.modulo.id, "nome": l.modulo.nome, "cor": l.modulo.cor} if l.modulo else None,
            "observacoes": l.observacoes,
            "comprovante_path": l.comprovante_path,
            "parcelas": [
                {
                    "id": p.id,
                    "numero": p.numero,
                    "valor": p.valor,
                    "mes": p.mes,
                    "ano": p.ano,
                    "status": p.status
                }
                for p in parcelas_ordenadas
            ]
        })

    return {"total": total, "items": items}

TIPOS_LANCAMENTO_VALIDOS = {t.value for t in models.TipoLancamento}


@router.post("/")
def criar_lancamento(data: LancamentoCreate, db: Session = Depends(get_db), usuario = Depends(auth.get_usuario_atual)):
    descricao_limpa = (data.descricao or "").strip()
    if not descricao_limpa:
        raise HTTPException(400, "Informe a descrição do lançamento.")

    if data.tipo not in TIPOS_LANCAMENTO_VALIDOS:
        raise HTTPException(400, "Tipo de lançamento inválido.")

    if data.valor_total is None or data.valor_total <= 0:
        raise HTTPException(400, "Informe um valor maior que zero.")

    if data.total_parcelas is None or data.total_parcelas < 1 or data.total_parcelas > 120:
        raise HTTPException(400, "O número de parcelas deve estar entre 1 e 120.")

    if data.mes_fatura is not None and not (1 <= int(data.mes_fatura) <= 12):
        raise HTTPException(400, "Mês da fatura inválido (use 1 a 12).")
    if data.ano_fatura is not None and not (2000 <= int(data.ano_fatura) <= 2100):
        raise HTTPException(400, "Ano da fatura inválido.")

    if data.tipo == "compra_cartao" and not data.cartao_id:
        raise HTTPException(400, "Selecione um cartão ativo para compras no cartão.")

    if data.tipo == "transferencia":
        if not data.conta_id or not data.conta_destino_id:
            raise HTTPException(400, "Selecione as contas de origem e destino para a transferência.")
        if data.conta_id == data.conta_destino_id:
            raise HTTPException(400, "A conta de destino deve ser diferente da conta de origem.")

    cartao = None
    if data.cartao_id:
        cartao = (
            db.query(models.Cartao)
            .filter(models.Cartao.id == data.cartao_id, models.Cartao.usuario_id == usuario.id)
            .first()
        )
        if not cartao or not cartao.ativo:
            raise HTTPException(400, "Selecione um cartão ativo.")

    if data.conta_id:
        conta = (
            db.query(models.ContaBancaria)
            .filter(models.ContaBancaria.id == data.conta_id, models.ContaBancaria.usuario_id == usuario.id)
            .first()
        )
        if not conta:
            raise HTTPException(400, "Conta bancária inválida.")

    if data.conta_destino_id:
        conta_dest = (
            db.query(models.ContaBancaria)
            .filter(models.ContaBancaria.id == data.conta_destino_id, models.ContaBancaria.usuario_id == usuario.id)
            .first()
        )
        if not conta_dest:
            raise HTTPException(400, "Conta bancária de destino inválida.")

    if data.pessoa_id:
        pessoa = (
            db.query(models.Pessoa)
            .filter(models.Pessoa.id == data.pessoa_id, models.Pessoa.usuario_id == usuario.id)
            .first()
        )
        if not pessoa:
            raise HTTPException(400, "Pessoa inválida.")

    if data.modulo_id:
        modulo = (
            db.query(models.Modulo)
            .filter(models.Modulo.id == data.modulo_id, models.Modulo.usuario_id == usuario.id)
            .first()
        )
        if not modulo:
            raise HTTPException(400, "Módulo inválido.")

    mes_ini, ano_ini = determinar_mes_inicial_fatura(cartao, data.data_lancamento, data.mes_fatura, data.ano_fatura)

    lancamento = models.Lancamento(
        usuario_id=usuario.id,
        descricao=descricao_limpa,
        tipo=data.tipo,
        valor_total=round(data.valor_total, 2),
        total_parcelas=max(1, data.total_parcelas),
        data_lancamento=data.data_lancamento,
        mes_fatura=mes_ini,
        ano_fatura=ano_ini,
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

    parcelas = gerar_parcelas(lancamento.id, lancamento.valor_total, lancamento.total_parcelas, mes_ini, ano_ini)
    for p in parcelas:
        db.add(p)

    bump_user_sync_rev(db, usuario.id)
    db.commit()
    db.refresh(lancamento)

    return {
        "id": lancamento.id,
        "descricao": lancamento.descricao,
        "tipo": lancamento.tipo,
        "valor_total": lancamento.valor_total,
        "total_parcelas": lancamento.total_parcelas,
        "data_lancamento": str(lancamento.data_lancamento),
        "mes_fatura": mes_ini,
        "ano_fatura": ano_ini,
        "parcelas_criadas": len(parcelas),
        "fatura_inicial": f"{mes_ini:02d}/{ano_ini}"
    }

def _reconciliar_divida_lancamento(db: Session, lanc_id: int, usuario_id: int) -> None:
    parcelas_divida = (
        db.query(models.DividaParcela)
        .filter(
            models.DividaParcela.lancamento_id == lanc_id,
            models.DividaParcela.usuario_id == usuario_id,
        )
        .all()
    )
    for pd in parcelas_divida:
        pd.lancamento_id = None
        pd.conta_id = None
        if (
            pd.divida
            and pd.divida.tipo_compromisso == "fixa"
            and round(float(pd.valor_atual), 2) == round(float(pd.divida.valor_parcela), 2)
            and not (pd.observacao or "").strip()
        ):
            db.delete(pd)
        else:
            pd.status = "pendente"
            pd.valor_pago = None
            pd.desconto = 0.0
            pd.acrescimo = 0.0
            pd.antecipada = False
            pd.pago_anteriormente = False
            pd.data_pagamento = None
            pd.forma_pagamento = None


@router.delete("/{id}")
def cancelar_lancamento(id: int, db: Session = Depends(get_db), usuario = Depends(auth.get_usuario_atual)):
    lanc = (
        db.query(models.Lancamento)
        .filter(models.Lancamento.id == id, models.Lancamento.usuario_id == usuario.id)
        .first()
    )
    if not lanc:
        raise HTTPException(status_code=404, detail="Lançamento não encontrado.")
    lanc.cancelado = True
    for p in lanc.parcelas:
        p.status = "cancelado"

    _reconciliar_divida_lancamento(db, lanc.id, usuario.id)

    bump_user_sync_rev(db, usuario.id)
    db.commit()
    return {"ok": True, "mensagem": "Lançamento cancelado com sucesso."}

@router.patch("/{id}/parcela/{numero}/status")
def alterar_status_parcela(id: int, numero: int, status: str, db: Session = Depends(get_db), usuario = Depends(auth.get_usuario_atual)):
    if status not in ["pendente", "pago", "cancelado"]:
        raise HTTPException(status_code=400, detail="Status inválido.")

    parcela = (
        db.query(models.Parcela)
        .join(models.Lancamento)
        .filter(
            models.Parcela.lancamento_id == id,
            models.Parcela.numero == numero,
            models.Lancamento.usuario_id == usuario.id,
        )
        .first()
    )

    if not parcela:
        raise HTTPException(status_code=404, detail="Parcela não encontrada.")

    parcela.status = status
    if status == "pago":
        parcela.data_pagamento = date.today()
    else:
        parcela.data_pagamento = None

    lanc = parcela.lancamento
    if lanc and lanc.parcelas:
        if all(p.status == "cancelado" for p in lanc.parcelas):
            lanc.cancelado = True
            _reconciliar_divida_lancamento(db, lanc.id, usuario.id)
        elif status != "cancelado" and lanc.cancelado:
            lanc.cancelado = False

    bump_user_sync_rev(db, usuario.id)
    db.commit()
    return {"ok": True, "mensagem": f"Parcela {numero} marcada como {status}."}
