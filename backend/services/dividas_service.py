from __future__ import annotations

import calendar
from datetime import date, timedelta
from typing import Any, Optional

from sqlalchemy.orm import Session

import models

NOMES_MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]


def clamp_due_date(ano: int, mes: int, dia_vencimento: int) -> date:
    """Ajusta automaticamente dias 29/30/31 para o último dia válido de meses curtos (ex.: fevereiro)."""
    ano_limpo = int(ano)
    mes_limpo = max(1, min(12, int(mes)))
    dia_limpo = max(1, min(31, int(dia_vencimento)))
    _, ultimo_dia = calendar.monthrange(ano_limpo, mes_limpo)
    return date(ano_limpo, mes_limpo, min(dia_limpo, ultimo_dia))


def add_months(ano: int, mes: int, delta: int) -> tuple[int, int]:
    total = (int(ano) * 12 + (int(mes) - 1)) + int(delta)
    return total // 12, (total % 12) + 1


def months_between(ano_ini: int, mes_ini: int, ano_fim: int, mes_fim: int) -> int:
    return (int(ano_fim) * 12 + (int(mes_fim) - 1)) - (int(ano_ini) * 12 + (int(mes_ini) - 1))


def format_mes_ano(mes: int, ano: int) -> str:
    m = max(1, min(12, int(mes)))
    return f"{NOMES_MESES[m - 1]}/{int(ano)}"


def calcular_desconto_antecipacao(
    valor: float,
    meses_antecipados: int,
    desconto_antecipacao_pct: float = 0.0,
    taxa_juros_mensal: float = 0.0,
) -> tuple[float, float]:
    """
    Retorna (valor_com_desconto, desconto_obtido).
    - Se `desconto_antecipacao_pct > 0`: aplica o desconto percentual configurado por parcela antecipada.
    - Caso contrário, se `taxa_juros_mensal > 0` e `meses_antecipados > 0`: calcula valor presente CDC.
    """
    val = round(max(0.0, float(valor or 0.0)), 2)
    if val <= 0:
        return 0.0, 0.0

    desc_pct = float(desconto_antecipacao_pct or 0.0)
    juros_am = float(taxa_juros_mensal or 0.0)

    if desc_pct > 0:
        pct = min(95.0, max(0.0, desc_pct))
        desconto = round(val * (pct / 100.0), 2)
        pago = round(max(0.01, val - desconto), 2)
        return pago, round(val - pago, 2)

    if juros_am > 0 and meses_antecipados > 0:
        taxa = min(50.0, max(0.0, juros_am)) / 100.0
        vp = round(val / ((1.0 + taxa) ** max(1, int(meses_antecipados))), 2)
        pago = min(val, max(0.01, vp))
        return pago, round(val - pago, 2)

    return val, 0.0


def classificar_vencimento(
    status: str,
    vencimento: date,
    ref_date: date,
    janela_dias: int = 15,
) -> dict[str, Any]:
    if status == "pago":
        return {
            "situacao": "pago",
            "dias_para_vencer": None,
            "dias_atraso": 0,
            "rotulo_vencimento": f"Quitada — Dia {vencimento.day:02d}",
        }

    diff = (vencimento - ref_date).days
    if diff < 0:
        atraso = abs(diff)
        palavra = "dia" if atraso == 1 else "dias"
        return {
            "situacao": "atrasada",
            "dias_para_vencer": diff,
            "dias_atraso": atraso,
            "rotulo_vencimento": f"Atrasada há {atraso} {palavra} — Dia {vencimento.day:02d}",
        }
    if diff == 0:
        return {
            "situacao": "vencendo_hoje",
            "dias_para_vencer": 0,
            "dias_atraso": 0,
            "rotulo_vencimento": f"Vence hoje — Dia {vencimento.day:02d}",
        }
    if diff == 1:
        return {
            "situacao": "proxima",
            "dias_para_vencer": 1,
            "dias_atraso": 0,
            "rotulo_vencimento": f"Amanhã — Dia {vencimento.day:02d}",
        }
    if diff <= janela_dias:
        return {
            "situacao": "proxima",
            "dias_para_vencer": diff,
            "dias_atraso": 0,
            "rotulo_vencimento": f"Faltam {diff} dias — Dia {vencimento.day:02d}",
        }
    return {
        "situacao": "agendada",
        "dias_para_vencer": diff,
        "dias_atraso": 0,
        "rotulo_vencimento": f"Dia {vencimento.day:02d}/{vencimento.month:02d} (em {diff} dias)",
    }


def gerar_parcelas_iniciais_divida(divida: models.Divida) -> list[models.DividaParcela]:
    """
    Gera a grade completa de parcelas para financiamentos/dívidas parceladas.
    Se `parcelas_pagas_anteriores > 0`, grava as parcelas anteriores nos meses precedentes
    marcadas como `pago_anteriormente=True` (sem movimentar contas bancárias), posicionando
    a próxima parcela pendente exatamente em `(mes_inicio, ano_inicio)`.
    """
    if divida.tipo_compromisso != "parcelada":
        return []

    total = max(1, int(divida.total_parcelas or 1))
    pagas_ant = max(0, min(total, int(divida.parcelas_pagas_anteriores or 0)))
    valor_base = round(float(divida.valor_parcela), 2)

    anchor_num = (pagas_ant + 1) if pagas_ant < total else total
    parcelas: list[models.DividaParcela] = []

    for numero in range(1, total + 1):
        delta = numero - anchor_num
        ano_p, mes_p = add_months(divida.ano_inicio, divida.mes_inicio, delta)
        venc_p = clamp_due_date(ano_p, mes_p, divida.dia_vencimento)
        foi_paga_antes = numero <= pagas_ant

        parcelas.append(
            models.DividaParcela(
                usuario_id=divida.usuario_id,
                divida_id=divida.id,
                numero=numero,
                mes=mes_p,
                ano=ano_p,
                vencimento=venc_p,
                valor_original=valor_base,
                valor_atual=valor_base,
                valor_pago=valor_base if foi_paga_antes else None,
                desconto=0.0,
                acrescimo=0.0,
                status="pago" if foi_paga_antes else "pendente",
                pago_anteriormente=foi_paga_antes,
                antecipada=False,
                data_pagamento=venc_p if foi_paga_antes else None,
                forma_pagamento="Pago antes do cadastro" if foi_paga_antes else None,
                conta_id=None,
                lancamento_id=None,
                observacao="Parcela quitada antes do cadastro" if foi_paga_antes else None,
            )
        )

    return parcelas


def _serializar_ocorrencia(
    divida: models.Divida,
    *,
    parcela: Optional[models.DividaParcela],
    ano: int,
    mes: int,
    ref_date: date,
    janela_dias: int = 15,
) -> dict[str, Any]:
    if parcela is not None:
        venc = parcela.vencimento
        status = parcela.status
        valor_original = round(float(parcela.valor_original), 2)
        valor_atual = round(float(parcela.valor_atual), 2)
        valor_pago = round(float(parcela.valor_pago), 2) if parcela.valor_pago is not None else None
        desconto = round(float(parcela.desconto or 0.0), 2)
        acrescimo = round(float(parcela.acrescimo or 0.0), 2)
        numero = int(parcela.numero)
        parcela_id = parcela.id
        conta_obj = (
            {"id": parcela.conta.id, "nome": parcela.conta.nome, "cor": parcela.conta.cor}
            if parcela.conta
            else None
        )
        data_pag_str = parcela.data_pagamento.isoformat() if parcela.data_pagamento else None
        forma_pag = parcela.forma_pagamento
        pago_ant = bool(parcela.pago_anteriormente)
        antecipada = bool(parcela.antecipada)
        lanc_id = parcela.lancamento_id
        obs = parcela.observacao
    else:
        venc = clamp_due_date(ano, mes, divida.dia_vencimento)
        status = "pendente"
        valor_original = round(float(divida.valor_parcela), 2)
        valor_atual = valor_original
        valor_pago = None
        desconto = 0.0
        acrescimo = 0.0
        numero = max(1, months_between(divida.ano_inicio, divida.mes_inicio, ano, mes) + 1)
        parcela_id = None
        conta_obj = None
        data_pag_str = None
        forma_pag = None
        pago_ant = False
        antecipada = False
        lanc_id = None
        obs = None

    info_venc = classificar_vencimento(status, venc, ref_date, janela_dias=janela_dias)
    is_parcelada = divida.tipo_compromisso == "parcelada"
    rotulo_parcela = (
        f"{numero}/{divida.total_parcelas}"
        if is_parcelada and divida.total_parcelas
        else f"Mensal ({format_mes_ano(mes, ano)})"
    )
    valor_efetivo = valor_pago if (status == "pago" and valor_pago is not None) else valor_atual

    return {
        "parcela_id": parcela_id,
        "divida_id": divida.id,
        "divida_nome": divida.nome,
        "credor": divida.credor,
        "categoria": divida.categoria,
        "cor": divida.cor,
        "tipo_compromisso": divida.tipo_compromisso,
        "dia_vencimento_padrao": divida.dia_vencimento,
        "conta_padrao_id": divida.conta_padrao_id,
        "numero": numero,
        "total_parcelas": divida.total_parcelas if is_parcelada else None,
        "rotulo_parcela": rotulo_parcela,
        "mes": int(mes),
        "ano": int(ano),
        "nome_mes": format_mes_ano(mes, ano),
        "vencimento": venc.isoformat(),
        "dia_vencimento_mes": venc.day,
        "valor_original": valor_original,
        "valor_atual": valor_atual,
        "valor_pago": valor_pago,
        "valor_efetivo": round(valor_efetivo, 2),
        "desconto": desconto,
        "acrescimo": acrescimo,
        "status": status,
        "pago_anteriormente": pago_ant,
        "antecipada": antecipada,
        "data_pagamento": data_pag_str,
        "forma_pagamento": forma_pag,
        "conta": conta_obj,
        "lancamento_id": lanc_id,
        "observacao": obs,
        **info_venc,
    }


def obter_ocorrencia_divida_mes(
    divida: models.Divida,
    ano: int,
    mes: int,
    ref_date: date,
    janela_dias: int = 15,
) -> Optional[dict[str, Any]]:
    by_ym = {(p.ano, p.mes): p for p in divida.parcelas}
    existente = by_ym.get((int(ano), int(mes)))

    if divida.tipo_compromisso == "parcelada":
        if existente is None:
            return None
        if not divida.ativa and existente.status != "pago":
            return None
        return _serializar_ocorrencia(
            divida,
            parcela=existente,
            ano=ano,
            mes=mes,
            ref_date=ref_date,
            janela_dias=janela_dias,
        )

    # Compromisso fixo / recorrente mensal
    if existente is not None:
        if not divida.ativa and existente.status != "pago":
            return None
        return _serializar_ocorrencia(
            divida,
            parcela=existente,
            ano=ano,
            mes=mes,
            ref_date=ref_date,
            janela_dias=janela_dias,
        )

    if not divida.ativa:
        return None
    if months_between(divida.ano_inicio, divida.mes_inicio, ano, mes) < 0:
        return None

    return _serializar_ocorrencia(
        divida,
        parcela=None,
        ano=ano,
        mes=mes,
        ref_date=ref_date,
        janela_dias=janela_dias,
    )


def serializar_divida_completa(
    divida: models.Divida,
    *,
    ref_date: date,
    mes_foco: int,
    ano_foco: int,
    janela_dias: int = 15,
) -> dict[str, Any]:
    is_parcelada = divida.tipo_compromisso == "parcelada"
    ocorrencia_mes = obter_ocorrencia_divida_mes(
        divida, ano_foco, mes_foco, ref_date, janela_dias=janela_dias
    )

    if is_parcelada:
        parcelas_ordenadas = sorted(divida.parcelas, key=lambda p: (p.ano, p.mes, p.numero))
        total_p = len(parcelas_ordenadas) or int(divida.total_parcelas or 1)
        pagas = [p for p in parcelas_ordenadas if p.status == "pago"]
        pendentes = [p for p in parcelas_ordenadas if p.status == "pendente"]
        saldo_restante = round(sum(float(p.valor_atual) for p in pendentes), 2)
        valor_total_original = round(sum(float(p.valor_original) for p in parcelas_ordenadas), 2)
        total_ja_pago = round(
            sum(float(p.valor_pago if p.valor_pago is not None else p.valor_atual) for p in pagas),
            2,
        )
        progresso_pct = round((len(pagas) / total_p) * 100.0, 1) if total_p > 0 else 100.0
        quitada_total = len(pendentes) == 0
        prox_p = pendentes[0] if pendentes else None
        proxima_ocorrencia = (
            _serializar_ocorrencia(
                divida,
                parcela=prox_p,
                ano=prox_p.ano,
                mes=prox_p.mes,
                ref_date=ref_date,
                janela_dias=janela_dias,
            )
            if prox_p and divida.ativa
            else None
        )
        ult_p = parcelas_ordenadas[-1] if parcelas_ordenadas else None
        previsao_termino = format_mes_ano(ult_p.mes, ult_p.ano) if ult_p else None
        parcelas_serializadas = [
            _serializar_ocorrencia(
                divida,
                parcela=p,
                ano=p.ano,
                mes=p.mes,
                ref_date=ref_date,
                janela_dias=janela_dias,
            )
            for p in parcelas_ordenadas
        ]
    else:
        total_p = None
        pagas_hist = [p for p in divida.parcelas if p.status == "pago"]
        pendentes = []
        saldo_restante = 0.0
        valor_total_original = round(float(divida.valor_parcela), 2)
        total_ja_pago = round(
            sum(float(p.valor_pago if p.valor_pago is not None else p.valor_atual) for p in pagas_hist),
            2,
        )
        progresso_pct = None
        quitada_total = False
        previsao_termino = "Recorrente mensal"

        # Próxima ocorrência pendente para compromisso fixo a partir do início ou mês atual
        proxima_ocorrencia = None
        if divida.ativa:
            min_ano, min_mes = add_months(ref_date.year, ref_date.month, -12)
            start_a, start_m = divida.ano_inicio, divida.mes_inicio
            if months_between(min_ano, min_mes, start_a, start_m) < 0:
                start_a, start_m = min_ano, min_mes
            max_span = max(2, months_between(start_a, start_m, ref_date.year, ref_date.month) + 3)
            for step in range(max_span):
                cand_a, cand_m = add_months(start_a, start_m, step)
                oc = obter_ocorrencia_divida_mes(
                    divida, cand_a, cand_m, ref_date, janela_dias=janela_dias
                )
                if oc and oc["status"] == "pendente":
                    proxima_ocorrencia = oc
                    break

        # Lista janela recente/futura de meses para visualização no card da conta fixa
        meses_visiveis: set[tuple[int, int]] = {(p.ano, p.mes) for p in divida.parcelas}
        for delta in range(-2, 4):
            ca, cm = add_months(ano_foco, mes_foco, delta)
            if months_between(divida.ano_inicio, divida.mes_inicio, ca, cm) >= 0:
                meses_visiveis.add((ca, cm))
        parcelas_serializadas = []
        for ca, cm in sorted(meses_visiveis):
            oc = obter_ocorrencia_divida_mes(divida, ca, cm, ref_date, janela_dias=janela_dias)
            if oc:
                parcelas_serializadas.append(oc)

    # Cálculo de economia estimada caso quite todas as parcelas restantes hoje
    economia_quitacao_hoje = 0.0
    valor_quitacao_hoje = saldo_restante
    if is_parcelada and pendentes:
        soma_vp = 0.0
        for p in pendentes:
            meses_frente = max(0, months_between(ref_date.year, ref_date.month, p.ano, p.mes))
            vp, _ = calcular_desconto_antecipacao(
                p.valor_atual,
                meses_frente,
                divida.desconto_antecipacao_pct,
                divida.taxa_juros_mensal,
            )
            soma_vp += vp
        valor_quitacao_hoje = round(soma_vp, 2)
        economia_quitacao_hoje = round(max(0.0, saldo_restante - valor_quitacao_hoje), 2)

    alivio_mensal = round(
        float(pendentes[0].valor_atual) if (is_parcelada and pendentes) else float(divida.valor_parcela),
        2,
    )

    return {
        "id": divida.id,
        "nome": divida.nome,
        "credor": divida.credor,
        "categoria": divida.categoria,
        "tipo_compromisso": divida.tipo_compromisso,
        "valor_parcela": round(float(divida.valor_parcela), 2),
        "dia_vencimento": divida.dia_vencimento,
        "total_parcelas": total_p,
        "parcelas_pagas_anteriores": divida.parcelas_pagas_anteriores,
        "parcelas_pagas": len(pagas) if is_parcelada else len([p for p in divida.parcelas if p.status == "pago"]),
        "parcelas_restantes": len(pendentes) if is_parcelada else None,
        "progresso_pct": progresso_pct,
        "quitada_total": quitada_total,
        "saldo_restante": saldo_restante,
        "valor_quitacao_hoje": valor_quitacao_hoje,
        "economia_quitacao_hoje": economia_quitacao_hoje,
        "valor_total_original": valor_total_original,
        "total_ja_pago": total_ja_pago,
        "alivio_mensal": alivio_mensal,
        "mes_inicio": divida.mes_inicio,
        "ano_inicio": divida.ano_inicio,
        "previsao_termino": previsao_termino,
        "taxa_juros_mensal": round(float(divida.taxa_juros_mensal or 0.0), 2),
        "desconto_antecipacao_pct": round(float(divida.desconto_antecipacao_pct or 0.0), 2),
        "conta_padrao_id": divida.conta_padrao_id,
        "conta_padrao": (
            {"id": divida.conta_padrao.id, "nome": divida.conta_padrao.nome}
            if divida.conta_padrao
            else None
        ),
        "modulo_id": divida.modulo_id,
        "modulo": (
            {"id": divida.modulo.id, "nome": divida.modulo.nome, "cor": divida.modulo.cor}
            if divida.modulo
            else None
        ),
        "cor": divida.cor,
        "observacoes": divida.observacoes,
        "ativa": bool(divida.ativa),
        "ocorrencia_mes": ocorrencia_mes,
        "proxima_ocorrencia": proxima_ocorrencia,
        "parcelas": parcelas_serializadas,
    }


def coletar_radar_vencimentos(
    dividas: list[models.Divida],
    *,
    ref_date: date,
    janela_dias: int = 15,
) -> dict[str, list[dict[str, Any]]]:
    atrasadas: list[dict[str, Any]] = []
    vencendo_hoje: list[dict[str, Any]] = []
    proximos: list[dict[str, Any]] = []
    limite_futuro = ref_date + timedelta(days=max(1, int(janela_dias)))

    min_retro_ano, min_retro_mes = add_months(ref_date.year, ref_date.month, -24)

    for d in dividas:
        if not d.ativa:
            continue

        if d.tipo_compromisso == "parcelada":
            for p in d.parcelas:
                if p.status != "pendente":
                    continue
                if p.vencimento > limite_futuro:
                    continue
                oc = _serializar_ocorrencia(
                    d,
                    parcela=p,
                    ano=p.ano,
                    mes=p.mes,
                    ref_date=ref_date,
                    janela_dias=janela_dias,
                )
                if p.vencimento < ref_date:
                    atrasadas.append(oc)
                elif p.vencimento == ref_date:
                    vencendo_hoje.append(oc)
                else:
                    proximos.append(oc)
        else:
            start_a, start_m = d.ano_inicio, d.mes_inicio
            if months_between(min_retro_ano, min_retro_mes, start_a, start_m) < 0:
                start_a, start_m = min_retro_ano, min_retro_mes

            end_a, end_m = limite_futuro.year, limite_futuro.month
            span = months_between(start_a, start_m, end_a, end_m)
            for step in range(max(0, span + 1)):
                ca, cm = add_months(start_a, start_m, step)
                oc = obter_ocorrencia_divida_mes(d, ca, cm, ref_date, janela_dias=janela_dias)
                if not oc or oc["status"] != "pendente":
                    continue
                venc_dt = date.fromisoformat(oc["vencimento"])
                if venc_dt < ref_date:
                    atrasadas.append(oc)
                elif venc_dt == ref_date:
                    vencendo_hoje.append(oc)
                elif venc_dt <= limite_futuro:
                    proximos.append(oc)

    atrasadas.sort(key=lambda x: (x["vencimento"], -x["valor_atual"], x["divida_nome"]))
    vencendo_hoje.sort(key=lambda x: (-x["valor_atual"], x["divida_nome"]))
    proximos.sort(key=lambda x: (x["vencimento"], -x["valor_atual"], x["divida_nome"]))

    return {
        "atrasadas": atrasadas,
        "vencendo_hoje": vencendo_hoje,
        "proximos_vencimentos": proximos,
    }


def calcular_estrategia_quitacao(
    dividas_serializadas: list[dict[str, Any]],
) -> dict[str, Any]:
    parceladas_ativas = [
        d
        for d in dividas_serializadas
        if d["ativa"] and d["tipo_compromisso"] == "parcelada" and (d["parcelas_restantes"] or 0) > 0
    ]
    fixas_ativas = [
        d for d in dividas_serializadas if d["ativa"] and d["tipo_compromisso"] == "fixa"
    ]

    def _item_estrategia(d: dict[str, Any], motivo: str) -> dict[str, Any]:
        saldo = float(d["saldo_restante"] or 0.0)
        alivio = float(d["alivio_mensal"] or 0.0)
        eficiencia = round((alivio / saldo) * 100.0, 2) if saldo > 0 else 0.0
        return {
            "divida_id": d["id"],
            "nome": d["nome"],
            "credor": d["credor"],
            "categoria": d["categoria"],
            "cor": d["cor"],
            "dia_vencimento": d["dia_vencimento"],
            "saldo_restante": saldo,
            "valor_quitacao_hoje": d["valor_quitacao_hoje"],
            "economia_quitacao_hoje": d["economia_quitacao_hoje"],
            "parcelas_restantes": d["parcelas_restantes"],
            "total_parcelas": d["total_parcelas"],
            "progresso_pct": d["progresso_pct"],
            "alivio_mensal": alivio,
            "taxa_juros_mensal": d["taxa_juros_mensal"],
            "desconto_antecipacao_pct": d["desconto_antecipacao_pct"],
            "eficiencia_alivio_pct": eficiencia,
            "previsao_termino": d["previsao_termino"],
            "frase_impacto": f"Quitando {d['nome']}, você libera +R$ {alivio:,.2f}/mês no orçamento.".replace(
                ",", "X"
            ).replace(".", ",").replace("X", "."),
            "motivo_prioridade": motivo,
        }

    # 1. Bola de Neve: menor saldo devedor restante primeiro (vitória rápida + elimina boletos)
    ordenadas_neve = sorted(
        parceladas_ativas,
        key=lambda d: (
            float(d["saldo_restante"]),
            int(d["parcelas_restantes"] or 0),
            -float(d["alivio_mensal"]),
        ),
    )
    ranking_bola_de_neve = []
    alivio_acumulado_neve = 0.0
    for idx, d in enumerate(ordenadas_neve, start=1):
        alivio_acumulado_neve = round(alivio_acumulado_neve + float(d["alivio_mensal"]), 2)
        motivo = (
            f"Menor saldo restante ({d['parcelas_restantes']}x pendentes) — elimina este carnê mais rápido"
            if idx == 1
            else f"{idx}º passo: some o alívio anterior para quitar mais rápido"
        )
        item = _item_estrategia(d, motivo)
        item["ordem"] = idx
        item["alivio_acumulado_apos_quitar"] = alivio_acumulado_neve
        ranking_bola_de_neve.append(item)

    # 2. Avalanche / Maior Alívio Mensal: maior juros/desconto e maior liberação mensal no orçamento
    ordenadas_avalanche = sorted(
        parceladas_ativas,
        key=lambda d: (
            -float(d["taxa_juros_mensal"] or 0.0),
            -float(d["desconto_antecipacao_pct"] or 0.0),
            -float(d["alivio_mensal"] or 0.0),
            float(d["saldo_restante"] or 0.0),
        ),
    )
    ranking_avalanche = []
    alivio_acumulado_av = 0.0
    for idx, d in enumerate(ordenadas_avalanche, start=1):
        alivio_acumulado_av = round(alivio_acumulado_av + float(d["alivio_mensal"]), 2)
        tem_juros = float(d["taxa_juros_mensal"] or 0.0) > 0
        motivo = (
            f"Maior custo de juros ({d['taxa_juros_mensal']:.2f}% a.m.) e alto impacto mensal"
            if tem_juros and idx == 1
            else (
                "Maior fôlego imediato no orçamento mensal ao ser eliminada"
                if idx == 1
                else f"{idx}º alvo por impacto mensal / custo efetivo"
            )
        )
        item = _item_estrategia(d, motivo)
        item["ordem"] = idx
        item["alivio_acumulado_apos_quitar"] = alivio_acumulado_av
        ranking_avalanche.append(item)

    alivio_total_parceladas = round(sum(float(d["alivio_mensal"]) for d in parceladas_ativas), 2)
    custo_fixo_mensal = round(sum(float(d["valor_parcela"]) for d in fixas_ativas), 2)

    recomendacao = None
    if ranking_avalanche and ranking_bola_de_neve:
        alvo_av = ranking_avalanche[0]
        alvo_bn = ranking_bola_de_neve[0]
        mesmo_alvo = alvo_av["divida_id"] == alvo_bn["divida_id"]
        if mesmo_alvo:
            metodo_sugerido = "convergente"
            resumo_texto = (
                f"{alvo_av['nome']} é o alvo ideal nas duas estratégias: tem o menor saldo restante e "
                f"libera R$ {alvo_av['alivio_mensal']:.2f}/mês assim que quitada."
            )
        elif alvo_av["taxa_juros_mensal"] > alvo_bn["taxa_juros_mensal"] and alvo_av["taxa_juros_mensal"] > 0:
            metodo_sugerido = "avalanche"
            resumo_texto = (
                f"Para economizar mais juros, ataque primeiro {alvo_av['nome']} ({alvo_av['taxa_juros_mensal']:.2f}% a.m.). "
                f"Se preferir eliminar um boleto rápido para ganhar fôlego psicológico, quite {alvo_bn['nome']} primeiro."
            )
        else:
            metodo_sugerido = "bola_de_neve" if alvo_bn["saldo_restante"] < alvo_av["saldo_restante"] * 0.6 else "avalanche"
            resumo_texto = (
                f"Atacando {alvo_av['nome']} você libera o maior valor por mês (R$ {alvo_av['alivio_mensal']:.2f}/mês). "
                f"Já {alvo_bn['nome']} exige menos capital (R$ {alvo_bn['saldo_restante']:.2f}) para zerar logo uma dívida."
            )
        recomendacao = {
            "metodo_sugerido": metodo_sugerido,
            "alvo_avalanche": alvo_av,
            "alvo_bola_de_neve": alvo_bn,
            "resumo": resumo_texto,
            "alivio_total_ao_zerar_parceladas": alivio_total_parceladas,
        }

    return {
        "bola_de_neve": ranking_bola_de_neve,
        "avalanche": ranking_avalanche,
        "recomendacao": recomendacao,
        "alivio_total_parceladas": alivio_total_parceladas,
        "custo_fixo_mensal": custo_fixo_mensal,
        "compromissos_fixos": [
            {
                "divida_id": f["id"],
                "nome": f["nome"],
                "credor": f["credor"],
                "categoria": f["categoria"],
                "dia_vencimento": f["dia_vencimento"],
                "valor_mensal": f["valor_parcela"],
                "cor": f["cor"],
            }
            for f in sorted(fixas_ativas, key=lambda x: (x["dia_vencimento"], -x["valor_parcela"]))
        ],
    }


def simular_plano_quitacao(
    dividas: list[models.Divida],
    *,
    ref_date: date,
    aporte_unico: float = 0.0,
    aporte_mensal_extra: float = 0.0,
    estrategia: str = "avalanche",
    divida_alvo_id: Optional[int] = None,
    reinvestir_alivio: bool = True,
) -> dict[str, Any]:
    """
    Simulador completo (100% leitura) de:
    1) Antecipação pontual de parcelas na dívida-alvo escolhida (de trás para frente com desconto).
    2) Cronograma mês a mês global com aporte extra + efeito cascata (bola de neve / avalanche).
    """
    aporte_unico = round(max(0.0, float(aporte_unico or 0.0)), 2)
    aporte_mensal_extra = round(max(0.0, float(aporte_mensal_extra or 0.0)), 2)
    modo = "bola_de_neve" if estrategia == "bola_de_neve" else "avalanche"

    ativas_parceladas = [
        d
        for d in dividas
        if d.ativa
        and d.tipo_compromisso == "parcelada"
        and any(p.status == "pendente" for p in d.parcelas)
    ]

    if not ativas_parceladas:
        return {
            "estrategia": modo,
            "possui_dividas_parceladas": False,
            "aporte_unico": aporte_unico,
            "aporte_mensal_extra": aporte_mensal_extra,
            "meses_cronograma_atual": 0,
            "meses_plano_acelerado": 0,
            "meses_economizados": 0,
            "data_quitacao_atual": None,
            "data_quitacao_acelerada": None,
            "saldo_original_total": 0.0,
            "custo_total_acelerado": 0.0,
            "economia_estimada": 0.0,
            "simulacao_alvo": None,
            "ordem_quitacao": [],
        }

    def _ordenar_alvos(estados: list[dict[str, Any]]) -> list[dict[str, Any]]:
        vivos = [e for e in estados if e["pendentes"]]
        if modo == "bola_de_neve":
            return sorted(
                vivos,
                key=lambda e: (
                    sum(x["valor"] for x in e["pendentes"]),
                    len(e["pendentes"]),
                    -e["valor_parcela"],
                ),
            )
        return sorted(
            vivos,
            key=lambda e: (
                -e["taxa_juros"],
                -e["desconto_pct"],
                -e["valor_parcela"],
                sum(x["valor"] for x in e["pendentes"]),
            ),
        )

    # 1. Simulação direta na dívida alvo (ou primeira do ranking escolhido)
    estados_base = []
    for d in ativas_parceladas:
        pends = sorted(
            [p for p in d.parcelas if p.status == "pendente"],
            key=lambda p: (p.ano, p.mes, p.numero),
        )
        estados_base.append(
            {
                "id": d.id,
                "nome": d.nome,
                "cor": d.cor,
                "valor_parcela": round(float(d.valor_parcela), 2),
                "taxa_juros": float(d.taxa_juros_mensal or 0.0),
                "desconto_pct": float(d.desconto_antecipacao_pct or 0.0),
                "pendentes": [
                    {
                        "numero": p.numero,
                        "ano": p.ano,
                        "mes": p.mes,
                        "valor": round(float(p.valor_atual), 2),
                    }
                    for p in pends
                ],
            }
        )

    alvo_escolhido = next((e for e in estados_base if e["id"] == divida_alvo_id), None)
    if alvo_escolhido is None:
        alvo_escolhido = _ordenar_alvos(estados_base)[0]

    orcamento_pontual = aporte_unico if aporte_unico > 0 else aporte_mensal_extra
    parcelas_abatidas_alvo = []
    sobra_pontual = orcamento_pontual
    for item_p in reversed(alvo_escolhido["pendentes"]):
        meses_frente = max(0, months_between(ref_date.year, ref_date.month, item_p["ano"], item_p["mes"]))
        custo_ant, desc_ant = calcular_desconto_antecipacao(
            item_p["valor"],
            meses_frente,
            alvo_escolhido["desconto_pct"],
            alvo_escolhido["taxa_juros"],
        )
        if sobra_pontual + 1e-9 >= custo_ant and custo_ant > 0:
            sobra_pontual = round(max(0.0, sobra_pontual - custo_ant), 2)
            parcelas_abatidas_alvo.append(
                {
                    "numero": item_p["numero"],
                    "mes": item_p["mes"],
                    "ano": item_p["ano"],
                    "valor_original": item_p["valor"],
                    "valor_com_desconto": custo_ant,
                    "desconto": desc_ant,
                }
            )
        else:
            break

    valor_orig_abatido = round(sum(x["valor_original"] for x in parcelas_abatidas_alvo), 2)
    valor_pago_abatido = round(sum(x["valor_com_desconto"] for x in parcelas_abatidas_alvo), 2)
    simulacao_alvo = {
        "divida_id": alvo_escolhido["id"],
        "divida_nome": alvo_escolhido["nome"],
        "orcamento_usado_base": orcamento_pontual,
        "parcelas_restantes_atuais": len(alvo_escolhido["pendentes"]),
        "parcelas_que_abate": len(parcelas_abatidas_alvo),
        "parcelas_restantes_apos": len(alvo_escolhido["pendentes"]) - len(parcelas_abatidas_alvo),
        "valor_original_abatido": valor_orig_abatido,
        "valor_com_desconto": valor_pago_abatido,
        "economia_direta": round(max(0.0, valor_orig_abatido - valor_pago_abatido), 2),
        "troco_estimado": sobra_pontual,
        "alivio_mensal_ao_quitar": alvo_escolhido["valor_parcela"],
    }

    # 2. Linha do tempo global: cronograma normal vs acelerado
    saldo_original_total = round(
        sum(x["valor"] for e in estados_base for x in e["pendentes"]),
        2,
    )
    max_ym_normal = max(
        (x["ano"], x["mes"]) for e in estados_base for x in e["pendentes"]
    )
    meses_normais = max(
        1,
        months_between(ref_date.year, ref_date.month, max_ym_normal[0], max_ym_normal[1]) + 1,
    )
    termino_por_divida_normal = {
        e["id"]: max((x["ano"], x["mes"]) for x in e["pendentes"]) for e in estados_base
    }

    # Clona estado para simulação mês a mês acelerada
    sim_estados = [
        {
            **e,
            "pendentes": [dict(x) for x in e["pendentes"]],
            "quitada_em": None,
            "total_pago_sim": 0.0,
            "economia_sim": 0.0,
        }
        for e in estados_base
    ]

    custo_total_acelerado = 0.0
    economia_total = 0.0
    passo_mes = 0
    ultimo_ym_pago = (ref_date.year, ref_date.month)

    # Primeiro aplica eventual aporte único imediato no mês 0 (de trás para frente nas prioridades)
    caixa_aporte_unico = aporte_unico
    if caixa_aporte_unico > 0:
        for alvo in _ordenar_alvos(sim_estados):
            while alvo["pendentes"] and caixa_aporte_unico > 0:
                cand = alvo["pendentes"][-1]
                mf = max(0, months_between(ref_date.year, ref_date.month, cand["ano"], cand["mes"]))
                custo_c, desc_c = calcular_desconto_antecipacao(
                    cand["valor"], mf, alvo["desconto_pct"], alvo["taxa_juros"]
                )
                if caixa_aporte_unico + 1e-9 >= custo_c:
                    alvo["pendentes"].pop()
                    caixa_aporte_unico = round(max(0.0, caixa_aporte_unico - custo_c), 2)
                    custo_total_acelerado = round(custo_total_acelerado + custo_c, 2)
                    economia_total = round(economia_total + desc_c, 2)
                    alvo["total_pago_sim"] = round(alvo["total_pago_sim"] + custo_c, 2)
                    alvo["economia_sim"] = round(alvo["economia_sim"] + desc_c, 2)
                    if not alvo["pendentes"]:
                        alvo["quitada_em"] = (ref_date.year, ref_date.month)
                else:
                    # Abate parcialmente o saldo da última parcela sem perdê-la
                    cand["valor"] = round(max(0.01, cand["valor"] - caixa_aporte_unico), 2)
                    custo_total_acelerado = round(custo_total_acelerado + caixa_aporte_unico, 2)
                    alvo["total_pago_sim"] = round(alvo["total_pago_sim"] + caixa_aporte_unico, 2)
                    caixa_aporte_unico = 0.0
                    break

    orcamento_base_parcelas = sum(e["valor_parcela"] for e in sim_estados)

    while any(e["pendentes"] for e in sim_estados) and passo_mes < 600:
        ano_cur, mes_cur = add_months(ref_date.year, ref_date.month, passo_mes)
        ultimo_ym_pago = (ano_cur, mes_cur)
        pago_obrigatorio_mes = 0.0

        # 2a. Paga parcelas vencidas ou do mês corrente
        for e in sim_estados:
            restantes_apos_mes = []
            for item_p in e["pendentes"]:
                if months_between(ano_cur, mes_cur, item_p["ano"], item_p["mes"]) <= 0:
                    val_p = item_p["valor"]
                    pago_obrigatorio_mes = round(pago_obrigatorio_mes + val_p, 2)
                    custo_total_acelerado = round(custo_total_acelerado + val_p, 2)
                    e["total_pago_sim"] = round(e["total_pago_sim"] + val_p, 2)
                else:
                    restantes_apos_mes.append(item_p)
            e["pendentes"] = restantes_apos_mes
            if not e["pendentes"] and e["quitada_em"] is None:
                e["quitada_em"] = (ano_cur, mes_cur)

        # 2b. Aplica aporte mensal extra + alívio de dívidas já quitadas (efeito cascata)
        folga_cascata = (
            max(0.0, round(orcamento_base_parcelas - pago_obrigatorio_mes, 2))
            if reinvestir_alivio
            else 0.0
        )
        caixa_extra_mes = round(aporte_mensal_extra + folga_cascata, 2)

        if caixa_extra_mes > 0 and any(e["pendentes"] for e in sim_estados):
            for alvo in _ordenar_alvos(sim_estados):
                while alvo["pendentes"] and caixa_extra_mes > 0:
                    cand = alvo["pendentes"][-1]
                    mf = max(0, months_between(ano_cur, mes_cur, cand["ano"], cand["mes"]))
                    custo_c, desc_c = calcular_desconto_antecipacao(
                        cand["valor"], mf, alvo["desconto_pct"], alvo["taxa_juros"]
                    )
                    if caixa_extra_mes + 1e-9 >= custo_c:
                        alvo["pendentes"].pop()
                        caixa_extra_mes = round(max(0.0, caixa_extra_mes - custo_c), 2)
                        custo_total_acelerado = round(custo_total_acelerado + custo_c, 2)
                        economia_total = round(economia_total + desc_c, 2)
                        alvo["total_pago_sim"] = round(alvo["total_pago_sim"] + custo_c, 2)
                        alvo["economia_sim"] = round(alvo["economia_sim"] + desc_c, 2)
                        if not alvo["pendentes"] and alvo["quitada_em"] is None:
                            alvo["quitada_em"] = (ano_cur, mes_cur)
                    else:
                        # Abate parcial proporcional no fim do contrato
                        fator = cand["valor"] / custo_c if custo_c > 0 else 1.0
                        reducao_nominal = round(min(cand["valor"] - 0.01, caixa_extra_mes * fator), 2)
                        if reducao_nominal > 0:
                            econ_parcial = round(max(0.0, reducao_nominal - caixa_extra_mes), 2)
                            cand["valor"] = round(cand["valor"] - reducao_nominal, 2)
                            custo_total_acelerado = round(custo_total_acelerado + caixa_extra_mes, 2)
                            economia_total = round(economia_total + econ_parcial, 2)
                            alvo["total_pago_sim"] = round(alvo["total_pago_sim"] + caixa_extra_mes, 2)
                            alvo["economia_sim"] = round(alvo["economia_sim"] + econ_parcial, 2)
                        caixa_extra_mes = 0.0
                        break

        if not any(e["pendentes"] for e in sim_estados):
            break
        passo_mes += 1

    tem_aceleracao = (aporte_unico > 0) or (aporte_mensal_extra > 0) or (len(sim_estados) > 1 and reinvestir_alivio)
    if all(e["quitada_em"] == (ref_date.year, ref_date.month) for e in sim_estados) and aporte_unico > 0:
        meses_acelerados = 0
    else:
        meses_acelerados = max(
            0,
            months_between(ref_date.year, ref_date.month, ultimo_ym_pago[0], ultimo_ym_pago[1]) + 1,
        )
    if not tem_aceleracao:
        meses_acelerados = meses_normais

    meses_economizados = max(0, meses_normais - meses_acelerados)

    ordem_quitacao = []
    for idx, e in enumerate(
        sorted(sim_estados, key=lambda item: item["quitada_em"] or (9999, 12)),
        start=1,
    ):
        ym_fim = e["quitada_em"] or ultimo_ym_pago
        ym_orig = termino_por_divida_normal[e["id"]]
        ganho_meses = max(0, months_between(ym_fim[0], ym_fim[1], ym_orig[0], ym_orig[1]))
        ordem_quitacao.append(
            {
                "ordem": idx,
                "divida_id": e["id"],
                "nome": e["nome"],
                "cor": e["cor"],
                "quitacao_original": format_mes_ano(ym_orig[1], ym_orig[0]),
                "quitacao_simulada": format_mes_ano(ym_fim[1], ym_fim[0]),
                "meses_antecipados": ganho_meses,
                "alivio_mensal_liberado": e["valor_parcela"],
                "economia_desconto": e["economia_sim"],
            }
        )

    return {
        "estrategia": modo,
        "possui_dividas_parceladas": True,
        "aporte_unico": aporte_unico,
        "aporte_mensal_extra": aporte_mensal_extra,
        "reinvestir_alivio": reinvestir_alivio,
        "meses_cronograma_atual": meses_normais,
        "meses_plano_acelerado": meses_acelerados,
        "meses_economizados": meses_economizados,
        "data_quitacao_atual": format_mes_ano(max_ym_normal[1], max_ym_normal[0]),
        "data_quitacao_acelerada": format_mes_ano(ultimo_ym_pago[1], ultimo_ym_pago[0]),
        "saldo_original_total": saldo_original_total,
        "custo_total_acelerado": round(custo_total_acelerado, 2),
        "economia_estimada": round(economia_total, 2),
        "simulacao_alvo": simulacao_alvo,
        "ordem_quitacao": ordem_quitacao,
    }


def montar_painel_dividas(
    db: Session,
    usuario_id: int,
    *,
    mes: Optional[int] = None,
    ano: Optional[int] = None,
    ref_date: Optional[date] = None,
    janela_dias: int = 15,
    incluir_inativas: bool = False,
) -> dict[str, Any]:
    hoje = ref_date or date.today()
    mes_foco = int(mes or hoje.month)
    ano_foco = int(ano or hoje.year)

    query = db.query(models.Divida).filter(models.Divida.usuario_id == usuario_id)
    if not incluir_inativas:
        query = query.filter(models.Divida.ativa == True)
    dividas_db = query.order_by(models.Divida.dia_vencimento.asc(), models.Divida.id.asc()).all()

    # Para cálculo de agenda mensal, inclui também dívidas inativas que já tiveram pagamento naquele mês
    todas_usuario = (
        dividas_db
        if incluir_inativas
        else db.query(models.Divida)
        .filter(models.Divida.usuario_id == usuario_id)
        .order_by(models.Divida.dia_vencimento.asc(), models.Divida.id.asc())
        .all()
    )

    dividas_serializadas = [
        serializar_divida_completa(
            d,
            ref_date=hoje,
            mes_foco=mes_foco,
            ano_foco=ano_foco,
            janela_dias=janela_dias,
        )
        for d in dividas_db
    ]

    agenda_mes: list[dict[str, Any]] = []
    for d in todas_usuario:
        oc = obter_ocorrencia_divida_mes(d, ano_foco, mes_foco, hoje, janela_dias=janela_dias)
        if oc is not None:
            agenda_mes.append(oc)

    agenda_mes.sort(key=lambda x: (x["vencimento"], x["dia_vencimento_padrao"], x["divida_nome"]))

    quitadas_mes = [x for x in agenda_mes if x["status"] == "pago"]
    pendentes_mes = [x for x in agenda_mes if x["status"] == "pendente"]

    total_pago_mes = round(sum(float(x["valor_efetivo"]) for x in quitadas_mes), 2)
    falta_pagar_mes = round(sum(float(x["valor_atual"]) for x in pendentes_mes), 2)
    total_comprometido_mes = round(total_pago_mes + falta_pagar_mes, 2)

    radar = coletar_radar_vencimentos(todas_usuario, ref_date=hoje, janela_dias=janela_dias)
    estrategia = calcular_estrategia_quitacao(dividas_serializadas)

    saldo_devedor_total = round(
        sum(
            float(d["saldo_restante"])
            for d in dividas_serializadas
            if d["ativa"] and d["tipo_compromisso"] == "parcelada"
        ),
        2,
    )
    comprometimento_parceladas = round(
        sum(float(x["valor_efetivo"]) for x in agenda_mes if x["tipo_compromisso"] == "parcelada"),
        2,
    )
    comprometimento_fixas = round(
        sum(float(x["valor_efetivo"]) for x in agenda_mes if x["tipo_compromisso"] == "fixa"),
        2,
    )

    return {
        "mes": mes_foco,
        "ano": ano_foco,
        "nome_mes": format_mes_ano(mes_foco, ano_foco),
        "hoje": hoje.isoformat(),
        "janela_dias": janela_dias,
        "resumo": {
            "total_dividas_ativas": len(
                [
                    d
                    for d in dividas_serializadas
                    if d["ativa"] and (d["tipo_compromisso"] == "fixa" or (d["parcelas_restantes"] or 0) > 0)
                ]
            ),
            "total_comprometido_mes": total_comprometido_mes,
            "total_pago_mes": total_pago_mes,
            "falta_pagar_mes": falta_pagar_mes,
            "comprometimento_parceladas_mes": comprometimento_parceladas,
            "comprometimento_fixas_mes": comprometimento_fixas,
            "saldo_devedor_total": saldo_devedor_total,
            "alivio_potencial_mensal": estrategia["alivio_total_parceladas"],
            "qtd_atrasadas": len(radar["atrasadas"]),
            "valor_atrasadas": round(sum(float(x["valor_atual"]) for x in radar["atrasadas"]), 2),
            "qtd_vencendo_hoje": len(radar["vencendo_hoje"]),
            "valor_vencendo_hoje": round(sum(float(x["valor_atual"]) for x in radar["vencendo_hoje"]), 2),
            "qtd_proximos_dias": len(radar["proximos_vencimentos"]),
            "valor_proximos_dias": round(
                sum(float(x["valor_atual"]) for x in radar["proximos_vencimentos"]), 2
            ),
            "qtd_quitadas_mes": len(quitadas_mes),
        },
        "radar": {
            **radar,
            "quitadas_mes": quitadas_mes,
        },
        "agenda_mes": agenda_mes,
        "estrategia": estrategia,
        "dividas": dividas_serializadas,
    }


def calcular_resumo_dashboard_dividas(
    db: Session,
    usuario_id: int,
    *,
    mes: int,
    ano: int,
    ref_date: Optional[date] = None,
) -> dict[str, Any]:
    painel = montar_painel_dividas(
        db,
        usuario_id,
        mes=mes,
        ano=ano,
        ref_date=ref_date,
        janela_dias=15,
        incluir_inativas=False,
    )
    resumo = painel["resumo"]
    radar = painel["radar"]
    rec = painel["estrategia"]["recomendacao"]
    return {
        "possui_dividas": bool(painel["dividas"] or painel["agenda_mes"]),
        **resumo,
        "atrasadas": radar["atrasadas"][:4],
        "vencendo_hoje": radar["vencendo_hoje"][:4],
        "proximos_vencimentos": radar["proximos_vencimentos"][:5],
        "recomendacao": rec,
    }
