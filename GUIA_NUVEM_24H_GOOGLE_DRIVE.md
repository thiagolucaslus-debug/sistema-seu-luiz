# Guia Rápido — Nuvem 24/7 + Backup Automático no Google Drive (R$ 0,00)

O **Sistema Financeiro Seu Luiz** (`https://sistema-seu-luiz.onrender.com`) conta com blindagem completa gratuita em duas camadas:

1. **Anti-Sono 24/7 Automático (`.github/workflows/keep_alive_24h.yml`)**
   - O GitHub Actions envia um pulso automático a cada **10 minutos** (24 horas por dia, 7 dias por semana) para `https://sistema-seu-luiz.onrender.com/health`.
   - Assim o servidor gratuito do Render nunca adormece por inatividade e permanece dentro das **750 horas mensais gratuitas** (um mês tem no máximo 744 horas).

2. **Salvamento e Restauração Automática no Google Drive (`Sistema Seu Luiz - Backup Automático`)**
   - A cada lançamento, aprovação, pagamento, cadastro ou envio de foto/comprovante, o sistema gera uma cópia íntegra do banco SQLite (`sqlite3.backup`) e envia junto com os arquivos de `uploads/` para a pasta privada **`Sistema Seu Luiz - Backup Automático`** no seu Google Drive.
   - Sempre que o container do Render reiniciar ou atualizar, o servidor restaura automaticamente o banco e os comprovantes direto do seu Google Drive antes de abrir o sistema — **zero perda de dados**.

---

## Como ativar o Google Drive em 1 minuto (Uma Única Vez)

1. No computador, dê dois cliques em **`CONFIGURAR_NUVEM_24H.bat`** (ou abra **Configurações → Nuvem 24/7 & Google Drive** no sistema local).
2. Escolha a opção **`[1] Conectar meu Google Drive em 1 Clique + Fazer Backup Inicial`**.
3. Faça login na sua conta Google na aba que abrir e clique em **Continuar / Permitir**.
4. O assistente fará o backup inicial imediatamente e já copiará o código `GOOGLE_DRIVE_OAUTH_JSON` (`GDRIVE1:...`) para o seu `Ctrl+V`.
5. Para deixar permanente no Render mesmo após futuras atualizações:
   - Abra [dashboard.render.com](https://dashboard.render.com) → clique no serviço **`sistema-seu-luiz`** → menu **`Environment`**.
   - Clique em **Add Environment Variable**:
     - **Key**: `GOOGLE_DRIVE_OAUTH_JSON`
     - **Value**: aperte `Ctrl+V` (código `GDRIVE1:...`) e clique em **Save Changes**.
