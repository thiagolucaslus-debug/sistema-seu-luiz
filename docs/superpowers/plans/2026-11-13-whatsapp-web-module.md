# WhatsApp Web Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar a integração atual em um módulo completo de conversas dentro do painel.

**Architecture:** O serviço Node que mantém a sessão do WhatsApp expõe operações locais de leitura e envio. O FastAPI autentica e encaminha essas operações. A tela React consome apenas o FastAPI, faz atualização periódica e renderiza uma interface responsiva.

**Tech Stack:** whatsapp-web.js, Express, FastAPI, React 18, Axios, Node test runner, pytest.

**Spec:** `docs/superpowers/specs/whatsapp-web-module.md`

## Global Constraints

- Reutilizar a sessão LocalAuth já salva.
- Não expor o serviço Node diretamente ao navegador.
- Limitar anexos a 12 MB.
- Não enviar mensagens reais durante a verificação.
- Preservar envio de PDFs já existente.

## Review Focus

- IDs de chat e mensagem contendo caracteres especiais.
- Sessão desconectada ou serviço indisponível.
- Conversas sem foto, nome, última mensagem ou horário.
- Arquivos maiores que 12 MB e tipos não visuais.
- Atualização periódica duplicando mensagens ou perdendo a conversa selecionada.

---

### Task 1: API de conversas no serviço WhatsApp

**Files:**
- Create: `whatsapp-service/chat-utils.js`
- Create: `whatsapp-service/tests/chat-utils.test.js`
- Modify: `whatsapp-service/sender.js`
- Modify: `whatsapp-service/package.json`

**Interfaces:**
- Produces: `GET /chats`, `GET /chats/:id/messages`, `GET /messages/:id/media`, `POST /messages`, `POST /messages/media`.

- [ ] Escrever testes dos serializadores e normalização.
- [ ] Confirmar falha por módulo inexistente.
- [ ] Implementar utilitários e rotas preservando `/send-pdf`.
- [ ] Confirmar aprovação dos testes Node.

### Task 2: Proxy autenticado FastAPI

**Files:**
- Modify: `backend/routers/whatsapp.py`
- Create: `backend/test_whatsapp_module.py`

**Interfaces:**
- Consumes: endpoints da Task 1.
- Produces: endpoints autenticados equivalentes sob `/whatsapp`.

- [ ] Escrever testes dos caminhos codificados e corpos.
- [ ] Confirmar falha por funções inexistentes.
- [ ] Implementar modelos e rotas proxy.
- [ ] Confirmar aprovação do pytest.

### Task 3: Tela completa no painel

**Files:**
- Create: `frontend/src/pages/WhatsApp.jsx`
- Create: `frontend/src/components/whatsappFormat.js`
- Create: `frontend/tests/whatsappModule.test.js`
- Modify: `frontend/src/api/client.js`
- Modify: `frontend/src/components/Layout.jsx`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/index.css`

**Interfaces:**
- Consumes: proxy da Task 2.
- Produces: rota `/whatsapp`, item de menu e interface completa.

- [ ] Escrever testes de formatação, rota, menu e cliente.
- [ ] Confirmar falha pela ausência do módulo.
- [ ] Implementar tela responsiva e atualização periódica.
- [ ] Executar testes, build e inspeção visual sem enviar mensagens.

