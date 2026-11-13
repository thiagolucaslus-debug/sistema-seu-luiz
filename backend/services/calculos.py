import calendar
from datetime import date
from typing import Optional, Dict, Any
from sqlalchemy.orm import Session
import models

def calcular_saldo_pessoa_mes(db: Session, pessoa_id: int, mes: int, ano: int) -> Dict[str, Any]:
    """
    Calcula o saldo devedor/crédito de uma pessoa em um determinado mês/ano.
    - saldo_anterior: soma das parcelas de meses anteriores pendentes (positivo: pessoa deve; negativo: Seu Luiz deve)
    - total_gastos_mes: compras que a pessoa fez no cartão do Seu Luiz neste mês
    - total_compras_para_mim_mes: compras que a pessoa fez PARA o Seu Luiz com o dinheiro dela neste mês (abate da dívida)
    - total_reembolsos_mes: acertos/reembolsos que Seu Luiz pagou para a pessoa
    - total_a_pagar: saldo líquido do mês antes dos pagamentos
    - total_pagamentos_mes: pagamentos recebidos da pessoa dentro deste mês
    - saldo_devedor: valor que a pessoa deve para o Seu Luiz (>= 0)
    - credito_a_favor: valor que o Seu Luiz deve acertar com a pessoa (> 0)
    """
    lancamentos = db.query(models.Lancamento).filter(
        models.Lancamento.pessoa_id == pessoa_id,
        models.Lancamento.cancelado == False
    ).all()

    saldo_anterior = 0.0
    total_gastos_mes = 0.0
    total_compras_para_mim_mes = 0.0
    total_reembolsos_mes = 0.0

    for lanc in lancamentos:
        is_compra_para_mim = (lanc.tipo == "compra_para_mim")
        is_reembolso = (lanc.tipo == "reembolso_pessoa")

        for parcela in lanc.parcelas:
            # Verifica se pertence a mês anterior
            if parcela.ano < ano or (parcela.ano == ano and parcela.mes < mes):
                if parcela.status == "pendente":
                    if is_compra_para_mim:
                        saldo_anterior -= parcela.valor
                    elif is_reembolso:
                        saldo_anterior += parcela.valor
                    else:
                        saldo_anterior += parcela.valor
            # Mês atual
            elif parcela.ano == ano and parcela.mes == mes:
                if is_compra_para_mim:
                    total_compras_para_mim_mes += parcela.valor
                elif is_reembolso:
                    total_reembolsos_mes += parcela.valor
                else:
                    total_gastos_mes += parcela.valor

    # Pagamentos recebidos neste mês
    _, ultimo_dia = calendar.monthrange(ano, mes)
    data_inicio = date(ano, mes, 1)
    data_fim = date(ano, mes, ultimo_dia)

    pagamentos_mes = db.query(models.PagamentoPessoa).filter(
        models.PagamentoPessoa.pessoa_id == pessoa_id,
        models.PagamentoPessoa.data >= data_inicio,
        models.PagamentoPessoa.data <= data_fim
    ).all()

    total_pagamentos_mes = sum(p.valor for p in pagamentos_mes)
    total_a_pagar = round(saldo_anterior + total_gastos_mes - total_compras_para_mim_mes + total_reembolsos_mes, 2)
    diferenca = round(total_a_pagar - total_pagamentos_mes, 2)

    return {
        "saldo_anterior": round(saldo_anterior, 2),
        "total_gastos_mes": round(total_gastos_mes, 2),
        "total_compras_para_mim_mes": round(total_compras_para_mim_mes, 2),
        "total_reembolsos_mes": round(total_reembolsos_mes, 2),
        "total_a_pagar": total_a_pagar,
        "total_pagamentos_mes": round(total_pagamentos_mes, 2),
        "saldo_devedor": max(diferenca, 0.0),
        "credito_a_favor": abs(min(diferenca, 0.0))
    }

def calcular_total_fatura_cartao(db: Session, cartao_id: int, mes: int, ano: int) -> Dict[str, Any]:
    """Calcula o total da fatura de um cartão em determinado mês."""
    parcelas = db.query(models.Parcela).join(models.Lancamento).filter(
        models.Lancamento.cartao_id == cartao_id,
        models.Parcela.mes == mes,
        models.Parcela.ano == ano,
        models.Lancamento.cancelado == False
    ).all()

    total = sum(p.valor for p in parcelas)
    pago = sum(p.valor for p in parcelas if p.status == "pago")
    pendente = total - pago

    pag_fatura = db.query(models.PagamentoFatura).filter(
        models.PagamentoFatura.cartao_id == cartao_id,
        models.PagamentoFatura.mes == mes,
        models.PagamentoFatura.ano == ano
    ).first()

    return {
        "total": round(total, 2),
        "pago": round(pago, 2),
        "pendente": round(pendente, 2),
        "num_itens": len(parcelas),
        "fatura_paga": pag_fatura is not None,
        "valor_pago_fatura": round(pag_fatura.valor, 2) if pag_fatura else 0.0,
        "data_pagamento_fatura": str(pag_fatura.data) if pag_fatura else None
    }

def calcular_saldo_conta(db: Session, conta_id: int, ate_data: Optional[date] = None) -> float:
    """Calcula o saldo corrente real de uma conta bancária."""
    conta = db.query(models.ContaBancaria).filter(models.ContaBancaria.id == conta_id).first()
    if not conta:
        return 0.0

    saldo = conta.saldo_inicial

    # 1. Receitas creditadas na conta
    q_receitas = db.query(models.Lancamento).filter(
        models.Lancamento.conta_id == conta_id,
        models.Lancamento.tipo == "receita",
        models.Lancamento.cancelado == False
    )
    if ate_data:
        q_receitas = q_receitas.filter(models.Lancamento.data_lancamento <= ate_data)
    saldo += sum(l.valor_total for l in q_receitas.all())

    # 2. Pagamentos de pessoas recebidos nesta conta
    q_pags_pessoas = db.query(models.PagamentoPessoa).filter(
        models.PagamentoPessoa.conta_id == conta_id
    )
    if ate_data:
        q_pags_pessoas = q_pags_pessoas.filter(models.PagamentoPessoa.data <= ate_data)
    saldo += sum(p.valor for p in q_pags_pessoas.all())

    # 3. Despesas, empréstimos e reembolsos saídos desta conta
    q_saidas = db.query(models.Lancamento).filter(
        models.Lancamento.conta_id == conta_id,
        models.Lancamento.tipo.in_(["despesa_conta", "emprestimo_dado", "reembolso_pessoa"]),
        models.Lancamento.cancelado == False
    )
    if ate_data:
        q_saidas = q_saidas.filter(models.Lancamento.data_lancamento <= ate_data)
    saldo -= sum(l.valor_total for l in q_saidas.all())

    # 4. Pagamentos de fatura saindo desta conta
    q_faturas = db.query(models.PagamentoFatura).filter(
        models.PagamentoFatura.conta_id == conta_id
    )
    if ate_data:
        q_faturas = q_faturas.filter(models.PagamentoFatura.data <= ate_data)
    saldo -= sum(p.valor for p in q_faturas.all())

    # 5. Transferências saindo desta conta (origem)
    q_transf_out = db.query(models.Lancamento).filter(
        models.Lancamento.conta_id == conta_id,
        models.Lancamento.tipo == "transferencia",
        models.Lancamento.cancelado == False
    )
    if ate_data:
        q_transf_out = q_transf_out.filter(models.Lancamento.data_lancamento <= ate_data)
    saldo -= sum(l.valor_total for l in q_transf_out.all())

    # 6. Transferências entrando nesta conta (destino)
    q_transf_in = db.query(models.Lancamento).filter(
        models.Lancamento.conta_destino_id == conta_id,
        models.Lancamento.tipo == "transferencia",
        models.Lancamento.cancelado == False
    )
    if ate_data:
        q_transf_in = q_transf_in.filter(models.Lancamento.data_lancamento <= ate_data)
    saldo += sum(l.valor_total for l in q_transf_in.all())

    return round(saldo, 2)
