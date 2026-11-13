import axios from 'axios';

// Com o proxy configurado no Vite, chamadas relativas funcionam localmente e via túnel HTTPS
const API_URL = '';
export const mediaUrl = (path) => {
  if (!path) return '';
  if (path.startsWith('http')) {
    try {
      const url = new URL(path);
      if (url.port === '8000') return url.pathname;
    } catch (e) {}
    return path;
  }
  return path.startsWith('/') ? path : `/${path}`;
};

const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' }
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const token = localStorage.getItem('token');
    const sentToken = error.config?.headers?.Authorization;
    if (error.response?.status === 401 && token && sentToken === `Bearer ${token}` &&
        !window.location.pathname.includes('/login') &&
        !window.location.pathname.includes('/lancar/')) {
      localStorage.removeItem('token');
      localStorage.removeItem('usuario');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export const auth = {
  checkSetup: () => api.get('/auth/check-setup'),
  setup: (data) => api.post('/auth/setup', data),
  login: (data) => api.post('/auth/login', data),
  me: () => api.get('/auth/me'),
  trocarSenha: (data) => api.put('/auth/senha', data),
  atualizarPerfil: (data) => api.put('/auth/perfil', data),
  uploadFoto: (data) => api.post('/auth/perfil/foto', data, { headers: { 'Content-Type': 'multipart/form-data' } }),
  removerFoto: () => api.delete('/auth/perfil/foto'),
};

export const contas = {
  listar: () => api.get('/contas/'),
  criar: (data) => api.post('/contas/', data),
  atualizar: (id, data) => api.put(`/contas/${id}`, data),
  deletar: (id) => api.delete(`/contas/${id}`),
  extrato: (id, mes, ano) => api.get(`/contas/${id}/extrato`, { params: { mes, ano } }),
};

export const cartoes = {
  listar: (params) => api.get('/cartoes/', { params }),
  criar: (data) => api.post('/cartoes/', data),
  atualizar: (id, data) => api.put(`/cartoes/${id}`, data),
  deletar: (id) => api.delete(`/cartoes/${id}`),
  faturas: (id, meses_atras, meses_frente) => api.get(`/cartoes/${id}/faturas`, { params: { meses_atras, meses_frente } }),
  pagarFatura: (id, data) => api.post(`/cartoes/${id}/pagar-fatura`, data),
};

export const pessoas = {
  listar: () => api.get('/pessoas/'),
  criar: (data) => api.post('/pessoas/', data),
  atualizar: (id, data) => api.put(`/pessoas/${id}`, data),
  uploadFoto: (id, formData) => api.post(`/pessoas/${id}/foto`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  deletar: (id) => api.delete(`/pessoas/${id}`),
  extrato: (id) => api.get(`/pessoas/${id}/extrato`),
  registrarPagamento: (id, data) => api.post(`/pessoas/${id}/pagamento`, data),
  deletarPagamento: (pessoaId, pagId) => api.delete(`/pessoas/${pessoaId}/pagamento/${pagId}`),
  obterPdfPath: (id, mes, ano) => api.get(`/pessoas/${id}/pdf-path/${mes}/${ano}`),
  gerarPDFUrl: (id, mes, ano) => `/pessoas/${id}/pdf/${mes}/${ano}`,
};

export const lancamentos = {
  listar: (params) => api.get('/lancamentos/', { params }),
  criar: (data) => api.post('/lancamentos/', data),
  cancelar: (id) => api.delete(`/lancamentos/${id}`),
  alterarParcelaStatus: (id, num, status) => api.patch(`/lancamentos/${id}/parcela/${num}/status`, null, { params: { status } }),
};

export const modulos = {
  listar: (params) => api.get('/modulos/', { params }),
  criar: (data) => api.post('/modulos/', data),
  atualizar: (id, data) => api.put(`/modulos/${id}`, data),
  deletar: (id) => api.delete(`/modulos/${id}`),
  gastos: (id, mes, ano) => api.get(`/modulos/${id}/gastos`, { params: { mes, ano } }),
  criarSubcategoria: (data) => api.post('/modulos/subcategorias', data),
};

export const relatorios = {
  dashboard: (mes, ano) => api.get('/relatorios/dashboard', { params: { mes, ano } }),
  parcelasFuturas: (meses) => api.get('/relatorios/parcelas-futuras', { params: { meses } }),
  fechamentoMes: (mes, ano) => api.get('/relatorios/fechamento-mes', { params: { mes, ano } }),
};

export const solicitacoes = {
  obterDadosPublicos: (token) => api.get(`/public/lancar/${token}`),
  enviarPublico: (token, formData) => api.post(`/public/lancar/${token}`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  listar: (status) => api.get('/solicitacoes/', { params: { status } }),
  contarPendentes: () => api.get('/solicitacoes/pendentes/count'),
  aprovar: (id, data) => api.post(`/solicitacoes/${id}/aprovar`, data),
  rejeitar: (id, motivo) => api.post(`/solicitacoes/${id}/rejeitar`, null, { params: { motivo } }),
  gerarTokenPessoa: (pessoaId) => api.post(`/solicitacoes/gerar-token/${pessoaId}`),
  obterLinkPessoa: (pessoaId) => api.get(`/solicitacoes/link/${pessoaId}`),
};

// Integração com o serviço de WhatsApp automático
export const whatsapp = {
  getStatus: () => api.get('/whatsapp/status'),
  connect: () => api.post('/whatsapp/connect'),
  listarChats: (limit = 60) => api.get('/whatsapp/chats', { params: { limit } }),
  listarMensagens: (chatId, limit = 60) => api.get(`/whatsapp/chats/${encodeURIComponent(chatId)}/messages`, { params: { limit } }),
  enviarMensagem: (data) => api.post('/whatsapp/messages', data),
  enviarMidia: (data) => api.post('/whatsapp/messages/media', data),
  obterMidia: (messageId) => api.get(`/whatsapp/messages/${encodeURIComponent(messageId)}/media`),
  sendPdf: (data) => api.post('/whatsapp/send-pdf', data),
  disconnect: () => api.post('/whatsapp/disconnect'),
};

export default api;
