# Sistema Financeiro "Seu Luiz" 💼

Sistema completo de controle financeiro pessoal, faturas de cartões de crédito, divisão de despesas por pessoas (Thais, Luane, Alexandre...), empréstimos, módulos personalizados (Casa, Roça, Carro...) e geração/envio automático de extratos de fechamento em PDF pelo WhatsApp.

---

## 🚀 Como Iniciar

1. Basta dar **dois cliques** no arquivo **`iniciar.bat`**.
2. O sistema abrirá automaticamente o navegador em: **`http://localhost:5173`**.
3. Na primeira vez, crie seu login e senha mestre.
4. Para fechar tudo quando terminar, execute **`parar.bat`**.

---

## 📱 WhatsApp Automático

1. Abra **Configurações → WhatsApp Web** e clique em **Conectar por QR Code**.
2. No celular, abra **WhatsApp → Aparelhos conectados → Conectar um aparelho**.
3. Escaneie o código exibido no painel. A sessão vinculada fica salva neste computador.
4. Use o botão **WhatsApp** no fechamento de uma pessoa para enviar a mensagem e o PDF.

---

## 📦 Estrutura dos Módulos

- **Visão Geral (Dashboard):** Gráficos de evolução mensal, fatias de gastos por cartão/pessoa/módulo, previsão de parcelas futuras e alertas de quem deve quanto.
- **Lançamentos:** Registre compras de cartões (com cálculo de parcelas automáticas), saídas de contas bancárias, empréstimos dados a terceiros, receitas e transferências.
- **Cartões de Crédito:** Visualize as faturas mês a mês com histórico recolhido, detalhe de parcelas ("2 de 6") e botão de pagamento de fatura debitado da conta bancária.
- **Contas Bancárias:** Saldo real de cada conta ou carteira de dinheiro, com extrato completo de entradas e saídas.
- **Pessoas & Fechamentos:** Perfil individual de cada pessoa com controle de saldo devedor que transita de mês em mês, registro de pagamentos parciais ou totais, download de PDF elegante e envio pelo WhatsApp.
- **Módulos (Casa, Roça, Carro...):** Cadastre áreas da sua vida e visualize quanto foi investido em cada uma.
- **Relatórios & Planejamento:** Calendário completo de comprometimento financeiro dos próximos 6 a 24 meses.

---

## 🔒 Segurança e Dados Locais

- Banco de dados SQLite local localizado em: `backend/financeiro.db`.
- Para fazer backup dos seus dados, basta copiar o arquivo `backend/financeiro.db`.
