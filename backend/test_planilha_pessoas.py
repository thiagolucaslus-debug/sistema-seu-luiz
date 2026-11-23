from __future__ import annotations

import time
from datetime import date
from pathlib import Path
from urllib.parse import urlsplit

from sqlalchemy.orm import Session as OrmSession

import models
from services import pdf_generator
from test_lancamentos_contas_backup import _build_test_app
from test_multiuser_and_hub_sync import _make_isolated_node


def test_edicao_inline_lancamento_parcela_pagamento_propaga_todo_sistema(tmp_path: Path):
    env = _build_test_app(tmp_path)
    c = env["client"]
    cloud_mgr = env["cloud_mgr"]
    old_pdf_dir = pdf_generator.DATA_DIR
    pdf_generator.DATA_DIR = str(env["data_dir"])
    try:
        _run_inline_propagation_assertions(c, cloud_mgr)
    finally:
        pdf_generator.DATA_DIR = old_pdf_dir
        env["cleanup"]()


def _run_inline_propagation_assertions(c, cloud_mgr):

    r_luiz = c.post("/auth/register", json={"nome": "Francisco Luiz", "usuario": "luiz_sheet", "senha": "123456"})
    assert r_luiz.status_code == 200
    h_luiz = {"Authorization": f"Bearer {r_luiz.json()['access_token']}"}

    r_outro = c.post("/auth/register", json={"nome": "Outro Usuario", "usuario": "outro_sheet", "senha": "654321"})
    assert r_outro.status_code == 200
    h_outro = {"Authorization": f"Bearer {r_outro.json()['access_token']}"}

    # Recursos do usuário principal
    card_itau = c.post(
        "/cartoes/",
        json={"nome": "ITAU", "bandeira": "Visa", "dia_fechamento": 20, "dia_vencimento": 27, "limite": 5000.0},
        headers=h_luiz,
    ).json()
    card_nu = c.post(
        "/cartoes/",
        json={"nome": "NUBANK", "bandeira": "Mastercard", "dia_fechamento": 15, "dia_vencimento": 22, "limite": 4000.0},
        headers=h_luiz,
    ).json()
    conta_inter = c.post(
        "/contas/",
        json={"nome": "Conta Inter", "banco": "Inter", "saldo_inicial": 1000.0},
        headers=h_luiz,
    ).json()
    thais = c.post(
        "/pessoas/",
        json={"nome": "THAIS", "telefone": "12996771320", "cor": "#ff004c"},
        headers=h_luiz,
    ).json()

    # Cartão/conta do outro usuário para validar bloqueio cross-tenant
    card_outro = c.post(
        "/cartoes/",
        json={"nome": "Card Outro", "bandeira": "Visa", "limite": 1000.0},
        headers=h_outro,
    ).json()
    conta_outro = c.post(
        "/contas/",
        json={"nome": "Conta Outro", "banco": "BB", "saldo_inicial": 500.0},
        headers=h_outro,
    ).json()

    # Lança compra 2x de R$ 400 (R$ 200 em Nov/2026 + R$ 200 em Dez/2026) no ITAU
    lanc = c.post(
        "/lancamentos/",
        json={
            "descricao": "Mercado Original",
            "tipo": "compra_cartao",
            "valor_total": 400.0,
            "total_parcelas": 2,
            "data_lancamento": "2026-11-05",
            "mes_fatura": 11,
            "ano_fatura": 2026,
            "cartao_id": card_itau["id"],
            "pessoa_id": thais["id"],
        },
        headers=h_luiz,
    ).json()

    # Registra pagamento de R$ 50 via Pix na Conta Inter em Nov/2026
    pag_res = c.post(
        f"/pessoas/{thais['id']}/pagamento",
        json={
            "valor": 50.0,
            "data": "2026-11-10",
            "forma": "pix",
            "conta_id": conta_inter["id"],
            "observacao": "Sinal Pix",
        },
        headers=h_luiz,
    )
    assert pag_res.status_code == 200
    pag_id = pag_res.json()["id"]

    # Verifica extrato com mês explícito sem dados (Out/2026) + campos enriquecidos
    ext_out = c.get(f"/pessoas/{thais['id']}/extrato", params={"mes": 10, "ano": 2026}, headers=h_luiz)
    assert ext_out.status_code == 200
    meses_ext = {(h["ano"], h["mes"]): h for h in ext_out.json()["historico"]}
    assert (2026, 10) in meses_ext
    assert (2026, 11) in meses_ext
    assert (2026, 12) in meses_ext
    item_nov = meses_ext[(2026, 11)]["lancamentos"][0]
    assert item_nov["cartao_id"] == card_itau["id"]
    assert item_nov["valor"] == 200.0
    assert meses_ext[(2026, 11)]["pagamentos"][0]["conta_id"] == conta_inter["id"]
    assert meses_ext[(2026, 11)]["pagamentos"][0]["forma_codigo"] == "pix"

    # Isolamento cross-tenant nos 3 novos endpoints PATCH
    assert c.patch(f"/lancamentos/{lanc['id']}", json={"descricao": "Hack"}, headers=h_outro).status_code == 404
    assert c.patch(f"/lancamentos/{lanc['id']}/parcela/1", json={"valor": 1.0}, headers=h_outro).status_code == 404
    assert c.patch(f"/pessoas/{thais['id']}/pagamento/{pag_id}", json={"valor": 1.0}, headers=h_outro).status_code == 404
    assert c.patch(f"/lancamentos/{lanc['id']}", json={"cartao_id": card_outro["id"]}, headers=h_luiz).status_code == 400
    assert c.patch(f"/pessoas/{thais['id']}/pagamento/{pag_id}", json={"conta_id": conta_outro["id"]}, headers=h_luiz).status_code == 400

    # 1. Edita descrição, data e troca cartão (ITAU -> NUBANK) via PATCH /lancamentos/{id}
    upd_l = c.patch(
        f"/lancamentos/{lanc['id']}",
        json={
            "descricao": "Supermercado Editado Planilha",
            "data_lancamento": "2026-11-12",
            "cartao_id": card_nu["id"],
        },
        headers=h_luiz,
    )
    assert upd_l.status_code == 200
    assert upd_l.headers.get("x-auto-saved") == "1"
    assert upd_l.json()["descricao"] == "Supermercado Editado Planilha"
    assert upd_l.json()["cartao"] == "NUBANK"
    assert upd_l.json()["data_lancamento"] == "2026-11-12"

    # Confirma atualização nas faturas dos cartões
    fat_itau = {
        (f["ano"], f["mes"]): f
        for f in c.get(f"/cartoes/{card_itau['id']}/faturas", params={"meses_atras": 12, "meses_frente": 12}, headers=h_luiz).json()["faturas"]
    }
    fat_nu = {
        (f["ano"], f["mes"]): f
        for f in c.get(f"/cartoes/{card_nu['id']}/faturas", params={"meses_atras": 12, "meses_frente": 12}, headers=h_luiz).json()["faturas"]
    }
    assert fat_itau[(2026, 11)]["total"] == 0.0
    assert fat_nu[(2026, 11)]["total"] == 200.0
    assert fat_nu[(2026, 12)]["total"] == 200.0

    # 2. Edita valor da parcela 1/2 (Nov/2026) de R$ 200 -> R$ 275,50 via PATCH /lancamentos/{id}/parcela/1
    upd_p = c.patch(
        f"/lancamentos/{lanc['id']}/parcela/1",
        json={"valor": 275.50},
        headers=h_luiz,
    )
    assert upd_p.status_code == 200
    assert upd_p.headers.get("x-auto-saved") == "1"
    assert upd_p.json()["valor"] == 275.50
    assert upd_p.json()["valor_total"] == 475.50

    # Verifica propagação em Extrato (Nov + carryover Dez), Lançamentos, Cartões, Dashboard e Fechamento
    ext_pos_val = {
        (h["ano"], h["mes"]): h
        for h in c.get(f"/pessoas/{thais['id']}/extrato", headers=h_luiz).json()["historico"]
    }
    assert ext_pos_val[(2026, 11)]["total_gastos"] == 275.50
    assert ext_pos_val[(2026, 11)]["saldo_devedor"] == 225.50  # 275.50 - 50.00
    assert ext_pos_val[(2026, 12)]["saldo_anterior"] == 225.50
    assert ext_pos_val[(2026, 12)]["saldo_devedor"] == 425.50  # 225.50 + 200.00

    lancs_list = c.get("/lancamentos/", params={"mes": 11, "ano": 2026}, headers=h_luiz).json()["items"]
    assert lancs_list[0]["descricao"] == "Supermercado Editado Planilha"
    assert lancs_list[0]["valor_total"] == 475.50
    assert lancs_list[0]["cartao"]["nome"] == "NUBANK"

    dash_nov = c.get("/relatorios/dashboard", params={"mes": 11, "ano": 2026}, headers=h_luiz).json()
    assert dash_nov["total_gastos_mes"] == 275.50
    assert dash_nov["total_a_receber"] == 225.50

    fech_nov = c.get("/relatorios/fechamento-mes", params={"mes": 11, "ano": 2026}, headers=h_luiz).json()
    assert fech_nov["total_faturas_cartoes"] == 275.50
    assert fech_nov["total_a_receber_pessoas"] == 225.50

    # 3. Marca parcela 1/2 como PAGO -> zera dívida da parcela em Nov e mantém invariante de carryover em Dez
    upd_status = c.patch(
        f"/lancamentos/{lanc['id']}/parcela/1",
        json={"status": "pago"},
        headers=h_luiz,
    )
    assert upd_status.status_code == 200
    assert upd_status.json()["status"] == "pago"
    ext_pago = {
        (h["ano"], h["mes"]): h
        for h in c.get(f"/pessoas/{thais['id']}/extrato", headers=h_luiz).json()["historico"]
    }
    assert ext_pago[(2026, 11)]["total_parcelas_pagas_mes"] == 275.50
    assert ext_pago[(2026, 11)]["saldo_devedor"] == 0.0
    assert ext_pago[(2026, 11)]["credito_a_favor"] == 50.0  # Pix de R$ 50 virou crédito
    assert ext_pago[(2026, 12)]["saldo_anterior"] == -50.0
    assert ext_pago[(2026, 12)]["saldo_devedor"] == 150.0  # 200 - 50 crédito

    # Gera PDF com parcela paga para confirmar que não quebra layout
    pdf_resp = c.get(f"/pessoas/{thais['id']}/pdf/11/2026", headers=h_luiz)
    assert pdf_resp.status_code == 200
    assert pdf_resp.content.startswith(b"%PDF")

    # Volta parcela 1/2 para pendente
    assert c.patch(
        f"/lancamentos/{lanc['id']}/parcela/1",
        json={"status": "pendente"},
        headers=h_luiz,
    ).status_code == 200

    # 4. Edita pagamento inline (valor 50 -> 125.50, obs) e verifica saldo da pessoa + saldo da Conta Inter
    upd_pag = c.patch(
        f"/pessoas/{thais['id']}/pagamento/{pag_id}",
        json={"valor": 125.50, "observacao": "Pix atualizado na planilha"},
        headers=h_luiz,
    )
    assert upd_pag.status_code == 200
    assert upd_pag.headers.get("x-auto-saved") == "1"
    assert upd_pag.json()["valor"] == 125.50
    assert upd_pag.json()["observacao"] == "Pix atualizado na planilha"

    ext_pag = {
        (h["ano"], h["mes"]): h
        for h in c.get(f"/pessoas/{thais['id']}/extrato", headers=h_luiz).json()["historico"]
    }
    assert ext_pag[(2026, 11)]["saldo_devedor"] == 150.0  # 275.50 - 125.50
    assert ext_pag[(2026, 12)]["saldo_anterior"] == 150.0

    contas_pos_pag = {ct["id"]: ct for ct in c.get("/contas/", headers=h_luiz).json()}
    assert contas_pos_pag[conta_inter["id"]]["saldo_atual"] == 1125.50  # 1000 + 125.50

    # Troca forma do pagamento de Pix -> Dinheiro em mãos (desvincula conta automaticamente)
    upd_pag_din = c.patch(
        f"/pessoas/{thais['id']}/pagamento/{pag_id}",
        json={"forma": "dinheiro"},
        headers=h_luiz,
    )
    assert upd_pag_din.status_code == 200
    assert upd_pag_din.json()["conta_id"] is None
    assert upd_pag_din.json()["forma_codigo"] == "dinheiro"
    contas_pos_din = {ct["id"]: ct for ct in c.get("/contas/", headers=h_luiz).json()}
    assert contas_pos_din[conta_inter["id"]]["saldo_atual"] == 1000.0

    # 5. Troca origem do lançamento de Cartão NUBANK -> Conta Inter
    upd_to_acc = c.patch(
        f"/lancamentos/{lanc['id']}",
        json={"cartao_id": None, "conta_id": conta_inter["id"]},
        headers=h_luiz,
    )
    assert upd_to_acc.status_code == 200
    assert upd_to_acc.json()["tipo"] == "despesa_conta"
    assert upd_to_acc.json()["cartao_id"] is None
    assert upd_to_acc.json()["conta_id"] == conta_inter["id"]

    contas_pos_acc = {ct["id"]: ct for ct in c.get("/contas/", headers=h_luiz).json()}
    assert contas_pos_acc[conta_inter["id"]]["saldo_atual"] == 524.50  # 1000 - 475.50

    fat_nu_final = {
        (f["ano"], f["mes"]): f
        for f in c.get(f"/cartoes/{card_nu['id']}/faturas", params={"meses_atras": 12, "meses_frente": 12}, headers=h_luiz).json()["faturas"]
    }
    assert fat_nu_final[(2026, 11)]["total"] == 0.0
    assert fat_nu_final[(2026, 12)]["total"] == 0.0

    # Confirma que todas as edições PATCH dispararam persistência automática (backup local + sync_rev)
    ver_after = c.get("/sync/version", headers=h_luiz).json()
    assert int(ver_after["sync_rev"]) >= 8
    assert cloud_mgr.status()["local_backup_at"] is not None


def test_validacoes_e_edge_cases_edicao_planilha(tmp_path: Path):
    node = _make_isolated_node(tmp_path, "hub_planilha_edge")
    c = node["client"]

    reg = c.post("/auth/register", json={"nome": "Tester", "usuario": "tester_edge", "senha": "123456"})
    h = {"Authorization": f"Bearer {reg.json()['access_token']}"}

    card = c.post("/cartoes/", json={"nome": "Visa", "bandeira": "Visa", "limite": 2000.0}, headers=h).json()
    pessoa = c.post("/pessoas/", json={"nome": "LUANE"}, headers=h).json()
    lanc = c.post(
        "/lancamentos/",
        json={
            "descricao": "Farmacia",
            "tipo": "compra_cartao",
            "valor_total": 100.0,
            "total_parcelas": 1,
            "data_lancamento": "2026-11-05",
            "mes_fatura": 11,
            "ano_fatura": 2026,
            "cartao_id": card["id"],
            "pessoa_id": pessoa["id"],
        },
        headers=h,
    ).json()
    pag_id = c.post(
        f"/pessoas/{pessoa['id']}/pagamento",
        json={"valor": 30.0, "data": "2026-11-06", "forma": "dinheiro"},
        headers=h,
    ).json()["id"]

    # Validações de erro 400 / 422 / 404
    assert c.patch(f"/lancamentos/{lanc['id']}", json={"descricao": "   "}, headers=h).status_code == 400
    assert c.patch(f"/lancamentos/{lanc['id']}", json={"valor_total": 0}, headers=h).status_code == 400
    assert c.patch(f"/lancamentos/{lanc['id']}", json={"tipo": "compra_cartao", "cartao_id": None}, headers=h).status_code == 400
    assert c.patch(f"/lancamentos/{lanc['id']}/parcela/1", json={"valor": -5}, headers=h).status_code == 422
    assert c.patch(f"/lancamentos/{lanc['id']}/parcela/99", json={"valor": 50}, headers=h).status_code == 404
    assert c.patch(f"/pessoas/{pessoa['id']}/pagamento/{pag_id}", json={"valor": 0}, headers=h).status_code == 422
    assert c.patch(f"/pessoas/{pessoa['id']}/pagamento/{pag_id}", json={"forma": "outro", "outra_forma": "  "}, headers=h).status_code == 400
    assert c.patch(f"/pessoas/{pessoa['id']}/pagamento/999999", json={"valor": 10}, headers=h).status_code == 404
    assert c.get(f"/pessoas/{pessoa['id']}/extrato", params={"mes": 13, "ano": 2026}, headers=h).status_code == 400

    # Cancela lançamento e garante que não aceita edição após cancelado
    assert c.delete(f"/lancamentos/{lanc['id']}", headers=h).status_code == 200
    assert c.patch(f"/lancamentos/{lanc['id']}", json={"descricao": "Depois de cancelar"}, headers=h).status_code == 400
    assert c.patch(f"/lancamentos/{lanc['id']}/parcela/1", json={"valor": 90.0}, headers=h).status_code == 400


def test_sync_desktop_hub_offline_inline_edits_outbox_replay(tmp_path: Path):
    hub = _make_isolated_node(tmp_path, "hub_sheet_sync", desktop_mode=False)
    hub_c = hub["client"]
    network = {"online": True}

    def bridge(method: str, url: str, headers=None, data=None, timeout: float = 12.0):
        if not network["online"]:
            raise OSError("Offline")
        parsed = urlsplit(url)
        pq = f"{parsed.path}?{parsed.query}" if parsed.query else parsed.path
        resp = hub_c.request(method, pq, headers=headers or {}, content=data)
        return resp.status_code, dict(resp.headers), resp.content

    pc = _make_isolated_node(tmp_path, "pc_sheet_sync", desktop_mode=True, hub_transport=bridge)
    pc_c = pc["client"]

    reg = hub_c.post("/auth/register", json={"nome": "Luiz Sync", "usuario": "luiz_sheet_sync", "senha": "123456"})
    h_hub = {"Authorization": f"Bearer {reg.json()['access_token']}"}

    card_hub = hub_c.post("/cartoes/", json={"nome": "ITAU", "bandeira": "Visa", "limite": 3000.0}, headers=h_hub).json()
    pessoa_hub = hub_c.post("/pessoas/", json={"nome": "ALESSANDRA"}, headers=h_hub).json()

    # Login no PC puxa snapshot
    log_pc = pc_c.post("/auth/login", json={"usuario": "luiz_sheet_sync", "senha": "123456"})
    assert log_pc.status_code == 200
    h_pc = {"Authorization": f"Bearer {log_pc.json()['access_token']}"}

    # Desloca PKs no Hub para forçar remapeamento de IDs quando o outbox do PC for reenviado
    with OrmSession(bind=hub["engine"]) as s_hub:
        s_hub.add(
            models.Lancamento(
                usuario_id=1,
                descricao="Shift PK Hub",
                tipo="despesa_conta",
                valor_total=10.0,
                total_parcelas=1,
                data_lancamento=date(2026, 10, 1),
            )
        )
        s_hub.add(
            models.PagamentoPessoa(
                usuario_id=1,
                pessoa_id=pessoa_hub["id"],
                valor=5.0,
                data=date(2026, 10, 2),
                forma_pagamento="Dinheiro em mãos",
            )
        )
        s_hub.commit()

    # Fica OFFLINE no PC: cria lançamento + pagamento e edita ambos via os 3 endpoints PATCH offline!
    network["online"] = False

    off_lanc = pc_c.post(
        "/lancamentos/",
        json={
            "descricao": "Compra Offline Inicial",
            "tipo": "compra_cartao",
            "valor_total": 100.0,
            "total_parcelas": 1,
            "data_lancamento": "2026-11-08",
            "mes_fatura": 11,
            "ano_fatura": 2026,
            "cartao_id": card_hub["id"],
            "pessoa_id": pessoa_hub["id"],
        },
        headers=h_pc,
    ).json()
    off_pag = pc_c.post(
        f"/pessoas/{pessoa_hub['id']}/pagamento",
        json={"valor": 20.0, "data": "2026-11-09", "forma": "pix", "observacao": "Obs offline"},
        headers=h_pc,
    ).json()

    # Edita inline ainda offline
    assert pc_c.patch(
        f"/lancamentos/{off_lanc['id']}",
        json={"descricao": "Compra Offline Editada"},
        headers=h_pc,
    ).status_code == 200
    assert pc_c.patch(
        f"/lancamentos/{off_lanc['id']}/parcela/1",
        json={"valor": 145.0, "status": "pendente"},
        headers=h_pc,
    ).status_code == 200
    assert pc_c.patch(
        f"/pessoas/{pessoa_hub['id']}/pagamento/{off_pag['id']}",
        json={"valor": 45.0, "observacao": "Obs editada offline"},
        headers=h_pc,
    ).status_code == 200

    # Volta ONLINE e força sincronização
    network["online"] = True
    time.sleep(0.08)

    ext_pc = pc_c.get(f"/pessoas/{pessoa_hub['id']}/extrato", headers=h_pc).json()
    ext_hub = hub_c.get(f"/pessoas/{pessoa_hub['id']}/extrato", headers=h_hub).json()

    nov_pc = next(h for h in ext_pc["historico"] if h["ano"] == 2026 and h["mes"] == 11)
    nov_hub = next(h for h in ext_hub["historico"] if h["ano"] == 2026 and h["mes"] == 11)

    assert nov_hub["lancamentos"][0]["descricao"] == "Compra Offline Editada"
    assert nov_hub["lancamentos"][0]["valor"] == 145.0
    assert nov_hub["pagamentos"][0]["valor"] == 45.0
    assert nov_hub["pagamentos"][0]["observacao"] == "Obs editada offline"
    assert nov_hub["saldo_devedor"] == 95.0  # -5.00 pago em Out + 145.00 - 45.00 = 95.00
    assert nov_pc["saldo_devedor"] == nov_hub["saldo_devedor"]
    assert nov_pc["lancamentos"][0]["descricao"] == "Compra Offline Editada"
