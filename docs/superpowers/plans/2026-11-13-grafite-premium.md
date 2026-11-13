# Grafite Premium Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplicar a identidade Grafite Premium em todo o painel financeiro.

**Architecture:** A paleta será centralizada nos tokens CSS já consumidos pelo layout e complementada pela escala `blue` do Tailwind. Cores locais do Dashboard serão alinhadas aos novos tons sem alterar a estrutura das telas.

**Tech Stack:** React 18, Vite 5, Tailwind CSS 3, CSS custom properties, Node test runner.

**Spec:** `docs/superpowers/specs/grafite-premium.md`

## Global Constraints

- Preservar a fotografia realista existente.
- Não alterar fluxos, dados ou funcionalidades.
- Manter contraste legível nos modos claro e escuro.
- Preservar cores oficiais dos cartões bancários.

## Review Focus

- Resíduos da antiga paleta verde nos tokens estruturais.
- Texto e botões com contraste insuficiente no modo escuro.
- Foto de fundo competindo com conteúdo.
- Classes azuis antigas divergindo do azul cobalto escolhido.
- Impressão herdando cores escuras.

---

### Task 1: Tokens e superfícies Grafite Premium

**Files:**
- Modify: `frontend/src/index.css`
- Modify: `frontend/tailwind.config.js`
- Test: `frontend/tests/themePalette.test.js`

**Interfaces:**
- Consumes: atributos `data-theme` e classes Tailwind existentes.
- Produces: tokens CSS Grafite Premium e escala azul cobalto.

- [ ] **Step 1: Escrever o teste que exige os tokens claros, escuros e a escala cobalto**
- [ ] **Step 2: Executar o teste e confirmar falha nos valores antigos**
- [ ] **Step 3: Atualizar tokens, menu, foto, botões, badges e impressão**
- [ ] **Step 4: Executar o teste e confirmar aprovação**

### Task 2: Acentos do Dashboard

**Files:**
- Modify: `frontend/src/pages/Dashboard.jsx`
- Test: `frontend/tests/themePalette.test.js`

**Interfaces:**
- Consumes: tokens produzidos pela Task 1.
- Produces: cartões de métrica coerentes com a nova paleta.

- [ ] **Step 1: Ampliar o teste para rejeitar acentos estruturais verdes antigos**
- [ ] **Step 2: Executar e confirmar falha**
- [ ] **Step 3: Aplicar azul, ciano, índigo e âmbar controlado nas métricas**
- [ ] **Step 4: Executar testes, build e inspeção visual em claro e escuro**

