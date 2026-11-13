import unittest
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from database import Base, get_db
from routers.auth import router
from routers import cartoes, lancamentos, modulos, pessoas, relatorios, whatsapp


class ConfiguracoesTest(unittest.TestCase):
    def setUp(self):
        engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
        self.addCleanup(engine.dispose)
        Base.metadata.create_all(engine)
        session = sessionmaker(bind=engine)

        def banco_teste():
            with session() as db:
                yield db

        app = FastAPI()
        app.include_router(router)
        for modulo in (cartoes, lancamentos, modulos, pessoas, relatorios, whatsapp):
            app.include_router(modulo.router)
        app.dependency_overrides[get_db] = banco_teste
        self.client = self.enterContext(TestClient(app))
        setup = self.client.post("/auth/setup", json={
            "nome": "Teste", "usuario": "teste", "senha": "Inicial123"
        })
        self.headers = {"Authorization": f"Bearer {setup.json()['access_token']}"}

    def test_troca_senha_autenticada_revoga_sessao_e_aceita_novo_login(self):
        client, headers = self.client, self.headers
        senha = {"senha_atual": "Incorreta", "nova_senha": "Renovada123"}
        self.assertEqual(client.put("/auth/senha", json=senha).status_code, 401)
        self.assertEqual(client.put("/auth/senha", headers=headers, json=senha).status_code, 400)
        senha["senha_atual"] = "Inicial123"
        troca = client.put("/auth/senha", headers=headers, json=senha)
        self.assertEqual(troca.status_code, 200)
        self.assertEqual(client.get("/auth/me", headers=headers).status_code, 401)
        novos_headers = {"Authorization": f"Bearer {troca.json()['access_token']}"}
        self.assertEqual(client.get("/auth/me", headers=novos_headers).status_code, 200)
        login = {"usuario": "teste", "senha": "Inicial123"}
        self.assertEqual(client.post("/auth/login", json=login).status_code, 401)
        login["senha"] = "Renovada123"
        self.assertEqual(client.post("/auth/login", json=login).status_code, 200)

    def test_perfil_e_modulos_em_uma_instalacao_nova(self):
        client, headers = self.client, self.headers
        self.assertEqual(client.get("/modulos/", headers=headers).json(), [])
        self.assertEqual(client.post("/modulos/", headers=headers, json={"nome": "Projetos"}).status_code, 200)
        self.assertEqual(client.put("/auth/perfil", headers=headers, json={"nome": " Luiz "}).json()["nome"], "Luiz")
        self.assertEqual(client.get("/auth/me", headers=headers).json()["nome"], "Luiz")
        self.assertEqual(client.get("/whatsapp/status").status_code, 401)
        with TemporaryDirectory() as pasta, patch("routers.auth.UPLOADS_DIR", Path(pasta)):
            foto = BytesIO()
            Image.new("RGB", (720, 360), "#17765e").save(foto, format="PNG")
            resposta = client.post("/auth/perfil/foto", headers=headers, files={
                "file": ("foto.png", foto.getvalue(), "image/png"),
            })
            self.assertEqual(resposta.status_code, 200)
            caminho = resposta.json()["logo_path"]
            self.assertEqual(client.get("/auth/me", headers=headers).json()["logo_path"], caminho)
            with Image.open(Path(pasta) / Path(caminho).name) as salva:
                self.assertEqual(salva.size, (512, 256))
            self.assertIsNone(client.delete("/auth/perfil/foto", headers=headers).json()["logo_path"])

    def test_remover_cartao_mantem_lancamento_e_total_historico(self):
        client, headers = self.client, self.headers
        cartao = client.post("/cartoes/", headers=headers, json={"nome": "Itaú"}).json()
        compra = {
            "tipo": "compra_cartao", "descricao": "Compra", "valor_total": 300,
            "data_lancamento": "2026-11-05", "cartao_id": cartao["id"],
        }
        self.assertEqual(client.post("/lancamentos/", headers=headers, json=compra).status_code, 200)
        self.assertEqual(client.delete(f"/cartoes/{cartao['id']}", headers=headers).status_code, 200)
        self.assertEqual(client.get("/cartoes/", headers=headers).json(), [])
        self.assertEqual(client.get("/cartoes/?inativos=true", headers=headers).json()[0]["nome"], "Itaú")
        lista = client.get("/lancamentos/?mes=11&ano=2026", headers=headers).json()
        self.assertEqual(lista["items"][0]["cartao"]["nome"], "Itaú")
        resumo = client.get("/relatorios/dashboard?mes=11&ano=2026", headers=headers).json()
        self.assertEqual(resumo["total_gastos_mes"], 300)
        self.assertEqual(client.post("/lancamentos/", headers=headers, json=compra).status_code, 400)

    def test_pagamento_registra_forma_e_abate_sem_credito_bancario(self):
        client, headers = self.client, self.headers
        pessoa = client.post("/pessoas/", headers=headers, json={"nome": "Teste"}).json()
        endpoint = f"/pessoas/{pessoa['id']}"
        pagamento = {"valor": 25, "data": "2026-11-05", "forma": "abatimento", "conta_id": 999}
        self.assertEqual(client.post(endpoint + "/pagamento", headers=headers, json=pagamento).status_code, 200)
        pagamento.update(forma="outro", outra_forma="Vale", conta_id=None)
        self.assertEqual(client.post(endpoint + "/pagamento", headers=headers, json=pagamento).status_code, 200)
        extrato = client.get(endpoint + "/extrato", headers=headers).json()
        mes = next(item for item in extrato["historico"] if item["ano"] == 2026 and item["mes"] == 11)
        self.assertEqual(mes["total_pagamentos"], 50)
        self.assertEqual({p["forma_pagamento"] for p in mes["pagamentos"]}, {"Abatimento de dívida", "Vale"})
        self.assertTrue(all(p["conta"] is None for p in mes["pagamentos"]))


if __name__ == "__main__":
    unittest.main()
