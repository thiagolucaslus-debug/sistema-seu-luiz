import { todayLocalISO } from './dateUtils.js';

export const MONTHS_SHORT = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
];

export const MONTHS_FULL = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

export const PAYMENT_FORM_OPTIONS = [
  { value: 'dinheiro', label: 'Dinheiro em mãos' },
  { value: 'pix', label: 'Pix' },
  { value: 'transferencia', label: 'Transferência bancária' },
  { value: 'abatimento', label: 'Abatimento de dívida' },
  { value: 'outro', label: 'Outro' },
];

export function monthKey(ano, mes) {
  return `${Number(ano)}-${String(Number(mes)).padStart(2, '0')}`;
}

export function parseMonthKey(key) {
  const m = /^(\d{4})-(\d{1,2})$/.exec(String(key || ''));
  if (!m) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12 || ano < 2000 || ano > 2100) return null;
  return { ano, mes };
}

export function shiftMonth(ano, mes, delta) {
  let total = Number(ano) * 12 + (Number(mes) - 1) + Number(delta);
  const newAno = Math.floor(total / 12);
  const newMes = ((total % 12) + 12) % 12 + 1;
  return { ano: newAno, mes: newMes };
}

export function defaultDateForMonth(mes, ano, refDate = new Date()) {
  const m = Number(mes);
  const a = Number(ano);
  if (refDate.getFullYear() === a && refDate.getMonth() + 1 === m) {
    return todayLocalISO(refDate);
  }
  return `${a}-${String(m).padStart(2, '0')}-01`;
}

/**
 * Faz o parse flexível de valores monetários digitados no estilo BR ("1.250,50", "89,9", "R$ 45,00")
 * ou padrão internacional ("150.50"). Retorna número arredondado em 2 casas (> 0) ou null se inválido.
 */
export function parseBrlNumber(raw) {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= 0) return null;
    return Math.round(raw * 100) / 100;
  }
  let text = String(raw ?? '').trim();
  if (!text) return null;
  text = text.replace(/R\$/gi, '').replace(/\s+/g, '');
  if (!/^[\d.,+-]+$/.test(text)) return null;

  const hasComma = text.includes(',');
  const hasDot = text.includes('.');
  let normalized = text;

  if (hasComma && hasDot) {
    // Último separador define decimal: "1.234,56" vs "1,234.56"
    if (text.lastIndexOf(',') > text.lastIndexOf('.')) {
      normalized = text.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = text.replace(/,/g, '');
    }
  } else if (hasComma) {
    const parts = text.split(',');
    if (parts.length > 2) return null;
    normalized = `${parts[0]}.${parts[1]}`;
  } else if (hasDot) {
    const parts = text.split('.');
    if (parts.length > 2) {
      // Ex: "1.000.000" -> milhar
      normalized = text.replace(/\./g, '');
    }
  }

  const num = Number(normalized);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.round(num * 100) / 100;
}

export function formatEditableBrl(val) {
  const num = Number(val);
  if (!Number.isFinite(num)) return '';
  return num.toFixed(2).replace('.', ',');
}

/**
 * Monta as abas mensais em ordem cronológica (estilo planilha Excel),
 * sempre incluindo todos os meses presentes no histórico + mês anterior, atual e próximo.
 */
export function buildMonthTabs(historico = [], selectedKey = null, refDate = new Date()) {
  const curAno = refDate.getFullYear();
  const curMes = refDate.getMonth() + 1;

  const byKey = new Map();
  for (const h of historico || []) {
    const k = monthKey(h.ano, h.mes);
    byKey.set(k, {
      key: k,
      ano: h.ano,
      mes: h.mes,
      label: `${MONTHS_SHORT[h.mes - 1]}/${h.ano}`,
      fullLabel: `${MONTHS_FULL[h.mes - 1]} de ${h.ano}`,
      isAtual: Boolean(h.is_atual || (h.ano === curAno && h.mes === curMes)),
      hasServerData: true,
      saldoDevedor: Number(h.saldo_devedor || 0),
      creditoAFavor: Number(h.credito_a_favor || 0),
      totalGastos: Number(h.total_gastos || 0),
      totalPagamentos: Number(h.total_pagamentos || 0),
      qtdLancamentos: Array.isArray(h.lancamentos) ? h.lancamentos.length : 0,
      record: h,
    });
  }

  const ensureSlot = (ano, mes) => {
    const k = monthKey(ano, mes);
    if (!byKey.has(k)) {
      byKey.set(k, {
        key: k,
        ano,
        mes,
        label: `${MONTHS_SHORT[mes - 1]}/${ano}`,
        fullLabel: `${MONTHS_FULL[mes - 1]} de ${ano}`,
        isAtual: ano === curAno && mes === curMes,
        hasServerData: false,
        saldoDevedor: 0,
        creditoAFavor: 0,
        totalGastos: 0,
        totalPagamentos: 0,
        qtdLancamentos: 0,
        record: null,
      });
    }
  };

  // Garante mês anterior, mês atual e próximo mês sempre clicáveis
  const prev = shiftMonth(curAno, curMes, -1);
  const next = shiftMonth(curAno, curMes, 1);
  ensureSlot(prev.ano, prev.mes);
  ensureSlot(curAno, curMes);
  ensureSlot(next.ano, next.mes);

  const parsedSelected = parseMonthKey(selectedKey);
  if (parsedSelected) {
    ensureSlot(parsedSelected.ano, parsedSelected.mes);
  }

  return Array.from(byKey.values()).sort((a, b) => (a.ano - b.ano) || (a.mes - b.mes));
}

export function encodeOriginValue(item) {
  if (item?.cartao_id) return `card:${item.cartao_id}`;
  if (item?.conta_id) return `account:${item.conta_id}`;
  return 'cash';
}

export function decodeOriginPatch(encodedValue, currentTipo = 'compra_cartao') {
  const raw = String(encodedValue || 'cash');
  if (raw.startsWith('card:')) {
    const cardId = Number(raw.slice(5));
    if (!Number.isInteger(cardId) || cardId <= 0) return null;
    return {
      cartao_id: cardId,
      conta_id: null,
      tipo: 'compra_cartao',
    };
  }
  if (raw.startsWith('account:')) {
    const contaId = Number(raw.slice(8));
    if (!Number.isInteger(contaId) || contaId <= 0) return null;
    const preserveSpecial = ['emprestimo_dado', 'reembolso_pessoa', 'compra_para_mim'].includes(currentTipo);
    return {
      cartao_id: null,
      conta_id: contaId,
      tipo: preserveSpecial ? currentTipo : 'despesa_conta',
    };
  }
  const preserveSpecial = ['emprestimo_dado', 'reembolso_pessoa', 'compra_para_mim'].includes(currentTipo);
  return {
    cartao_id: null,
    conta_id: null,
    tipo: preserveSpecial ? currentTipo : 'despesa_conta',
  };
}

export function normalizePaymentFormaCode(formaPagamento, contaId = null) {
  const txt = String(formaPagamento || '').trim().toLowerCase();
  if (!txt) return contaId ? 'transferencia' : 'dinheiro';
  if (txt.includes('pix')) return 'pix';
  if (txt.includes('dinheiro')) return 'dinheiro';
  if (txt.includes('transfer') || txt.includes('crédito em conta') || txt.includes('credito em conta')) {
    return 'transferencia';
  }
  if (txt.includes('abatimento')) return 'abatimento';
  return 'outro';
}
