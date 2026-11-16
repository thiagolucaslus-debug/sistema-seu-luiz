export function formatBRL(val) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number(val) || 0);
}

export function clampDueDateISO(ano, mes, diaVencimento) {
  const y = Number(ano);
  const m = Math.max(1, Math.min(12, Number(mes)));
  const d = Math.max(1, Math.min(31, Number(diaVencimento)));
  const ultimoDiaMes = new Date(y, m, 0).getDate();
  const diaFinal = Math.min(d, ultimoDiaMes);
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(diaFinal).padStart(2, '0')}`;
}

export function describeSituacaoVencimento(situacao) {
  switch (situacao) {
    case 'atrasada':
      return {
        label: 'Atrasada',
        badgeClass: 'badge-red',
        accent: '#e11d48',
      };
    case 'vencendo_hoje':
      return {
        label: 'Vence Hoje',
        badgeClass: 'badge-yellow',
        accent: '#d97706',
      };
    case 'proxima':
      return {
        label: 'Próximo Vencimento',
        badgeClass: 'badge-blue',
        accent: '#2563eb',
      };
    case 'pago':
      return {
        label: 'Quitada',
        badgeClass: 'badge-green',
        accent: '#059669',
      };
    default:
      return {
        label: 'Agendada',
        badgeClass: 'badge-blue',
        accent: '#64748b',
      };
  }
}

export function formatCountdownVencimento(vencimentoISO, hojeISO, status = 'pendente') {
  if (!vencimentoISO) return '';
  const [, mesStr, diaStr] = String(vencimentoISO).split('-');
  const diaFmt = String(diaStr || '').padStart(2, '0');
  if (status === 'pago') {
    return `Quitada — Dia ${diaFmt}`;
  }
  const dtVenc = new Date(`${vencimentoISO}T00:00:00`);
  const dtHoje = hojeISO ? new Date(`${hojeISO}T00:00:00`) : new Date();
  dtHoje.setHours(0, 0, 0, 0);
  const diffDays = Math.round((dtVenc.getTime() - dtHoje.getTime()) / 86400000);

  if (diffDays < 0) {
    const atraso = Math.abs(diffDays);
    return `Atrasada há ${atraso} ${atraso === 1 ? 'dia' : 'dias'} — Dia ${diaFmt}`;
  }
  if (diffDays === 0) {
    return `Vence hoje — Dia ${diaFmt}`;
  }
  if (diffDays === 1) {
    return `Amanhã — Dia ${diaFmt}`;
  }
  if (diffDays <= 15) {
    return `Faltam ${diffDays} dias — Dia ${diaFmt}`;
  }
  return `Dia ${diaFmt}/${String(mesStr || '').padStart(2, '0')} (em ${diffDays} dias)`;
}
