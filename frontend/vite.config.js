import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    allowedHosts: true,
    proxy: {
      '/auth': 'http://127.0.0.1:8000',
      '/contas': 'http://127.0.0.1:8000',
      '/cartoes': 'http://127.0.0.1:8000',
      '/pessoas': 'http://127.0.0.1:8000',
      '/lancamentos': 'http://127.0.0.1:8000',
      '/modulos': 'http://127.0.0.1:8000',
      '/relatorios': 'http://127.0.0.1:8000',
      '/whatsapp': 'http://127.0.0.1:8000',
      '/public': 'http://127.0.0.1:8000',
      '/solicitacoes': 'http://127.0.0.1:8000',
      '/uploads': 'http://127.0.0.1:8000',
      '/pdfs': 'http://127.0.0.1:8000',
      '/health': 'http://127.0.0.1:8000',
    }
  }
});
