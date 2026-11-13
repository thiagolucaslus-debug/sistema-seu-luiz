import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

import auth
from routers import whatsapp


class WhatsAppModuleTest(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(whatsapp.router)
        app.dependency_overrides[auth.get_usuario_atual] = lambda: object()
        self.client = self.enterContext(TestClient(app))

    def test_lista_conversas_e_codifica_id_ao_buscar_mensagens(self):
        with patch('routers.whatsapp.chamar_servico', return_value={'chats': []}) as service:
            response = self.client.get('/whatsapp/chats?limit=25')
            self.assertEqual(response.status_code, 200)
            service.assert_called_once_with('/chats?limit=25')

        with patch('routers.whatsapp.chamar_servico', return_value={'messages': []}) as service:
            response = self.client.get('/whatsapp/chats/5511999999999%40c.us/messages?limit=40')
            self.assertEqual(response.status_code, 200)
            service.assert_called_once_with('/chats/5511999999999%40c.us/messages?limit=40')

    def test_encaminha_texto_e_arquivo_para_o_servico_local(self):
        with patch('routers.whatsapp.chamar_servico', return_value={'success': True}) as service:
            body = {'chat_id': '5511999999999@c.us', 'mensagem': 'Olá'}
            self.assertEqual(self.client.post('/whatsapp/messages', json=body).status_code, 200)
            service.assert_called_once_with('/messages', post=True, data=body)

        with patch('routers.whatsapp.chamar_servico', return_value={'success': True}) as service:
            body = {'chat_id': '5511999999999@c.us', 'data': 'SGVsbG8=', 'mimetype': 'text/plain', 'filename': 'oi.txt'}
            self.assertEqual(self.client.post('/whatsapp/messages/media', json=body).status_code, 200)
            service.assert_called_once_with('/messages/media', post=True, data={**body, 'telefone': None, 'caption': None})


if __name__ == '__main__':
    unittest.main()
