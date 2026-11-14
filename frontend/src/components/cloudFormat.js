export function isLocalBrowserHost(hostname = '') {
  const clean = String(hostname || '').trim().toLowerCase();
  return clean === 'localhost' || clean === '127.0.0.1' || clean === '::1' || clean === '[::1]';
}

export function formatCloudTimestamp(unixSeconds) {
  const num = Number(unixSeconds);
  if (!Number.isFinite(num) || num <= 0) {
    return 'Ainda não sincronizado';
  }
  const dt = new Date(num * 1000);
  if (Number.isNaN(dt.getTime())) {
    return 'Ainda não sincronizado';
  }
  return dt.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function describeCloudState(status = {}) {
  if (!status || status.checking) {
    return { badgeClass: 'badge-blue', label: 'Verificando nuvem…' };
  }
  if (status.restoring) {
    return { badgeClass: 'badge-blue', label: 'Restaurando do Google Drive…' };
  }
  if (status.syncing) {
    return { badgeClass: 'badge-blue', label: 'Salvando no Google Drive…' };
  }
  if (status.connected) {
    return { badgeClass: 'badge-green', label: 'Google Drive Conectado' };
  }
  return { badgeClass: 'badge-yellow', label: 'Google Drive Desconectado' };
}
