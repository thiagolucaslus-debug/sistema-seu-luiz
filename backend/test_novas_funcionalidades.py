import os
import sys
from datetime import date
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import models
from database import Base
from services.calculos import calcular_saldo_pessoa_mes

def test_calculo_saldo_bidirecional():
    # Cria banco em memória para teste
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()

    # Cria pessoa
    pessoa = models.Pessoa(nome="Thais Teste", token_acesso="token123")
    cartao = models.Cartao(nome="Cartão Teste", bandeira="visa", dia_fechamento=20, dia_vencimento=27)
    db.add_all([pessoa, cartao])
    db.commit()

    # 1. Compra no cartão feita por Thais: R$ 500 em 2 parcelas de R$ 250 (mês 11 e mês 12)
    lanc1 = models.Lancamento(
        descricao="Tênis",
        valor_total=500.0,
        tipo=models.TipoLancamento.compra_cartao,
        total_parcelas=2,
        pessoa_id=pessoa.id,
        cartao_id=cartao.id,
        data_lancamento=date(2026, 11, 5)
    )
    p1 = models.Parcela(numero=1, valor=250.0, mes=11, ano=2026)
    p2 = models.Parcela(numero=2, valor=250.0, mes=12, ano=2026)
    lanc1.parcelas = [p1, p2]
    db.add(lanc1)

    # 2. Compra bidirecional: Thais comprou algo PARA Seu Luiz no valor de R$ 100 com o dinheiro dela
    lanc_comp = models.Lancamento(
        descricao="Remédio pro Seu Luiz",
        valor_total=100.0,
        tipo=models.TipoLancamento.compra_para_mim,
        total_parcelas=1,
        pessoa_id=pessoa.id,
        data_lancamento=date(2026, 11, 10)
    )
    p_comp = models.Parcela(numero=1, valor=100.0, mes=11, ano=2026)
    lanc_comp.parcelas = [p_comp]
    db.add(lanc_comp)

    db.commit()

    # Calcula saldo do mês 11/2026
    # Gasto no cartão: R$ 250
    # Comprou pra mim: R$ 100
    # Saldo devedor final: 250 - 100 = R$ 150
    saldo = calcular_saldo_pessoa_mes(db, pessoa.id, 11, 2026)
    assert saldo["total_gastos_mes"] == 250.0
    assert saldo["total_compras_para_mim_mes"] == 100.0
    assert saldo["saldo_devedor"] == 150.0
    assert saldo["credito_a_favor"] == 0.0

    # Agora simula se ela comprou R$ 200 a mais pra Seu Luiz (ultrapassando a dívida)
    lanc_comp2 = models.Lancamento(
        descricao="Material de construção pro Seu Luiz",
        valor_total=200.0,
        tipo=models.TipoLancamento.compra_para_mim,
        total_parcelas=1,
        pessoa_id=pessoa.id,
        data_lancamento=date(2026, 11, 15)
    )
    p_comp2 = models.Parcela(numero=1, valor=200.0, mes=11, ano=2026)
    lanc_comp2.parcelas = [p_comp2]
    db.add(lanc_comp2)
    db.commit()

    # Gasto no cartão: R$ 250
    # Total comprou pra mim: R$ 300
    # Saldo devedor: R$ 0,00
    # Crédito a favor de Thais: R$ 50,00 (Seu Luiz deve R$ 50 para ela!)
    saldo2 = calcular_saldo_pessoa_mes(db, pessoa.id, 11, 2026)
    assert saldo2["saldo_devedor"] == 0.0
    assert saldo2["credito_a_favor"] == 50.0

    db.close()
