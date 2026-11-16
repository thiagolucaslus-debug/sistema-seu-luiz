from __future__ import annotations

import io
import json
import sqlite3
import zipfile
from datetime import date
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from services.dividas_service import (
    clamp_due_date,
    montar_painel_dividas,
    simular_plano_quitacao,
)
from test_multiuser_and_hub_sync import FakeGitHubVaultAPI, _make_isolated_node
import models


def _register_and_headers(client: Any, nome: str, usuario: str, senha: str = "SenhaForte123") -> dict[str, str]:
    r = client.post("/auth/register", json={"nome": nome, "usuario": usuario, "senha": senha})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_clamp_calendario_meses_curtos_e_ano_bissexto():
    # Fevereiro comum (2026 -> 28 dias) e bissexto (2028 -> 29 dias)
    assert clamp_due_date(2026, 2, 30) == date(2026, 2, 28)
    assert clamp_due_date(2026, 2, 31) == date(2026, 2, 28)
    assert clamp_due_date(2028, 2, 30) == date(2028, 2, 29)
    assert clamp_due_date(2028, 2, 31) == date(2028, 2, 29)
    # Meses de 30 dias (Abril) vs 31 dias (Maio)
    assert clamp_due_date(2026, 4, 31) == date(2026, 4, 30)
    assert clamp_due_date(2026, 4, 30) == date(2026, 4, 30)
    assert clamp_due_date(2026, 5, 31) == date(2026, 5, 31)


def test_fluxo_completo_dividas_carro_moto_condominio_radar_baixa_estorno_e_antecipacao(tmp_path: Path):
    node = _make_isolated_node(tmp_path, "core_dividas")
    client = node["client"]
    hdr = _register_and_headers(client, "Seu Luiz", "luiz_dividas")

    # Cria conta bancária Itaú com R$ 10.000,00 de saldo inicial
    r_conta = client.post(
        "/contas/",
        headers=hdr,
        json={"nome": "Itaú Principal", "banco": "Itaú", "saldo_inicial": 10000.0},
    )
    assert r_conta.status_code == 200
    conta_id = r_conta.json()["id"]

    # 1) Cadastra Carro: 18x de R$ 1.500 todo dia 20, já com 5 parcelas pagas antes do cadastro!
    # Próxima parcela (#6/18) iniciando em 11/2026.
    r_carro = client.post(
        "/dividas/",
        headers=hdr,
        json={
            "nome": "Carro",
            "credor": "Banco BV",
            "categoria": "Veículo",
            "tipo_compromisso": "parcelada",
            "valor_parcela": 1500.0,
            "dia_vencimento": 20,
            "total_parcelas": 18,
            "parcelas_pagas_anteriores": 5,
            "mes_inicio": 11,
            "ano_inicio": 2026,
            "taxa_juros_mensal": 1.8,
            "desconto_antecipacao_pct": 5.0,
            "conta_padrao_id": conta_id,
        },
    )
    assert r_carro.status_code == 200, r_carro.text
    carro = r_carro.json()
    assert carro["total_parcelas"] == 18
    assert carro["parcelas_pagas"] == 5
    assert carro["parcelas_restantes"] == 13
    assert carro["saldo_restante"] == 19500.0  # 13 * 1500
    # As 5 parcelas anteriores NÃO podem ter alterado o saldo da conta bancária!
    contas_apos_cadastro = client.get("/contas/", headers=hdr).json()
    assert contas_apos_cadastro[0]["saldo_atual"] == 10000.0

    # Verifica clamping de fevereiro/2027 para Moto (todo dia 30, 10x de R$ 600)
    r_moto = client.post(
        "/dividas/",
        headers=hdr,
        json={
            "nome": "Moto",
            "categoria": "Veículo",
            "tipo_compromisso": "parcelada",
            "valor_parcela": 600.0,
            "dia_vencimento": 30,
            "total_parcelas": 10,
            "parcelas_pagas_anteriores": 0,
            "mes_inicio": 11,
            "ano_inicio": 2026,
            "taxa_juros_mensal": 0.9,
        },
    )
    assert r_moto.status_code == 200
    moto = r_moto.json()
    parc_fev = next(p for p in moto["parcelas"] if p["ano"] == 2027 and p["mes"] == 2)
    assert parc_fev["vencimento"] == "2027-02-28"

    # 3) Cadastra Condomínio: conta fixa mensal todo dia 15 (R$ 850,00)
    r_cond = client.post(
        "/dividas/",
        headers=hdr,
        json={
            "nome": "Condomínio",
            "categoria": "Moradia / Condomínio",
            "tipo_compromisso": "fixa",
            "valor_parcela": 850.0,
            "dia_vencimento": 15,
            "mes_inicio": 11,
            "ano_inicio": 2026,
        },
    )
    assert r_cond.status_code == 200
    cond = r_cond.json()

    # Verifica Radar determinístico simulando referência em 16/11/2026:
    # - Condomínio (dia 15/11) -> Atrasada há 1 dia
    # - Carro (dia 20/11) -> Faltam 4 dias — Dia 20
    # - Moto (dia 30/11) -> Faltam 14 dias — Dia 30
    SessionLocal = node["engine"]
    from sqlalchemy.orm import sessionmaker

    with sessionmaker(bind=SessionLocal)() as db_sess:
        usr = db_sess.query(models.Usuario).filter(models.Usuario.email == "luiz_dividas").first()
        painel_ref = montar_painel_dividas(
            db_sess,
            usr.id,
            mes=11,
            ano=2026,
            ref_date=date(2026, 11, 16),
            janela_dias=15,
        )
        assert [x["divida_nome"] for x in painel_ref["agenda_mes"]] == ["Condomínio", "Carro", "Moto"]
        assert painel_ref["resumo"]["total_comprometido_mes"] == 2950.0  # 850 + 1500 + 600
        assert len(painel_ref["radar"]["atrasadas"]) == 1
        assert painel_ref["radar"]["atrasadas"][0]["divida_nome"] == "Condomínio"
        assert "Atrasada há 1 dia" in painel_ref["radar"]["atrasadas"][0]["rotulo_vencimento"]

        prox_nomes = {x["divida_nome"]: x["rotulo_vencimento"] for x in painel_ref["radar"]["proximos_vencimentos"]}
        assert prox_nomes["Carro"] == "Faltam 4 dias — Dia 20"
        assert prox_nomes["Moto"] == "Faltam 14 dias — Dia 30"

        # Estratégia: Bola de Neve prioriza Moto (saldo R$ 6.000 < R$ 19.500),
        # Avalanche prioriza Carro (juros 1.8% > 0.9% e libera +R$ 1.500/mês)
        assert painel_ref["estrategia"]["bola_de_neve"][0]["nome"] == "Moto"
        assert painel_ref["estrategia"]["avalanche"][0]["nome"] == "Carro"
        assert painel_ref["estrategia"]["avalanche"][0]["alivio_mensal"] == 1500.0

    # Ajuste de valor no mês na conta fixa (Condomínio teve taxa extra em 12/2026 -> R$ 920,00)
    r_aj = client.put(
        f"/dividas/{cond['id']}/ajuste-mes",
        headers=hdr,
        json={"mes": 12, "ano": 2026, "novo_valor": 920.0, "observacao": " Pintura fachada "},
    )
    assert r_aj.status_code == 200
    painel_dez = client.get("/dividas/painel?mes=12&ano=2026", headers=hdr).json()
    oc_cond_dez = next(x for x in painel_dez["agenda_mes"] if x["divida_nome"] == "Condomínio")
    assert oc_cond_dez["valor_atual"] == 920.0

    # 4) Baixa integrada com Conta Bancária: paga parcela #6 do Carro (R$ 1.500) pela conta Itaú
    r_pag = client.post(
        f"/dividas/{carro['id']}/pagar",
        headers=hdr,
        json={
            "numero": 6,
            "mes": 11,
            "ano": 2026,
            "valor_pago": 1500.0,
            "data_pagamento": "2026-11-20",
            "conta_id": conta_id,
        },
    )
    assert r_pag.status_code == 200, r_pag.text
    assert client.get("/contas/", headers=hdr).json()[0]["saldo_atual"] == 8500.0

    # Impede pagamento duplicado da mesma parcela
    r_dup = client.post(
        f"/dividas/{carro['id']}/pagar",
        headers=hdr,
        json={"numero": 6, "mes": 11, "ano": 2026, "conta_id": conta_id},
    )
    assert r_dup.status_code == 400

    # Baixa SEM conta bancária (pago em dinheiro por fora): Condomínio 11/2026
    r_pag_ext = client.post(
        f"/dividas/{cond['id']}/pagar",
        headers=hdr,
        json={"mes": 11, "ano": 2026, "valor_pago": 850.0, "data_pagamento": "2026-11-16", "conta_id": None},
    )
    assert r_pag_ext.status_code == 200
    # Saldo bancário permanece intacto em R$ 8.500,00
    assert client.get("/contas/", headers=hdr).json()[0]["saldo_atual"] == 8500.0

    # 5) Estorno do pagamento do Carro -> reverte lançamento e restaura saldo p/ R$ 10.000,00!
    r_est = client.post(
        f"/dividas/{carro['id']}/estornar",
        headers=hdr,
        json={"numero": 6, "mes": 11, "ano": 2026},
    )
    assert r_est.status_code == 200
    assert r_est.json()["lancamento_revertido"] is True
    assert client.get("/contas/", headers=hdr).json()[0]["saldo_atual"] == 10000.0

    # 6) Antecipação de 2 últimas parcelas do Carro com 5% de desconto debitando da conta Itaú
    # 2 * 1500 = 3000 -> 5% desconto = 2850 (economia R$ 150)
    r_ant = client.post(
        f"/dividas/{carro['id']}/antecipar",
        headers=hdr,
        json={
            "quantidade_parcelas": 2,
            "ordem": "ultimas",
            "desconto_pct": 5.0,
            "data_pagamento": "2026-11-16",
            "conta_id": conta_id,
        },
    )
    assert r_ant.status_code == 200, r_ant.text
    ant_data = r_ant.json()
    assert ant_data["parcelas_antecipadas"] == [17, 18]
    assert ant_data["valor_total_pago"] == 2850.0
    assert ant_data["economia_desconto"] == 150.0
    assert client.get("/contas/", headers=hdr).json()[0]["saldo_atual"] == 7150.0

    # 7) Simulador de quitação e Dashboard
    r_sim = client.post(
        "/dividas/simular",
        headers=hdr,
        json={"aporte_unico": 3000.0, "aporte_mensal_extra": 500.0, "estrategia": "avalanche"},
    )
    assert r_sim.status_code == 200
    sim = r_sim.json()
    assert sim["possui_dividas_parceladas"] is True
    assert sim["meses_plano_acelerado"] <= sim["meses_cronograma_atual"]
    assert sim["simulacao_alvo"]["parcelas_que_abate"] >= 2

    dash = client.get("/relatorios/dashboard?mes=11&ano=2026", headers=hdr).json()
    assert dash["dividas_resumo"]["possui_dividas"] is True

    # 8) Reconciliação cruzada: cancelar lançamento de antecipação em /lancamentos reverte a parcela da dívida!
    extrato = client.get(f"/contas/{conta_id}/extrato", headers=hdr).json()
    lanc_id_18 = extrato["movimentacoes"][0]["id"]
    assert client.delete(f"/lancamentos/{lanc_id_18}", headers=hdr).status_code == 200
    assert client.get("/contas/", headers=hdr).json()[0]["saldo_atual"] == 8575.0

    # 9) Excluir dívida remove qualquer lançamento restante vinculado para nunca deixar deriva no saldo bancário
    r_del = client.delete(f"/dividas/{carro['id']}", headers=hdr)
    assert r_del.status_code == 200
    assert client.get("/contas/", headers=hdr).json()[0]["saldo_atual"] == 10000.0


def test_isolamento_multiusuario_hub_sync_offline_vault_e_backup_zip_dividas(tmp_path: Path):
    vault_api = FakeGitHubVaultAPI()
    aes_hex = "ab" * 32
    secret = "segredo-vault-dividas"

    hub = _make_isolated_node(
        tmp_path, "hub_render", desktop_mode=False, vault_http=vault_api.transport, hydrate_secret=secret
    )

    online = {"up": True}

    def hub_transport(method: str, url: str, headers=None, data=None, timeout=12.0):
        if not online["up"]:
            raise OSError("Sem internet")
        parts = urlsplit(url)
        pq = f"{parts.path}?{parts.query}" if parts.query else parts.path
        resp = hub["client"].request(method, pq, headers=headers or {}, content=data)
        return resp.status_code, dict(resp.headers), resp.content

    pc = _make_isolated_node(tmp_path, "desktop_pc", desktop_mode=True, hub_transport=hub_transport)

    # Usuário A registra no PC (sincronizado ao Hub) e Usuário B registra direto no celular (Hub)
    hdr_a_pc = _register_and_headers(pc["client"], "Alice", "alice_div")
    hdr_b_hub = _register_and_headers(hub["client"], "Bruno", "bruno_div")

    # Bruno cadastra dívida dele no celular
    r_b = hub["client"].post(
        "/dividas/",
        headers=hdr_b_hub,
        json={
            "nome": "Financiamento Apartamento Bruno",
            "tipo_compromisso": "parcelada",
            "valor_parcela": 2800.0,
            "dia_vencimento": 10,
            "total_parcelas": 120,
            "mes_inicio": 11,
            "ano_inicio": 2026,
        },
    )
    assert r_b.status_code == 200

    # Alice desconecta da internet no PC, cria Conta + Dívida + Paga Parcela 1 em modo offline!
    online["up"] = False
    c_alice_off = pc["client"].post(
        "/contas/",
        headers=hdr_a_pc,
        json={"nome": "Nubank Alice", "banco": "Nubank", "saldo_inicial": 5000.0},
    ).json()
    d_alice_off = pc["client"].post(
        "/dividas/",
        headers=hdr_a_pc,
        json={
            "nome": "Carro Alice Offline",
            "tipo_compromisso": "parcelada",
            "valor_parcela": 1200.0,
            "dia_vencimento": 20,
            "total_parcelas": 12,
            "mes_inicio": 11,
            "ano_inicio": 2026,
            "conta_padrao_id": c_alice_off["id"],
        },
    ).json()
    p_alice_off = pc["client"].post(
        f"/dividas/{d_alice_off['id']}/pagar",
        headers=hdr_a_pc,
        json={
            "numero": 1,
            "mes": 11,
            "ano": 2026,
            "valor_pago": 1200.0,
            "data_pagamento": "2026-11-20",
            "conta_id": c_alice_off["id"],
        },
    )
    assert p_alice_off.status_code == 200

    # Reconecta internet: leitura no PC drena a fila offline pro Hub com remapeamento automático de IDs!
    online["up"] = True
    pc["hub_client"]._offline_until = 0.0
    dividas_alice_sync = pc["client"].get("/dividas/", headers=hdr_a_pc).json()
    assert pc["hub_client"]._load_outbox() == []
    assert len(dividas_alice_sync) == 1
    assert dividas_alice_sync[0]["nome"] == "Carro Alice Offline"
    assert dividas_alice_sync[0]["parcelas_pagas"] == 1

    # Isolamento estrito: Alice jamais vê a dívida de Bruno e vice-versa
    r_login_alice_hub = hub["client"].post(
        "/auth/login", json={"usuario": "alice_div", "senha": "SenhaForte123"}
    )
    hdr_a_hub = {"Authorization": f"Bearer {r_login_alice_hub.json()['access_token']}"}
    div_a_hub = hub["client"].get("/dividas/", headers=hdr_a_hub).json()
    div_b_hub = hub["client"].get("/dividas/", headers=hdr_b_hub).json()
    assert [d["nome"] for d in div_a_hub] == ["Carro Alice Offline"]
    assert [d["nome"] for d in div_b_hub] == ["Financiamento Apartamento Bruno"]
    assert hub["client"].get("/contas/", headers=hdr_a_hub).json()[0]["saldo_atual"] == 3800.0
    # Tentativa de Bruno deletar ou pagar dívida de Alice -> 404
    assert hub["client"].delete(f"/dividas/{div_a_hub[0]['id']}", headers=hdr_b_hub).status_code == 404

    # Backup ZIP isolado de Alice contém somente os registros dela (zero vazamento de Bruno)
    zip_resp = hub["client"].get("/cloud/backup-zip", headers=hdr_a_hub)
    assert zip_resp.status_code == 200
    with zipfile.ZipFile(io.BytesIO(zip_resp.content)) as zf:
        mf = json.loads(zf.read("manifest.json").decode("utf-8"))
        assert mf["counts"]["dividas"] == 1
        assert mf["counts"]["divida_parcelas"] == 12
        db_extract = tmp_path / "alice_only.db"
        db_extract.write_bytes(zf.read("financeiro.db"))
        conn = sqlite3.connect(str(db_extract))
        try:
            nomes = [r[0] for r in conn.execute("SELECT nome FROM dividas").fetchall()]
            assert nomes == ["Carro Alice Offline"]
        finally:
            conn.close()

    # Cofre Criptografado 24/7 + Merge de usuário criado antes da hidratação
    hyd = hub["client"].post(
        "/cloud/vault/hydrate",
        json={
            "hydrate_secret": secret,
            "github_token": "ghp_fake",
            "repo": "thiago/vault-priv",
            "aes_key": aes_hex,
        },
    )
    assert hyd.status_code == 200, hyd.text
    hub["cloud_mgr"].sync_now(force=True, reason="test_dividas_vault")

    # Novo container efêmero cria usuário Carla com dívida antes da hidratação e depois hidrata do cofre
    cold_render = _make_isolated_node(
        tmp_path, "cold_render", desktop_mode=False, vault_http=vault_api.transport, hydrate_secret=secret
    )
    hdr_c = _register_and_headers(cold_render["client"], "Carla", "carla_div")
    cold_render["client"].post(
        "/dividas/",
        headers=hdr_c,
        json={
            "nome": "Condomínio Carla",
            "tipo_compromisso": "fixa",
            "valor_parcela": 700.0,
            "dia_vencimento": 15,
            "mes_inicio": 11,
            "ano_inicio": 2026,
        },
    )
    hyd2 = cold_render["client"].post(
        "/cloud/vault/hydrate",
        json={
            "hydrate_secret": secret,
            "github_token": "ghp_fake",
            "repo": "thiago/vault-priv",
            "aes_key": aes_hex,
        },
    )
    assert hyd2.status_code == 200, hyd2.text
    # Carla, Alice e Bruno coexistem com suas respectivas dívidas intactas!
    tok_c = cold_render["client"].post("/auth/login", json={"usuario": "carla_div", "senha": "SenhaForte123"}).json()["access_token"]
    tok_a = cold_render["client"].post("/auth/login", json={"usuario": "alice_div", "senha": "SenhaForte123"}).json()["access_token"]
    assert [d["nome"] for d in cold_render["client"].get("/dividas/", headers={"Authorization": f"Bearer {tok_c}"}).json()] == ["Condomínio Carla"]
    assert [d["nome"] for d in cold_render["client"].get("/dividas/", headers={"Authorization": f"Bearer {tok_a}"}).json()] == ["Carro Alice Offline"]


def test_casos_de_borda_validacao_cross_tenant_e_colisao_pk_offline_dividas(tmp_path: Path):
    hub = _make_isolated_node(tmp_path, "hub_edge", desktop_mode=False)
    online = {"up": True}

    def hub_transport(method: str, url: str, headers=None, data=None, timeout=12.0):
        if not online["up"]:
            raise OSError("Offline")
        parts = urlsplit(url)
        pq = f"{parts.path}?{parts.query}" if parts.query else parts.path
        resp = hub["client"].request(method, pq, headers=headers or {}, content=data)
        return resp.status_code, dict(resp.headers), resp.content

    pc = _make_isolated_node(tmp_path, "pc_edge", desktop_mode=True, hub_transport=hub_transport)

    # 1. Validações de entrada inválida (nome em branco, dia inválido, pagas_anteriores > total, conta de outro usuário)
    hdr_u1 = _register_and_headers(hub["client"], "User1", "u1_edge")
    hdr_u2 = _register_and_headers(hub["client"], "User2", "u2_edge")

    conta_u2 = hub["client"].post(
        "/contas/", headers=hdr_u2, json={"nome": "Conta U2", "banco": "BB", "saldo_inicial": 1000.0}
    ).json()

    assert hub["client"].post(
        "/dividas/",
        headers=hdr_u1,
        json={"nome": "   ", "tipo_compromisso": "parcelada", "valor_parcela": 100, "total_parcelas": 5},
    ).status_code == 400
    assert hub["client"].post(
        "/dividas/",
        headers=hdr_u1,
        json={"nome": "Invalida", "tipo_compromisso": "parcelada", "valor_parcela": 100, "dia_vencimento": 32, "total_parcelas": 5},
    ).status_code == 422
    assert hub["client"].post(
        "/dividas/",
        headers=hdr_u1,
        json={"nome": "Invalida", "tipo_compromisso": "parcelada", "valor_parcela": 100, "total_parcelas": 5, "parcelas_pagas_anteriores": 6},
    ).status_code == 400
    # Cross-tenant conta_padrao_id bloqueada
    assert hub["client"].post(
        "/dividas/",
        headers=hdr_u1,
        json={"nome": "Cross", "tipo_compromisso": "fixa", "valor_parcela": 100, "conta_padrao_id": conta_u2["id"]},
    ).status_code == 400

    # Simulador em carteira vazia nunca falha por divisão por zero
    sim_vazio = hub["client"].post(
        "/dividas/simular", headers=hdr_u1, json={"aporte_unico": 500, "aporte_mensal_extra": 200}
    )
    assert sim_vazio.status_code == 200
    assert sim_vazio.json()["possui_dividas_parceladas"] is False

    # 2. Colisão de PK offline em PC compartilhado:
    # U2 cria Dívida #1 no Hub; enquanto isso, no PC offline, U3 cria Conta #1 + Dívida #1 + Paga Parcela 1.
    # Depois o PC volta online, U2 faz login no PC (realocando PK #1 local de U3 para >=900000 e reescrevendo outbox de U3),
    # e em seguida U3 sincroniza sua fila offline sem perder nada nem cruzar dados!
    hub["client"].post(
        "/dividas/",
        headers=hdr_u2,
        json={"nome": "Divida Canonica U2 ID1", "tipo_compromisso": "parcelada", "valor_parcela": 900.0, "total_parcelas": 4, "mes_inicio": 11, "ano_inicio": 2026},
    )

    online["up"] = False
    hdr_u3_pc = _register_and_headers(pc["client"], "User3 Offline", "u3_off")
    c_u3 = pc["client"].post(
        "/contas/", headers=hdr_u3_pc, json={"nome": "Conta U3 Off", "banco": "Inter", "saldo_inicial": 3000.0}
    ).json()
    d_u3 = pc["client"].post(
        "/dividas/",
        headers=hdr_u3_pc,
        json={
            "nome": "Moto U3 Colisao PK",
            "tipo_compromisso": "parcelada",
            "valor_parcela": 500.0,
            "dia_vencimento": 25,
            "total_parcelas": 6,
            "mes_inicio": 11,
            "ano_inicio": 2026,
            "conta_padrao_id": c_u3["id"],
        },
    ).json()
    assert pc["client"].post(
        f"/dividas/{d_u3['id']}/pagar",
        headers=hdr_u3_pc,
        json={"numero": 1, "mes": 11, "ano": 2026, "valor_pago": 500.0, "conta_id": c_u3["id"]},
    ).status_code == 200

    # Reconecta e U2 faz login no PC -> dispara _vacate_conflicting_pk nas tabelas contas_bancarias, dividas e divida_parcelas!
    online["up"] = True
    pc["hub_client"]._offline_until = 0.0
    r_log_u2 = pc["client"].post("/auth/login", json={"usuario": "u2_edge", "senha": "SenhaForte123"})
    assert r_log_u2.status_code == 200

    # Agora U3 faz login/sincroniza -> replay do outbox reescrito converge 100% no Hub!
    r_log_u3 = pc["client"].post("/auth/login", json={"usuario": "u3_off", "senha": "SenhaForte123"})
    assert r_log_u3.status_code == 200
    hdr_u3_synced = {"Authorization": f"Bearer {r_log_u3.json()['access_token']}"}
    divs_u3 = pc["client"].get("/dividas/", headers=hdr_u3_synced).json()
    assert [d["nome"] for d in divs_u3] == ["Moto U3 Colisao PK"]
    assert divs_u3[0]["parcelas_pagas"] == 1
    assert pc["client"].get("/contas/", headers=hdr_u3_synced).json()[0]["saldo_atual"] == 2500.0


def test_auditoria_adversarial_simulador_previsao_termino_parcela_id_offline_e_centavos(tmp_path: Path):
    hub = _make_isolated_node(tmp_path, "hub_adv", desktop_mode=False)
    online = {"up": True}

    def hub_transport(method: str, url: str, headers=None, data=None, timeout=12.0):
        if not online["up"]:
            raise OSError("Offline")
        parts = urlsplit(url)
        pq = f"{parts.path}?{parts.query}" if parts.query else parts.path
        resp = hub["client"].request(method, pq, headers=headers or {}, content=data)
        return resp.status_code, dict(resp.headers), resp.content

    pc = _make_isolated_node(tmp_path, "pc_adv", desktop_mode=True, hub_transport=hub_transport)

    # 1. Cria dados prévios no Hub de outro usuário para forçar IDs diferentes entre PC offline e Hub
    hdr_other = _register_and_headers(hub["client"], "Outro", "outro_adv")
    hub["client"].post(
        "/dividas/",
        headers=hdr_other,
        json={
            "nome": "Divida Outro",
            "tipo_compromisso": "parcelada",
            "valor_parcela": 1000.0,
            "total_parcelas": 10,
            "mes_inicio": 11,
            "ano_inicio": 2026,
        },
    )

    # 2. Usuário principal registra no PC, desconecta, cria dívida offline, roda simulador (NÃO pode ir para outbox!),
    # e paga usando EXCLUSIVAMENTE `parcela_id` (sem enviar numero/mes/ano)
    hdr_pc = _register_and_headers(pc["client"], "Luiz Adv", "luiz_adv")
    online["up"] = False

    conta_off = pc["client"].post(
        "/contas/",
        headers=hdr_pc,
        json={"nome": "Caixa Adv", "banco": "Caixa", "saldo_inicial": 5000.0},
    ).json()

    div_off = pc["client"].post(
        "/dividas/",
        headers=hdr_pc,
        json={
            "nome": "Carro ParcelaID Puro",
            "tipo_compromisso": "parcelada",
            "valor_parcela": 500.0,
            "dia_vencimento": 20,
            "total_parcelas": 6,
            "mes_inicio": 11,
            "ano_inicio": 2026,
        },
    ).json()
    assert div_off["previsao_termino"] == "Abr/2027"
    local_pid_2 = next(p["parcela_id"] for p in div_off["parcelas"] if p["numero"] == 2)

    # Simular offline deve funcionar localmente sem poluir offline_outbox.json
    outbox_antes_sim = len(pc["hub_client"]._load_outbox())
    r_sim_off = pc["client"].post(
        "/dividas/simular",
        headers=hdr_pc,
        json={"aporte_unico": 500.0, "aporte_mensal_extra": 100.0, "estrategia": "bola_de_neve"},
    )
    assert r_sim_off.status_code == 200
    assert len(pc["hub_client"]._load_outbox()) == outbox_antes_sim

    # Paga parcela #2 enviando SOMENTE parcela_id (testa remapeamento de local_parcelas -> Hub)
    r_pag_pid = pc["client"].post(
        f"/dividas/{div_off['id']}/pagar",
        headers=hdr_pc,
        json={"parcela_id": local_pid_2, "valor_pago": 500.0, "conta_id": conta_off["id"]},
    )
    assert r_pag_pid.status_code == 200

    # Força colisão de PK local (outro_adv loga no PC quando online) antes de luiz_adv drenar outbox
    online["up"] = True
    pc["hub_client"]._offline_until = 0.0
    assert pc["client"].post("/auth/login", json={"usuario": "outro_adv", "senha": "SenhaForte123"}).status_code == 200

    # Agora luiz_adv sincroniza -> parcela #2 deve estar paga no Hub com saldo exato R$ 4.500,00!
    r_login_adv = pc["client"].post("/auth/login", json={"usuario": "luiz_adv", "senha": "SenhaForte123"})
    assert r_login_adv.status_code == 200
    hdr_pc_sync = {"Authorization": f"Bearer {r_login_adv.json()['access_token']}"}
    assert pc["hub_client"]._load_outbox() == []

    divs_sync = pc["client"].get("/dividas/", headers=hdr_pc_sync).json()
    assert len(divs_sync) == 1
    d_sync = divs_sync[0]
    p2_sync = next(p for p in d_sync["parcelas"] if p["numero"] == 2)
    assert p2_sync["status"] == "pago"
    assert pc["client"].get("/contas/", headers=hdr_pc_sync).json()[0]["saldo_atual"] == 4500.0

    # 3. Antecipação com valor fechado de centavos ímpares (3 parcelas finais por R$ 1.000,00 -> 333.33 + 333.33 + 333.34)
    # e verificação de encurtamento imediato de `previsao_termino`!
    conta_sync_id = pc["client"].get("/contas/", headers=hdr_pc_sync).json()[0]["id"]
    r_ant_odd = pc["client"].post(
        f"/dividas/{d_sync['id']}/antecipar",
        headers=hdr_pc_sync,
        json={
            "quantidade_parcelas": 3,
            "ordem": "ultimas",
            "valor_total_pago": 1000.0,
            "conta_id": conta_sync_id,
        },
    )
    assert r_ant_odd.status_code == 200, r_ant_odd.text
    assert r_ant_odd.json()["valor_total_pago"] == 1000.0
    assert pc["client"].get("/contas/", headers=hdr_pc_sync).json()[0]["saldo_atual"] == 3500.0

    d_after_ant = pc["client"].get("/dividas/", headers=hdr_pc_sync).json()[0]
    # Eram 6 parcelas (Nov/2026..Abr/2027); pagou #2 e antecipou #4, #5, #6 -> última pendente agora é #3 (Jan/2027)!
    assert d_after_ant["previsao_termino"] == "Jan/2027"

    # 4. Conta fixa com observação customizada preserva a observação após pagar e estornar
    cond_fixa = pc["client"].post(
        "/dividas/",
        headers=hdr_pc_sync,
        json={
            "nome": "Condomínio Notas",
            "tipo_compromisso": "fixa",
            "valor_parcela": 800.0,
            "dia_vencimento": 15,
            "mes_inicio": 11,
            "ano_inicio": 2026,
        },
    ).json()
    assert pc["client"].put(
        f"/dividas/{cond_fixa['id']}/ajuste-mes",
        headers=hdr_pc_sync,
        json={"mes": 11, "ano": 2026, "novo_valor": 800.0, "observacao": "Boleto administradora nova"},
    ).status_code == 200
    assert pc["client"].post(
        f"/dividas/{cond_fixa['id']}/pagar",
        headers=hdr_pc_sync,
        json={"mes": 11, "ano": 2026, "valor_pago": 800.0, "conta_id": conta_sync_id},
    ).status_code == 200
    assert pc["client"].post(
        f"/dividas/{cond_fixa['id']}/estornar",
        headers=hdr_pc_sync,
        json={"mes": 11, "ano": 2026},
    ).status_code == 200
    painel_nov = pc["client"].get("/dividas/painel?mes=11&ano=2026", headers=hdr_pc_sync).json()
    oc_cond = next(x for x in painel_nov["agenda_mes"] if x["divida_id"] == cond_fixa["id"])
    assert oc_cond["status"] == "pendente"
    assert oc_cond["observacao"] == "Boleto administradora nova"
    assert pc["client"].get("/contas/", headers=hdr_pc_sync).json()[0]["saldo_atual"] == 3500.0

    # 5. Simulador sem folga fantasma quando uma dívida já pagou a parcela do mês atual
    from sqlalchemy.orm import sessionmaker

    with sessionmaker(bind=hub["engine"])() as db_s:
        u_tmp = models.Usuario(nome="SimTest", email="sim_pure", senha_hash="x")
        db_s.add(u_tmp)
        db_s.flush()
        # Dívida A: 4x de 1000 começando em Nov/2026 (pendentes: Nov, Dez, Jan, Fev)
        da = models.Divida(
            usuario_id=u_tmp.id,
            nome="Dívida A",
            tipo_compromisso="parcelada",
            valor_parcela=1000.0,
            dia_vencimento=20,
            total_parcelas=4,
            mes_inicio=11,
            ano_inicio=2026,
            ativa=True,
        )
        # Dívida B: 2x de 500 onde Nov/2026 JÁ FOI PAGA e Dez/2026 ainda está pendente!
        db_obj = models.Divida(
            usuario_id=u_tmp.id,
            nome="Dívida B",
            tipo_compromisso="parcelada",
            valor_parcela=500.0,
            dia_vencimento=10,
            total_parcelas=2,
            parcelas_pagas_anteriores=1,
            mes_inicio=12,
            ano_inicio=2026,
            ativa=True,
        )
        db_s.add_all([da, db_obj])
        db_s.flush()
        from services.dividas_service import gerar_parcelas_iniciais_divida

        for p in gerar_parcelas_iniciais_divida(da) + gerar_parcelas_iniciais_divida(db_obj):
            db_s.add(p)
        db_s.commit()
        db_s.refresh(da)
        db_s.refresh(db_obj)

        # Em Nov/2026, Dívida B já pagou Nov/2026 (não está quitada: falta Dez/2026).
        # Sem aporte extra (aporte_unico=0, aporte_mensal_extra=0), em Nov e Dez não há folga cascata;
        # somente em Jan/2027 (após Dívida B quitar em Dez/2026) os R$ 500 liberados abatem metade de Fev/2027!
        res_sim = simular_plano_quitacao(
            [da, db_obj],
            ref_date=date(2026, 11, 16),
            aporte_unico=0.0,
            aporte_mensal_extra=0.0,
            estrategia="bola_de_neve",
            reinvestir_alivio=True,
        )
        assert res_sim["custo_total_acelerado"] == 4500.0
        # Fev/2027 ainda precisa de R$ 500 restantes em Fev/2027, logo termina em Fev/2027 (4 meses, não 3!)
        assert res_sim["data_quitacao_acelerada"] == "Fev/2027"


