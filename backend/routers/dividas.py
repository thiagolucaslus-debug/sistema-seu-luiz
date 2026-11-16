from __future__ import annotations

from datetime import date
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

import auth
import models
from database import get_db
from services.dividas_service import (
    calcular_desconto_antecipacao,
    clamp_due_date,
    format_mes_ano,
    gerar_parcelas_iniciais_divida,
    montar_painel_dividas,
    months_between,
    serializar_divida_completa,
    simular_plano_quitacao,
)
from tenancy import bump_user_sync_rev

router = APIRouter(prefix="/dividas", tags=["dividas"])


class DividaCreate(BaseModel):
    nome: str = Field(min_length=1, max_length=150)
    credor: Optional[str] = Field(default=None, max_length=120)
    categoria: str = Field(default="Financiamento", max_length=80)
    tipo_compromisso: Literal["parcelada", "fixa"] = "parcelada"
    valor_parcela: float = Field(gt=0, allow_inf_nan=False)
    dia_vencimento: int = Field(default=10, ge=1, le=31)
    total_parcelas: Optional[int] = Field(default=None, ge=1, le=480)
    parcelas_pagas_anteriores: int = Field(default=0, ge=0, le=480)
    mes_inicio: Optional[int] = Field(default=None, ge=1, le=12)
    ano_inicio: Optional[int] = Field(default=None, ge=2000, le=2100)
    taxa_juros_mensal: float = Field(default=0.0, ge=0.0, le=50.0, allow_inf_nan=False)
    desconto_antecipacao_pct: float = Field(default=0.0, ge=0.0, le=95.0, allow_inf_nan=False)
    conta_padrao_id: Optional[int] = None
    modulo_id: Optional[int] = None
    cor: str = Field(default="#2563EB", max_length=20)
    observacoes: Optional[str] = None


class DividaUpdate(BaseModel):
    nome: Optional[str] = Field(default=None, min_length=1, max_length=150)
    credor: Optional[str] = Field(default=None, max_length=120)
    categoria: Optional[str] = Field(default=None, max_length=80)
    valor_parcela: Optional[float] = Field(default=None, gt=0, allow_inf_nan=False)
    dia_vencimento: Optional[int] = Field(default=None, ge=1, le=31)
    taxa_juros_mensal: Optional[float] = Field(default=None, ge=0.0, le=50.0, allow_inf_nan=False)
    desconto_antecipacao_pct: Optional[float] = Field(default=None, ge=0.0, le=95.0, allow_inf_nan=False)
    conta_padrao_id: Optional[int] = None
    limpar_conta_padrao: bool = False
    modulo_id: Optional[int] = None
    limpar_modulo: bool = False
    cor: Optional[str] = Field(default=None, max_length=20)
    observacoes: Optional[str] = None
    ativa: Optional[bool] = None


class PagarObrigacaoRequest(BaseModel):
    parcela_id: Optional[int] = None
    numero: Optional[int] = Field(default=None, ge=1)
    mes: Optional[int] = Field(default=None, ge=1, le=12)
    ano: Optional[int] = Field(default=None, ge=2000, le=2100)
    valor_pago: Optional[float] = Field(default=None, gt=0, allow_inf_nan=False)
    desconto: float = Field(default=0.0, ge=0.0, allow_inf_nan=False)
    data_pagamento: Optional[date] = None
    conta_id: Optional[int] = None
    forma_pagamento: Optional[str] = Field(default=None, max_length=80)
    observacao: Optional[str] = None


class EstornarObrigacaoRequest(BaseModel):
    parcela_id: Optional[int] = None
    numero: Optional[int] = Field(default=None, ge=1)
    mes: Optional[int] = Field(default=None, ge=1, le=12)
    ano: Optional[int] = Field(default=None, ge=2000, le=2100)


class AnteciparParcelasRequest(BaseModel):
    quantidade_parcelas: int = Field(ge=1, le=480)
    ordem: Literal["ultimas", "proximas"] = "ultimas"
    desconto_pct: Optional[float] = Field(default=None, ge=0.0, le=95.0, allow_inf_nan=False)
    valor_total_pago: Optional[float] = Field(default=None, gt=0, allow_inf_nan=False)
    data_pagamento: Optional[date] = None
    conta_id: Optional[int] = None
    forma_pagamento: Optional[str] = Field(default=None, max_length=80)
    observacao: Optional[str] = None


class AjusteMesRequest(BaseModel):
    mes: int = Field(ge=1, le=12)
    ano: int = Field(ge=2000, le=2100)
    novo_valor: float = Field(gt=0, allow_inf_nan=False)
    observacao: Optional[str] = None


class SimulacaoRequest(BaseModel):
    aporte_unico: float = Field(default=0.0, ge=0.0, allow_inf_nan=False)
    aporte_mensal_extra: float = Field(default=0.0, ge=0.0, allow_inf_nan=False)
    estrategia: Literal["avalanche", "bola_de_neve"] = "avalanche"
    divida_alvo_id: Optional[int] = None
    reinvestir_alivio: bool = True


def _validar_conta_usuario(
    db: Session, usuario_id: int, conta_id: Optional[int], exigir_ativa: bool = True
) -> Optional[models.ContaBancaria]:
    if conta_id is None:
        return None
    conta = (
        db.query(models.ContaBancaria)
        .filter(
            models.ContaBancaria.id == conta_id,
            models.ContaBancaria.usuario_id == usuario_id,
        )
        .first()
    )
    if not conta or (exigir_ativa and not conta.ativa):
        raise HTTPException(status_code=400, detail="Conta bancária inválida ou inativa.")
    return conta


def _validar_modulo_usuario(
    db: Session, usuario_id: int, modulo_id: Optional[int]
) -> Optional[models.Modulo]:
    if modulo_id is None:
        return None
    mod = (
        db.query(models.Modulo)
        .filter(models.Modulo.id == modulo_id, models.Modulo.usuario_id == usuario_id)
        .first()
    )
    if not mod:
        raise HTTPException(status_code=400, detail="Módulo inválido.")
    return mod


def _obter_divida_usuario(db: Session, usuario_id: int, divida_id: int) -> models.Divida:
    divida = (
        db.query(models.Divida)
        .filter(models.Divida.id == divida_id, models.Divida.usuario_id == usuario_id)
        .first()
    )
    if not divida:
        raise HTTPException(status_code=404, detail="Dívida ou compromisso não encontrado.")
    return divida


def _criar_lancamento_bancario_divida(
    db: Session,
    *,
    usuario_id: int,
    divida: models.Divida,
    parcela: models.DividaParcela,
    conta_id: int,
    valor_pago: float,
    data_pag: date,
    prefixo: str = "Pagamento Dívida",
    observacao: Optional[str] = None,
) -> models.Lancamento:
    rotulo = (
        f"Parcela {parcela.numero}/{divida.total_parcelas}"
        if divida.tipo_compromisso == "parcelada" and divida.total_parcelas
        else f"Competência {format_mes_ano(parcela.mes, parcela.ano)}"
    )
    lanc = models.Lancamento(
        usuario_id=usuario_id,
        descricao=f"{prefixo}: {divida.nome} ({rotulo})",
        tipo="despesa_conta",
        valor_total=round(float(valor_pago), 2),
        total_parcelas=1,
        data_lancamento=data_pag,
        mes_fatura=data_pag.month,
        ano_fatura=data_pag.year,
        conta_id=conta_id,
        modulo_id=divida.modulo_id,
        observacoes=observacao or f"Baixa integrada — {divida.nome} ({rotulo})",
        cancelado=False,
    )
    db.add(lanc)
    db.flush()

    parc_lanc = models.Parcela(
        lancamento_id=lanc.id,
        numero=1,
        valor=round(float(valor_pago), 2),
        mes=data_pag.month,
        ano=data_pag.year,
        vencimento=parcela.vencimento,
        data_pagamento=data_pag,
        status="pago",
    )
    db.add(parc_lanc)
    db.flush()
    return lanc


def _remover_lancamento_bancario_vinculado(
    db: Session, usuario_id: int, parcela: models.DividaParcela
) -> None:
    lanc_id = parcela.lancamento_id
    parcela.lancamento_id = None
    parcela.conta_id = None
    if not lanc_id:
        return
    db.flush()
    lanc = (
        db.query(models.Lancamento)
        .filter(models.Lancamento.id == lanc_id, models.Lancamento.usuario_id == usuario_id)
        .first()
    )
    if lanc:
        db.delete(lanc)


def _localizar_parcela_existente(
    divida: models.Divida,
    *,
    parcela_id: Optional[int],
    numero: Optional[int],
    mes: Optional[int],
    ano: Optional[int],
) -> Optional[models.DividaParcela]:
    if numero is not None and divida.tipo_compromisso == "parcelada":
        for p in divida.parcelas:
            if p.numero == numero:
                return p
    if mes is not None and ano is not None:
        for p in divida.parcelas:
            if p.mes == mes and p.ano == ano:
                return p
    if parcela_id is not None:
        for p in divida.parcelas:
            if p.id == parcela_id:
                return p
    return None


@router.get("/painel")
def obter_painel_completo(
    mes: Optional[int] = None,
    ano: Optional[int] = None,
    janela_dias: int = 15,
    incluir_inativas: bool = False,
    db: Session = Depends(get_db),
    usuario=Depends(auth.get_usuario_atual),
):
    janela_segura = max(1, min(90, int(janela_dias or 15)))
    return montar_painel_dividas(
        db,
        usuario.id,
        mes=mes,
        ano=ano,
        janela_dias=janela_segura,
        incluir_inativas=incluir_inativas,
    )


@router.get("/")
def listar_dividas(
    mes: Optional[int] = None,
    ano: Optional[int] = None,
    incluir_inativas: bool = False,
    db: Session = Depends(get_db),
    usuario=Depends(auth.get_usuario_atual),
):
    painel = montar_painel_dividas(
        db,
        usuario.id,
        mes=mes,
        ano=ano,
        incluir_inativas=incluir_inativas,
    )
    return painel["dividas"]


@router.post("/")
def criar_divida(
    data: DividaCreate,
    db: Session = Depends(get_db),
    usuario=Depends(auth.get_usuario_atual),
):
    hoje = date.today()
    nome_limpo = data.nome.strip()
    if not nome_limpo:
        raise HTTPException(status_code=400, detail="Informe o nome da dívida ou compromisso.")

    if data.tipo_compromisso == "parcelada":
        if not data.total_parcelas or data.total_parcelas < 1:
            raise HTTPException(
                status_code=400,
                detail="Informe a quantidade total de parcelas para dívidas parceladas.",
            )
        if data.parcelas_pagas_anteriores > data.total_parcelas:
            raise HTTPException(
                status_code=400,
                detail="As parcelas já pagas anteriormente não podem superar o total de parcelas.",
            )
        total_parc = int(data.total_parcelas)
        pagas_ant = int(data.parcelas_pagas_anteriores)
    else:
        total_parc = None
        pagas_ant = 0

    _validar_conta_usuario(db, usuario.id, data.conta_padrao_id, exigir_ativa=True)
    _validar_modulo_usuario(db, usuario.id, data.modulo_id)

    mes_ini = int(data.mes_inicio or hoje.month)
    ano_ini = int(data.ano_inicio or hoje.year)

    divida = models.Divida(
        usuario_id=usuario.id,
        nome=nome_limpo,
        credor=(data.credor or "").strip() or None,
        categoria=(data.categoria or "Financiamento").strip() or "Financiamento",
        tipo_compromisso=data.tipo_compromisso,
        valor_parcela=round(float(data.valor_parcela), 2),
        dia_vencimento=int(data.dia_vencimento),
        total_parcelas=total_parc,
        parcelas_pagas_anteriores=pagas_ant,
        mes_inicio=mes_ini,
        ano_inicio=ano_ini,
        taxa_juros_mensal=round(float(data.taxa_juros_mensal or 0.0), 2),
        desconto_antecipacao_pct=round(float(data.desconto_antecipacao_pct or 0.0), 2),
        conta_padrao_id=data.conta_padrao_id,
        modulo_id=data.modulo_id,
        cor=(data.cor or "#2563EB").strip() or "#2563EB",
        observacoes=(data.observacoes or "").strip() or None,
        ativa=True,
    )
    db.add(divida)
    db.flush()

    for parc in gerar_parcelas_iniciais_divida(divida):
        db.add(parc)

    bump_user_sync_rev(db, usuario.id)
    db.commit()
    db.refresh(divida)

    return serializar_divida_completa(
        divida,
        ref_date=hoje,
        mes_foco=hoje.month,
        ano_foco=hoje.year,
    )


@router.put("/{id}")
def atualizar_divida(
    id: int,
    data: DividaUpdate,
    db: Session = Depends(get_db),
    usuario=Depends(auth.get_usuario_atual),
):
    divida = _obter_divida_usuario(db, usuario.id, id)
    valor_antigo = round(float(divida.valor_parcela), 2)

    if data.nome is not None:
        nome_limpo = data.nome.strip()
        if not nome_limpo:
            raise HTTPException(status_code=400, detail="O nome não pode ficar vazio.")
        divida.nome = nome_limpo

    if data.credor is not None:
        divida.credor = data.credor.strip() or None
    if data.categoria is not None:
        divida.categoria = data.categoria.strip() or "Financiamento"
    if data.taxa_juros_mensal is not None:
        divida.taxa_juros_mensal = round(float(data.taxa_juros_mensal), 2)
    if data.desconto_antecipacao_pct is not None:
        divida.desconto_antecipacao_pct = round(float(data.desconto_antecipacao_pct), 2)
    if data.cor is not None:
        divida.cor = data.cor.strip() or divida.cor
    if data.observacoes is not None:
        divida.observacoes = data.observacoes.strip() or None
    if data.ativa is not None:
        divida.ativa = bool(data.ativa)

    if data.limpar_conta_padrao:
        divida.conta_padrao_id = None
    elif data.conta_padrao_id is not None:
        _validar_conta_usuario(db, usuario.id, data.conta_padrao_id, exigir_ativa=True)
        divida.conta_padrao_id = data.conta_padrao_id

    if data.limpar_modulo:
        divida.modulo_id = None
    elif data.modulo_id is not None:
        _validar_modulo_usuario(db, usuario.id, data.modulo_id)
        divida.modulo_id = data.modulo_id

    if data.dia_vencimento is not None:
        novo_dia = int(data.dia_vencimento)
        divida.dia_vencimento = novo_dia
        for p in divida.parcelas:
            if p.status == "pendente":
                p.vencimento = clamp_due_date(p.ano, p.mes, novo_dia)

    if data.valor_parcela is not None:
        novo_val = round(float(data.valor_parcela), 2)
        divida.valor_parcela = novo_val
        for p in divida.parcelas:
            if p.status == "pendente" and round(float(p.valor_atual), 2) == valor_antigo:
                p.valor_original = novo_val
                p.valor_atual = novo_val

    bump_user_sync_rev(db, usuario.id)
    db.commit()
    db.refresh(divida)

    hoje = date.today()
    return serializar_divida_completa(
        divida,
        ref_date=hoje,
        mes_foco=hoje.month,
        ano_foco=hoje.year,
    )


@router.delete("/{id}")
def excluir_divida(
    id: int,
    manter_lancamentos: bool = False,
    db: Session = Depends(get_db),
    usuario=Depends(auth.get_usuario_atual),
):
    divida = _obter_divida_usuario(db, usuario.id, id)

    lancamentos_removidos = 0
    for p in list(divida.parcelas):
        if p.lancamento_id and not manter_lancamentos:
            _remover_lancamento_bancario_vinculado(db, usuario.id, p)
            lancamentos_removidos += 1
        else:
            p.lancamento_id = None

    db.delete(divida)
    bump_user_sync_rev(db, usuario.id)
    db.commit()
    return {
        "ok": True,
        "mensagem": "Dívida excluída com sucesso.",
        "lancamentos_bancarios_revertidos": lancamentos_removidos,
    }


@router.post("/{id}/pagar")
def pagar_obrigacao_divida(
    id: int,
    req: PagarObrigacaoRequest,
    db: Session = Depends(get_db),
    usuario=Depends(auth.get_usuario_atual),
):
    divida = _obter_divida_usuario(db, usuario.id, id)
    conta = _validar_conta_usuario(db, usuario.id, req.conta_id, exigir_ativa=True)
    data_pag = req.data_pagamento or date.today()

    parcela = _localizar_parcela_existente(
        divida,
        parcela_id=req.parcela_id,
        numero=req.numero,
        mes=req.mes,
        ano=req.ano,
    )

    if parcela is None:
        if divida.tipo_compromisso == "fixa" and req.mes is not None and req.ano is not None:
            venc = clamp_due_date(req.ano, req.mes, divida.dia_vencimento)
            num_seq = max(1, months_between(divida.ano_inicio, divida.mes_inicio, req.ano, req.mes) + 1)
            val_padrao = round(float(divida.valor_parcela), 2)
            parcela = models.DividaParcela(
                usuario_id=usuario.id,
                divida_id=divida.id,
                numero=num_seq,
                mes=int(req.mes),
                ano=int(req.ano),
                vencimento=venc,
                valor_original=val_padrao,
                valor_atual=val_padrao,
                status="pendente",
            )
            db.add(parcela)
            db.flush()
        else:
            raise HTTPException(
                status_code=404,
                detail="Parcela ou competência não localizada para esta dívida.",
            )

    if parcela.status == "pago":
        raise HTTPException(
            status_code=400,
            detail="Esta parcela/competência já está marcada como paga.",
        )

    valor_base = round(float(parcela.valor_atual), 2)
    if req.valor_pago is not None:
        valor_efetivo = round(float(req.valor_pago), 2)
    else:
        valor_efetivo = round(max(0.01, valor_base - float(req.desconto or 0.0)), 2)

    desconto_calc = round(max(0.0, valor_base - valor_efetivo), 2)
    acrescimo_calc = round(max(0.0, valor_efetivo - valor_base), 2)

    forma = (req.forma_pagamento or "").strip() or (
        f"Débito em {conta.nome}" if conta else "Pagamento externo / dinheiro"
    )

    lanc = None
    if conta is not None:
        lanc = _criar_lancamento_bancario_divida(
            db,
            usuario_id=usuario.id,
            divida=divida,
            parcela=parcela,
            conta_id=conta.id,
            valor_pago=valor_efetivo,
            data_pag=data_pag,
            prefixo="Pagamento Dívida",
            observacao=req.observacao,
        )

    parcela.status = "pago"
    parcela.valor_pago = valor_efetivo
    parcela.desconto = desconto_calc
    parcela.acrescimo = acrescimo_calc
    parcela.data_pagamento = data_pag
    parcela.forma_pagamento = forma
    parcela.pago_anteriormente = False
    parcela.antecipada = False
    parcela.conta_id = conta.id if conta else None
    parcela.lancamento_id = lanc.id if lanc else None
    if req.observacao is not None:
        parcela.observacao = req.observacao.strip() or None

    bump_user_sync_rev(db, usuario.id)
    db.commit()

    return {
        "ok": True,
        "parcela_id": parcela.id,
        "lancamento_id": lanc.id if lanc else None,
        "valor_pago": valor_efetivo,
        "conta": conta.nome if conta else None,
        "mensagem": f"Baixa registrada com sucesso ({divida.nome}).",
    }


@router.post("/{id}/estornar")
def estornar_obrigacao_divida(
    id: int,
    req: EstornarObrigacaoRequest,
    db: Session = Depends(get_db),
    usuario=Depends(auth.get_usuario_atual),
):
    divida = _obter_divida_usuario(db, usuario.id, id)
    parcela = _localizar_parcela_existente(
        divida,
        parcela_id=req.parcela_id,
        numero=req.numero,
        mes=req.mes,
        ano=req.ano,
    )
    if parcela is None or parcela.status != "pago":
        raise HTTPException(
            status_code=400,
            detail="Nenhum pagamento ativo encontrado para estornar nesta competência.",
        )

    tinha_lancamento = parcela.lancamento_id is not None
    _remover_lancamento_bancario_vinculado(db, usuario.id, parcela)

    if (
        divida.tipo_compromisso == "fixa"
        and round(float(parcela.valor_atual), 2) == round(float(divida.valor_parcela), 2)
    ):
        db.delete(parcela)
    else:
        parcela.status = "pendente"
        parcela.valor_pago = None
        parcela.desconto = 0.0
        parcela.acrescimo = 0.0
        parcela.pago_anteriormente = False
        parcela.antecipada = False
        parcela.data_pagamento = None
        parcela.forma_pagamento = None

    bump_user_sync_rev(db, usuario.id)
    db.commit()
    return {
        "ok": True,
        "lancamento_revertido": tinha_lancamento,
        "mensagem": "Pagamento estornado e saldo bancário reconciliado.",
    }


@router.post("/{id}/antecipar")
def antecipar_parcelas_divida(
    id: int,
    req: AnteciparParcelasRequest,
    db: Session = Depends(get_db),
    usuario=Depends(auth.get_usuario_atual),
):
    divida = _obter_divida_usuario(db, usuario.id, id)
    if divida.tipo_compromisso != "parcelada":
        raise HTTPException(
            status_code=400,
            detail="A antecipação de parcelas aplica-se apenas a dívidas parceladas / financiamentos.",
        )

    conta = _validar_conta_usuario(db, usuario.id, req.conta_id, exigir_ativa=True)
    data_pag = req.data_pagamento or date.today()

    pendentes = sorted(
        [p for p in divida.parcelas if p.status == "pendente"],
        key=lambda p: (p.ano, p.mes, p.numero),
    )
    if not pendentes:
        raise HTTPException(status_code=400, detail="Todas as parcelas desta dívida já estão quitadas.")

    qtd = int(req.quantidade_parcelas)
    if qtd > len(pendentes):
        raise HTTPException(
            status_code=400,
            detail=f"Esta dívida possui apenas {len(pendentes)} parcela(s) pendente(s).",
        )

    selecionadas = pendentes[-qtd:] if req.ordem == "ultimas" else pendentes[:qtd]
    soma_nominal = round(sum(float(p.valor_atual) for p in selecionadas), 2)

    # Calcula quanto será pago em cada parcela selecionada garantindo precisão de centavos
    valores_por_parcela: list[float] = []
    if req.valor_total_pago is not None:
        total_negociado = round(float(req.valor_total_pago), 2)
        minimo_centavos = round(0.01 * len(selecionadas), 2)
        if total_negociado < minimo_centavos:
            raise HTTPException(
                status_code=400,
                detail=f"O valor total pago deve ser de no mínimo R$ {minimo_centavos:.2f} para {len(selecionadas)} parcela(s).",
            )
        acumulado = 0.0
        for idx, p in enumerate(selecionadas):
            if idx == len(selecionadas) - 1:
                v_p = round(max(0.01, total_negociado - acumulado), 2)
            else:
                peso = (float(p.valor_atual) / soma_nominal) if soma_nominal > 0 else (1.0 / len(selecionadas))
                max_restante = round(total_negociado - acumulado - 0.01 * (len(selecionadas) - 1 - idx), 2)
                v_p = min(max_restante, round(max(0.01, total_negociado * peso), 2))
                acumulado = round(acumulado + v_p, 2)
            valores_por_parcela.append(v_p)
    else:
        desc_pct = (
            float(req.desconto_pct)
            if req.desconto_pct is not None
            else float(divida.desconto_antecipacao_pct or 0.0)
        )
        for p in selecionadas:
            mf = max(0, months_between(data_pag.year, data_pag.month, p.ano, p.mes))
            vp, _ = calcular_desconto_antecipacao(
                p.valor_atual,
                mf,
                desc_pct,
                divida.taxa_juros_mensal if req.desconto_pct is None else 0.0,
            )
            valores_por_parcela.append(vp)

    forma = (req.forma_pagamento or "").strip() or (
        f"Antecipação via {conta.nome}" if conta else "Antecipação externa / dinheiro"
    )

    numeros_quitados: list[int] = []
    total_efetivo = 0.0
    total_desconto = 0.0

    for p, val_efetivo in zip(selecionadas, valores_por_parcela):
        val_orig = round(float(p.valor_atual), 2)
        desc_i = round(max(0.0, val_orig - val_efetivo), 2)
        acres_i = round(max(0.0, val_efetivo - val_orig), 2)

        lanc = None
        if conta is not None:
            lanc = _criar_lancamento_bancario_divida(
                db,
                usuario_id=usuario.id,
                divida=divida,
                parcela=p,
                conta_id=conta.id,
                valor_pago=val_efetivo,
                data_pag=data_pag,
                prefixo="Antecipação Dívida",
                observacao=req.observacao,
            )

        p.status = "pago"
        p.valor_pago = val_efetivo
        p.desconto = desc_i
        p.acrescimo = acres_i
        p.antecipada = True
        p.pago_anteriormente = False
        p.data_pagamento = data_pag
        p.forma_pagamento = forma
        p.conta_id = conta.id if conta else None
        p.lancamento_id = lanc.id if lanc else None
        if req.observacao is not None:
            p.observacao = req.observacao.strip() or None

        numeros_quitados.append(p.numero)
        total_efetivo = round(total_efetivo + val_efetivo, 2)
        total_desconto = round(total_desconto + desc_i, 2)

    bump_user_sync_rev(db, usuario.id)
    db.commit()

    return {
        "ok": True,
        "quantidade_antecipada": len(numeros_quitados),
        "parcelas_antecipadas": numeros_quitados,
        "valor_nominal_abatido": soma_nominal,
        "valor_total_pago": total_efetivo,
        "economia_desconto": total_desconto,
        "conta": conta.nome if conta else None,
        "mensagem": f"{len(numeros_quitados)} parcela(s) antecipada(s) com sucesso em {divida.nome}.",
    }


@router.put("/{id}/ajuste-mes")
def ajustar_valor_competencia(
    id: int,
    req: AjusteMesRequest,
    db: Session = Depends(get_db),
    usuario=Depends(auth.get_usuario_atual),
):
    divida = _obter_divida_usuario(db, usuario.id, id)
    parcela = _localizar_parcela_existente(
        divida, parcela_id=None, numero=None, mes=req.mes, ano=req.ano
    )

    if parcela is None:
        if divida.tipo_compromisso != "fixa":
            raise HTTPException(
                status_code=404,
                detail="Competência não encontrada nesta dívida parcelada.",
            )
        venc = clamp_due_date(req.ano, req.mes, divida.dia_vencimento)
        num_seq = max(1, months_between(divida.ano_inicio, divida.mes_inicio, req.ano, req.mes) + 1)
        parcela = models.DividaParcela(
            usuario_id=usuario.id,
            divida_id=divida.id,
            numero=num_seq,
            mes=int(req.mes),
            ano=int(req.ano),
            vencimento=venc,
            valor_original=round(float(divida.valor_parcela), 2),
            valor_atual=round(float(req.novo_valor), 2),
            status="pendente",
            observacao=(req.observacao or "").strip() or None,
        )
        db.add(parcela)
    else:
        if parcela.status == "pago":
            raise HTTPException(
                status_code=400,
                detail="Estorne o pagamento antes de ajustar o valor desta competência.",
            )
        parcela.valor_atual = round(float(req.novo_valor), 2)
        if req.observacao is not None:
            parcela.observacao = req.observacao.strip() or None

    bump_user_sync_rev(db, usuario.id)
    db.commit()
    return {
        "ok": True,
        "mes": req.mes,
        "ano": req.ano,
        "novo_valor": round(float(req.novo_valor), 2),
        "mensagem": f"Valor de {format_mes_ano(req.mes, req.ano)} ajustado com sucesso.",
    }


@router.post("/simular")
def simular_quitacao_endpoint(
    req: SimulacaoRequest,
    db: Session = Depends(get_db),
    usuario=Depends(auth.get_usuario_atual),
):
    dividas = (
        db.query(models.Divida)
        .filter(models.Divida.usuario_id == usuario.id, models.Divida.ativa == True)
        .all()
    )
    return simular_plano_quitacao(
        dividas,
        ref_date=date.today(),
        aporte_unico=req.aporte_unico,
        aporte_mensal_extra=req.aporte_mensal_extra,
        estrategia=req.estrategia,
        divida_alvo_id=req.divida_alvo_id,
        reinvestir_alivio=req.reinvestir_alivio,
    )
