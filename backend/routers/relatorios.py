from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db
import models
import auth
from services.calculos import calcular_saldo_conta, calcular_saldo_pessoa_mes
from services.dividas_service import calcular_resumo_dashboard_dividas
from typing import Optional
from datetime import date

router = APIRouter(prefix="/relatorios", tags=["relatorios"])

@router.get("/dashboard")
def dashboard(mes: Optional[int] = None, ano: Optional[int] = None, db: Session = Depends(get_db), usuario = Depends(auth.get_usuario_atual)):
    hoje = date.today()
    mes = mes or hoje.month
    ano = ano or hoje.year

    nomes_meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

    # 1. Total por Cartão no Mês
    cartoes = db.query(models.Cartao).filter(models.Cartao.usuario_id == usuario.id).all()
    dados_cartoes = []
    total_cartoes = 0.0
    for c in cartoes:
        parcelas = db.query(models.Parcela).join(models.Lancamento).filter(
            models.Lancamento.usuario_id == usuario.id,
            models.Lancamento.cartao_id == c.id,
            models.Parcela.mes == mes,
            models.Parcela.ano == ano,
            models.Lancamento.cancelado == False
        ).all()
        tot = round(sum(p.valor for p in parcelas), 2)
        if not c.ativo and not parcelas:
            continue
        total_cartoes += tot
        dados_cartoes.append({
            "id": c.id,
            "nome": c.nome,
            "cor": c.cor,
            "bandeira": c.bandeira,
            "total": tot
        })

    # 2. Total por Pessoa no Mês e Saldos Devedores
    pessoas = (
        db.query(models.Pessoa)
        .filter(models.Pessoa.usuario_id == usuario.id, models.Pessoa.ativa == True)
        .all()
    )
    dados_pessoas = []
    total_a_receber = 0.0
    for p in pessoas:
        saldo = calcular_saldo_pessoa_mes(db, p.id, mes, ano)
        dados_pessoas.append({
            "id": p.id,
            "nome": p.nome,
            "cor": p.cor,
            "foto_path": p.foto_path,
            "gastos_mes": saldo["total_gastos_mes"],
            "saldo_devedor": saldo["saldo_devedor"],
            "credito_a_favor": saldo["credito_a_favor"]
        })
        total_a_receber += saldo["saldo_devedor"]

    # Rankings ordenados para tomada de decisão
    quem_mais_deve = sorted(
        [p for p in dados_pessoas if p["saldo_devedor"] > 0],
        key=lambda x: x["saldo_devedor"],
        reverse=True
    )
    quem_mais_usou = sorted(
        [p for p in dados_pessoas if p["gastos_mes"] > 0],
        key=lambda x: x["gastos_mes"],
        reverse=True
    )
    perto_da_quitacao = sorted(
        [p for p in dados_pessoas if p["saldo_devedor"] > 0],
        key=lambda x: x["saldo_devedor"]
    )

    # 3. Total por Módulo no Mês
    modulos = db.query(models.Modulo).filter(models.Modulo.usuario_id == usuario.id).all()
    dados_modulos = []
    for m in modulos:
        parcelas = db.query(models.Parcela).join(models.Lancamento).filter(
            models.Lancamento.usuario_id == usuario.id,
            models.Lancamento.modulo_id == m.id,
            models.Parcela.mes == mes,
            models.Parcela.ano == ano,
            models.Lancamento.cancelado == False
        ).all()
        tot = round(sum(p.valor for p in parcelas), 2)
        if tot > 0:
            dados_modulos.append({
                "id": m.id,
                "nome": m.nome,
                "cor": m.cor,
                "total": tot
            })

    # 4. Saldo em Contas Bancárias
    contas = (
        db.query(models.ContaBancaria)
        .filter(models.ContaBancaria.usuario_id == usuario.id, models.ContaBancaria.ativa == True)
        .all()
    )
    dados_contas = []
    saldo_total_contas = 0.0
    for c in contas:
        s = calcular_saldo_conta(db, c.id)
        saldo_total_contas += s
        dados_contas.append({
            "id": c.id,
            "nome": c.nome,
            "cor": c.cor,
            "saldo": s
        })

    # 5. Evolução Histórica (últimos 6 meses)
    evolucao = []
    for i in range(5, -1, -1):
        m = mes - i
        a = ano
        while m <= 0:
            m += 12
            a -= 1

        parcelas_m = db.query(models.Parcela).join(models.Lancamento).filter(
            models.Lancamento.usuario_id == usuario.id,
            models.Parcela.mes == m,
            models.Parcela.ano == a,
            models.Lancamento.cancelado == False
        ).all()
        tot_m = round(sum(p.valor for p in parcelas_m), 2)

        evolucao.append({
            "mes": m,
            "ano": a,
            "nome": f"{nomes_meses[m-1]}/{str(a)[2:]}",
            "total": tot_m
        })

    # 6. Previsão de Próximas Parcelas (próximos 4 meses)
    proximas_parcelas = []
    for i in range(1, 5):
        m = mes + i
        a = ano
        while m > 12:
            m -= 12
            a += 1

        parcelas_fut = db.query(models.Parcela).join(models.Lancamento).filter(
            models.Lancamento.usuario_id == usuario.id,
            models.Parcela.mes == m,
            models.Parcela.ano == a,
            models.Parcela.status == "pendente",
            models.Lancamento.cancelado == False
        ).all()

        tot_f = round(sum(p.valor for p in parcelas_fut), 2)
        proximas_parcelas.append({
            "mes": m,
            "ano": a,
            "nome": f"{nomes_meses[m-1]}/{a}",
            "total": tot_f,
            "qtd_parcelas": len(parcelas_fut)
        })

    dividas_resumo = calcular_resumo_dashboard_dividas(db, usuario.id, mes=mes, ano=ano)

    return {
        "mes": mes,
        "ano": ano,
        "total_gastos_mes": round(total_cartoes, 2),
        "total_a_receber": round(total_a_receber, 2),
        "saldo_total_contas": round(saldo_total_contas, 2),
        "cartoes": dados_cartoes,
        "pessoas": dados_pessoas,
        "quem_mais_deve": quem_mais_deve,
        "quem_mais_usou": quem_mais_usou,
        "perto_da_quitacao": perto_da_quitacao,
        "modulos": dados_modulos,
        "contas": dados_contas,
        "evolucao_mensal": evolucao,
        "proximas_parcelas": proximas_parcelas,
        "dividas_resumo": dividas_resumo,
    }

@router.get("/fechamento-mes")
def fechamento_consolidado_mes(
    mes: Optional[int] = None,
    ano: Optional[int] = None,
    db: Session = Depends(get_db),
    usuario = Depends(auth.get_usuario_atual)
):
    hoje = date.today()
    mes = mes or hoje.month
    ano = ano or hoje.year

    # 1. Cartões no Mês
    cartoes = (
        db.query(models.Cartao)
        .filter(models.Cartao.usuario_id == usuario.id, models.Cartao.ativo == True)
        .all()
    )
    dados_cartoes = []
    total_faturas = 0.0
    for c in cartoes:
        parcelas = db.query(models.Parcela).join(models.Lancamento).filter(
            models.Lancamento.usuario_id == usuario.id,
            models.Lancamento.cartao_id == c.id,
            models.Parcela.mes == mes,
            models.Parcela.ano == ano,
            models.Lancamento.cancelado == False
        ).all()
        tot = round(sum(p.valor for p in parcelas), 2)
        pago = round(sum(p.valor for p in parcelas if p.status == "pago"), 2)
        total_faturas += tot
        dados_cartoes.append({
            "id": c.id,
            "nome": c.nome,
            "cor": c.cor,
            "bandeira": c.bandeira,
            "dia_fechamento": c.dia_fechamento,
            "dia_vencimento": c.dia_vencimento,
            "limite": c.limite,
            "total": tot,
            "pago": pago,
            "pendente": round(tot - pago, 2),
            "qtd_parcelas": len(parcelas),
            "itens": [
                {
                    "descricao": p.lancamento.descricao,
                    "pessoa": p.lancamento.pessoa.nome if p.lancamento.pessoa else "Você",
                    "parcela": f"{p.numero}/{p.lancamento.total_parcelas}",
                    "valor": p.valor,
                    "data": p.lancamento.data_lancamento.isoformat()
                }
                for p in parcelas
            ]
        })

    # 2. Pessoas no Mês
    pessoas = (
        db.query(models.Pessoa)
        .filter(models.Pessoa.usuario_id == usuario.id, models.Pessoa.ativa == True)
        .all()
    )
    dados_pessoas = []
    total_a_receber = 0.0
    total_a_pagar = 0.0
    for p in pessoas:
        saldo = calcular_saldo_pessoa_mes(db, p.id, mes, ano)
        compras_pessoa = []
        parcelas_futuras_pessoa = []
        lancamentos_p = db.query(models.Lancamento).filter(
            models.Lancamento.usuario_id == usuario.id,
            models.Lancamento.pessoa_id == p.id,
            models.Lancamento.cancelado == False
        ).all()
        for l in lancamentos_p:
            for parc in l.parcelas:
                if parc.mes == mes and parc.ano == ano:
                    compras_pessoa.append({
                        "descricao": l.descricao,
                        "tipo": l.tipo,
                        "cartao": l.cartao.nome if l.cartao else None,
                        "parcela": f"{parc.numero}/{l.total_parcelas}",
                        "valor": parc.valor,
                        "status": parc.status,
                        "data": l.data_lancamento.isoformat()
                    })
                elif (parc.ano > ano) or (parc.ano == ano and parc.mes > mes):
                    if parc.status != "pago":
                        parcelas_futuras_pessoa.append({
                            "mes": parc.mes,
                            "ano": parc.ano,
                            "descricao": l.descricao,
                            "cartao": l.cartao.nome if l.cartao else None,
                            "parcela": f"{parc.numero}/{l.total_parcelas}",
                            "valor": parc.valor
                        })

        dados_pessoas.append({
            "id": p.id,
            "nome": p.nome,
            "telefone": p.telefone,
            "foto_path": p.foto_path,
            "cor": p.cor,
            "token_acesso": p.token_acesso,
            "saldo_anterior": saldo["saldo_anterior"],
            "gastos_mes": saldo["total_gastos_mes"],
            "compras_para_mim": saldo["total_compras_para_mim_mes"],
            "reembolsos_pagos": saldo["total_reembolsos_mes"],
            "total_a_pagar": saldo["total_a_pagar"],
            "total_pagamentos": saldo["total_pagamentos_mes"],
            "saldo_devedor": saldo["saldo_devedor"],
            "credito_a_favor": saldo["credito_a_favor"],
            "compras": compras_pessoa,
            "parcelas_futuras": parcelas_futuras_pessoa
        })
        total_a_receber += saldo["saldo_devedor"]
        total_a_pagar += saldo["credito_a_favor"]

    # 3. Contas Bancárias no Mês
    contas = (
        db.query(models.ContaBancaria)
        .filter(models.ContaBancaria.usuario_id == usuario.id, models.ContaBancaria.ativa == True)
        .all()
    )
    dados_contas = []
    for c in contas:
        dados_contas.append({
            "id": c.id,
            "nome": c.nome,
            "banco": c.banco,
            "cor": c.cor,
            "saldo_atual": calcular_saldo_conta(db, c.id)
        })

    return {
        "mes": mes,
        "ano": ano,
        "total_faturas_cartoes": round(total_faturas, 2),
        "total_a_receber_pessoas": round(total_a_receber, 2),
        "total_a_pagar_pessoas": round(total_a_pagar, 2),
        "saldo_liquido_mes": round(total_a_receber - total_a_pagar, 2),
        "cartoes": dados_cartoes,
        "pessoas": dados_pessoas,
        "contas": dados_contas
    }

@router.get("/parcelas-futuras")
def parcelas_futuras(meses: int = 12, db: Session = Depends(get_db), usuario = Depends(auth.get_usuario_atual)):
    hoje = date.today()
    nomes_meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

    resultado = []
    for i in range(meses):
        m = hoje.month + i
        a = hoje.year
        while m > 12:
            m -= 12
            a += 1

        parcelas = db.query(models.Parcela).join(models.Lancamento).filter(
            models.Lancamento.usuario_id == usuario.id,
            models.Parcela.mes == m,
            models.Parcela.ano == a,
            models.Parcela.status == "pendente",
            models.Lancamento.cancelado == False
        ).all()

        itens = []
        for p in parcelas:
            l = p.lancamento
            itens.append({
                "lancamento_id": l.id,
                "descricao": l.descricao,
                "parcela": f"{p.numero}/{l.total_parcelas}",
                "valor": p.valor,
                "cartao": l.cartao.nome if l.cartao else None,
                "pessoa": l.pessoa.nome if l.pessoa else "Você",
                "modulo": l.modulo.nome if l.modulo else None
            })

        resultado.append({
            "mes": m,
            "ano": a,
            "nome_mes": f"{nomes_meses[m-1]}/{a}",
            "total": round(sum(p.valor for p in parcelas), 2),
            "itens": itens
        })

    return resultado
