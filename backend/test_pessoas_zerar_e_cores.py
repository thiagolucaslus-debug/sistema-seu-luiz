from __future__ import annotations

from datetime import date
from pathlib import Path
from urllib.parse import urlsplit

from test_multiuser_and_hub_sync import _make_isolated_node


def test_restaurar_pessoa_zerar_conta_excluir_parcela_e_isolamento(tmp_path: Path):
    node = _make_isolated_node(tmp_path, "hub_pessoas_zerar")
    c = node["client"]

    # Cria dois usuários para validar isolamento estrito
    r_luiz = c.post("/auth/register", json={"nome": "Francisco Luiz", "usuario": "luiz", "senha": "123456"})
    assert r_luiz.status_code == 200
    h_luiz = {"Authorization": f"Bearer {r_luiz.json()['access_token']}"}

    r_outro = c.post("/auth/register", json={"nome": "Outro Gestor", "usuario": "outro", "senha": "654321"})
    assert r_outro.status_code == 200
    h_outro = {"Authorization": f"Bearer {r_outro.json()['access_token']}"}

    # Cartão com cor personalizada na paleta e duas pessoas
    cartao = c.post(
        "/cartoes/",
        json={
            "nome": "ITAU 7467",
            "bandeira": "Visa",
            "dia_fechamento": 20,
            "dia_vencimento": 27,
            "limite": 5000.0,
            "cor": "#5712f8",
        },
        headers=h_luiz,
    ).json()
    assert cartao["cor"] == "#5712f8"

    # Altera a cor do cartão via PUT /cartoes/{id}
    cartao_upd = c.put(f"/cartoes/{cartao['id']}", json={"cor": "#06b6d4"}, headers=h_luiz)
    assert cartao_upd.status_code == 200
    assert cartao_upd.json()["cor"] == "#06b6d4"

    # Cria foto simulada em uploads e pessoa com caminho legado http://localhost:8000/uploads/...
    (node["uploads_dir"] / "pessoa_thais.png").write_bytes(b"\x89PNG\r\n\x1a\nfakepng")
    thais = c.post(
        "/pessoas/",
        json={
            "nome": "THAIS",
            "telefone": "12996771320",
            "cor": "#ff004c",
            "foto_path": "http://localhost:8000/uploads/pessoa_thais.png",
        },
        headers=h_luiz,
    ).json()
    alessandra = c.post(
        "/pessoas/",
        json={"nome": "ALESSANDRA", "telefone": "12988304892", "cor": "#c800ff"},
        headers=h_luiz,
    ).json()

    hoje = date.today()
    mes_atual, ano_atual = hoje.month, hoje.year
    mes_seg = 1 if mes_atual == 12 else mes_atual + 1
    ano_seg = ano_atual + 1 if mes_atual == 12 else ano_atual

    # Lança compra parcelada 3x de R$ 600 para THAIS (R$ 200/mês) e R$ 80 à vista para ALESSANDRA
    lanc_thais = c.post(
        "/lancamentos/",
        json={
            "descricao": "Supermercado Thais",
            "tipo": "compra_cartao",
            "valor_total": 600.0,
            "total_parcelas": 3,
            "data_lancamento": hoje.isoformat(),
            "mes_fatura": mes_atual,
            "ano_fatura": ano_atual,
            "cartao_id": cartao["id"],
            "pessoa_id": thais["id"],
        },
        headers=h_luiz,
    ).json()

    c.post(
        "/lancamentos/",
        json={
            "descricao": "Farmacia Alessandra",
            "tipo": "compra_cartao",
            "valor_total": 80.0,
            "total_parcelas": 1,
            "data_lancamento": hoje.isoformat(),
            "mes_fatura": mes_atual,
            "ano_fatura": ano_atual,
            "cartao_id": cartao["id"],
            "pessoa_id": alessandra["id"],
        },
        headers=h_luiz,
    )

    # 1. Cancela apenas a parcela 1/3 de THAIS -> mês atual deve zerar para THAIS sem afetar mês seguinte nem ALESSANDRA
    r_parc = c.patch(
        f"/lancamentos/{lanc_thais['id']}/parcela/1/status",
        params={"status": "cancelado"},
        headers=h_luiz,
    )
    assert r_parc.status_code == 200

    lista_p = {p["nome"]: p for p in c.get("/pessoas/", headers=h_luiz).json()}
    assert lista_p["THAIS"]["foto_path"] == "/uploads/pessoa_thais.png"
    assert lista_p["THAIS"]["total_gastos_mes"] == 0.0
    assert lista_p["THAIS"]["saldo_devedor"] == 0.0
    assert lista_p["ALESSANDRA"]["saldo_devedor"] == 80.0

    # Fatura do cartão no mês atual considera apenas os R$ 80 da ALESSANDRA (parcela cancelada da THAIS não infla fatura)
    fat_atual = c.get("/cartoes/", headers=h_luiz).json()[0]["fatura_mes_atual"]
    assert fat_atual["total"] == 80.0

    # Mês seguinte de THAIS continua com a parcela 2/3 de R$ 200
    ext_thais = c.get(f"/pessoas/{thais['id']}/extrato", headers=h_luiz).json()
    hist_seg = next(h for h in ext_thais["historico"] if h["mes"] == mes_seg and h["ano"] == ano_seg)
    assert hist_seg["total_gastos"] == 200.0
    assert hist_seg["lancamentos"][0]["cartao_cor"] == "#06b6d4"

    # 2. Modo 'abater_divida' na ALESSANDRA quita a dívida dela (R$ 0,00) mantendo a compra na fatura do cartão!
    res_abater = c.post(
        f"/pessoas/{alessandra['id']}/zerar",
        json={"modo": "abater_divida", "escopo": "mes", "mes": mes_atual, "ano": ano_atual},
        headers=h_luiz,
    )
    assert res_abater.status_code == 200
    assert res_abater.json()["valor_abatido"] == 80.0
    lista_pos_abate = {p["nome"]: p for p in c.get("/pessoas/", headers=h_luiz).json()}
    assert lista_pos_abate["ALESSANDRA"]["saldo_devedor"] == 0.0
    assert c.get("/cartoes/", headers=h_luiz).json()[0]["fatura_mes_atual"]["total"] == 80.0

    # Chamada repetida de abater_divida quando já está zerada é idempotente
    res_abater_dup = c.post(
        f"/pessoas/{alessandra['id']}/zerar",
        json={"modo": "abater_divida", "escopo": "mes", "mes": mes_atual, "ano": ano_atual},
        headers=h_luiz,
    )
    assert res_abater_dup.status_code == 200
    assert res_abater_dup.json()["valor_abatido"] == 0.0

    # 3. Registra pagamento avulso para THAIS e depois aciona 'apagar_lancamentos' (escopo='tudo', limpar_pagamentos=True)
    c.post(
        f"/pessoas/{thais['id']}/pagamento",
        json={"valor": 500.0, "data": hoje.isoformat(), "forma": "pix"},
        headers=h_luiz,
    )
    # Isolamento cross-tenant: outro usuário não consegue zerar nem restaurar THAIS
    assert c.post(f"/pessoas/{thais['id']}/zerar", json={}, headers=h_outro).status_code == 404

    res_zerar = c.post(
        f"/pessoas/{thais['id']}/zerar",
        json={"modo": "apagar_lancamentos", "escopo": "tudo", "limpar_pagamentos": True},
        headers=h_luiz,
    )
    assert res_zerar.status_code == 200
    assert res_zerar.json()["lancamentos_cancelados"] == 1
    assert res_zerar.json()["pagamentos_removidos"] == 1

    # THAIS continua cadastrada, com mesmo token_acesso, foto e saldo R$ 0,00 (sem crédito residual)
    thais_after = next(p for p in c.get("/pessoas/", headers=h_luiz).json() if p["id"] == thais["id"])
    assert thais_after["saldo_devedor"] == 0.0
    assert thais_after["credito_a_favor"] == 0.0
    assert thais_after["token_acesso"] == thais["token_acesso"]
    assert thais_after["foto_path"] == "/uploads/pessoa_thais.png"

    # 4. Remoção acidental (DELETE /pessoas/{id}) e restauração em 1 clique (POST /pessoas/{id}/restaurar)
    assert c.delete(f"/pessoas/{thais['id']}", headers=h_luiz).status_code == 200
    assert all(p["id"] != thais["id"] for p in c.get("/pessoas/", headers=h_luiz).json())
    inativas = c.get("/pessoas/", params={"inativas": "true"}, headers=h_luiz).json()
    assert [p["id"] for p in inativas] == [thais["id"]]
    assert c.get(f"/public/lancar/{thais['token_acesso']}").status_code == 404

    assert c.post(f"/pessoas/{thais['id']}/restaurar", headers=h_outro).status_code == 404
    rest_ok = c.post(f"/pessoas/{thais['id']}/restaurar", headers=h_luiz)
    assert rest_ok.status_code == 200
    assert rest_ok.json()["pessoa"]["token_acesso"] == thais["token_acesso"]
    assert c.get(f"/public/lancar/{thais['token_acesso']}").status_code == 200


def test_sync_desktop_hub_zerar_restaurar_e_upload_legado(tmp_path: Path):
    hub = _make_isolated_node(tmp_path, "hub_cloud", desktop_mode=False)
    hub_c = hub["client"]
    network = {"online": True}

    def bridge(method: str, url: str, headers=None, data=None, timeout: float = 12.0):
        if not network["online"]:
            raise OSError("Offline")
        parsed = urlsplit(url)
        pq = f"{parsed.path}?{parsed.query}" if parsed.query else parsed.path
        resp = hub_c.request(method, pq, headers=headers or {}, content=data)
        return resp.status_code, dict(resp.headers), resp.content

    pc = _make_isolated_node(tmp_path, "pc_local", desktop_mode=True, hub_transport=bridge)
    pc_c = pc["client"]

    reg = hub_c.post("/auth/register", json={"nome": "Luiz", "usuario": "luiz_sync", "senha": "123456"})
    h_hub = {"Authorization": f"Bearer {reg.json()['access_token']}"}
    (hub["uploads_dir"] / "avatar_legado.png").write_bytes(b"PNG_AVATAR_LEGADO")
    p_hub = hub_c.post(
        "/pessoas/",
        json={
            "nome": "EDINA",
            "telefone": "12997304148",
            "foto_path": "http://localhost:8000/uploads/avatar_legado.png",
        },
        headers=h_hub,
    ).json()
    card_hub = hub_c.post(
        "/cartoes/",
        json={"nome": "coop", "bandeira": "Visa", "cor": "#616161"},
        headers=h_hub,
    ).json()
    hub_c.post(
        "/lancamentos/",
        json={
            "descricao": "Compra Teste",
            "tipo": "compra_cartao",
            "valor_total": 150.0,
            "total_parcelas": 1,
            "data_lancamento": date.today().isoformat(),
            "cartao_id": card_hub["id"],
            "pessoa_id": p_hub["id"],
        },
        headers=h_hub,
    )

    # Login no PC puxa snapshot e baixa avatar mesmo com URL legada http://localhost:8000/uploads/...
    log_pc = pc_c.post("/auth/login", json={"usuario": "luiz_sync", "senha": "123456"})
    assert log_pc.status_code == 200
    h_pc = {"Authorization": f"Bearer {log_pc.json()['access_token']}"}
    assert (pc["uploads_dir"] / "avatar_legado.png").read_bytes() == b"PNG_AVATAR_LEGADO"

    # Em modo offline no PC, zera gastos de EDINA e muda cor do cartão -> sincroniza ao reconectar
    network["online"] = False
    assert pc_c.post(
        f"/pessoas/{p_hub['id']}/zerar",
        json={"modo": "apagar_lancamentos", "escopo": "tudo", "limpar_pagamentos": True},
        headers=h_pc,
    ).status_code == 200
    assert pc_c.put(f"/cartoes/{card_hub['id']}", json={"cor": "#ec4899"}, headers=h_pc).status_code == 200

    network["online"] = True
    import time as _t
    _t.sleep(0.08)

    pessoas_pc = pc_c.get("/pessoas/", headers=h_pc).json()
    assert pessoas_pc[0]["saldo_devedor"] == 0.0
    pessoas_hub = hub_c.get("/pessoas/", headers=h_hub).json()
    assert pessoas_hub[0]["saldo_devedor"] == 0.0
    assert hub_c.get("/cartoes/", headers=h_hub).json()[0]["cor"] == "#ec4899"
