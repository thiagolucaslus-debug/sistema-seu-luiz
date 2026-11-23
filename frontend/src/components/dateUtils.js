const MESES_CURTOS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

export function todayLocalISO(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function predictInvoiceMonth(dataISO, diaFechamento) {
  if (!dataISO || !/^\d{4}-\d{2}-\d{2}$/.test(dataISO)) return null;
  const [anoStr, mesStr, diaStr] = dataISO.split('-');
  let ano = Number(anoStr);
  let mes = Number(mesStr);
  const dia = Number(diaStr);
  if (!ano || !mes || !dia) return null;

  const fechamento = Number(diaFechamento);
  if (Number.isFinite(fechamento) && fechamento > 0 && dia > fechamento) {
    mes += 1;
    if (mes > 12) {
      mes = 1;
      ano += 1;
    }
  }
  return {
    mes,
    ano,
    label: `${MESES_CURTOS[mes - 1]}/${ano}`,
    codigo: `${String(mes).padStart(2, '0')}/${ano}`,
  };
}
