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

export function calcularEstimativaAntecipacao(
  selecionadas,
  {
    modoValor = 'percentual',
    valorFechado = '',
    descontoPct = '',
    taxaJurosMensal = 0,
    dataPagamentoISO = '',
  } = {}
) {
  const lista = Array.isArray(selecionadas) ? selecionadas : [];
  const somaNominal = Number(
    lista.reduce((acc, p) => acc + Number(p?.valor_atual || 0), 0).toFixed(2)
  );
  if (somaNominal <= 0) {
    return { somaNominal: 0, totalPagar: 0, economia: 0, usaCdcAutomatico: false };
  }

  if (modoValor === 'valor_fechado') {
    const vf = parseFloat(valorFechado);
    const pago = Number((Number.isFinite(vf) && vf > 0 ? vf : somaNominal).toFixed(2));
    return {
      somaNominal,
      totalPagar: pago,
      economia: Number(Math.max(0, somaNominal - pago).toFixed(2)),
      usaCdcAutomatico: false,
    };
  }

  const pctTrim = String(descontoPct ?? '').trim();
  if (pctTrim !== '') {
    const pct = Math.min(95, Math.max(0, parseFloat(pctTrim) || 0));
    if (pct > 0) {
      let somaPago = 0;
      for (const p of lista) {
        const val = Number(Number(p?.valor_atual || 0).toFixed(2));
        const desc = Number((val * (pct / 100)).toFixed(2));
        const vp = Number(Math.max(0.01, val - desc).toFixed(2));
        somaPago = Number((somaPago + vp).toFixed(2));
      }
      return {
        somaNominal,
        totalPagar: somaPago,
        economia: Number(Math.max(0, somaNominal - somaPago).toFixed(2)),
        usaCdcAutomatico: false,
      };
    }
    return { somaNominal, totalPagar: somaNominal, economia: 0, usaCdcAutomatico: false };
  }

  const juros = Math.min(50, Math.max(0, Number(taxaJurosMensal) || 0));
  if (juros > 0) {
    const partes = String(dataPagamentoISO || '').split('-');
    const refAno = Number(partes[0]) || new Date().getFullYear();
    const refMes = Number(partes[1]) || new Date().getMonth() + 1;
    const taxa = juros / 100;
    let somaVp = 0;
    for (const p of lista) {
      const val = Number(Number(p?.valor_atual || 0).toFixed(2));
      const mf = Math.max(
        0,
        Number(p.ano) * 12 + (Number(p.mes) - 1) - (refAno * 12 + (refMes - 1))
      );
      if (mf > 0) {
        const vp = Number((val / Math.pow(1 + taxa, mf)).toFixed(2));
        somaVp = Number((somaVp + Math.min(val, Math.max(0.01, vp))).toFixed(2));
      } else {
        somaVp = Number((somaVp + val).toFixed(2));
      }
    }
    return {
      somaNominal,
      totalPagar: somaVp,
      economia: Number(Math.max(0, somaNominal - somaVp).toFixed(2)),
      usaCdcAutomatico: true,
    };
  }

  return { somaNominal, totalPagar: somaNominal, economia: 0, usaCdcAutomatico: false };
}
