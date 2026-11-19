const brands = [
  { id: 'atacadao', name: 'Atacadão', match: /\batacadao\b/, color: '#c35212' },
  { id: 'coop', name: 'Coop', match: /\b(?:co{2,}p|co op)\b/, color: '#20396a' },
  { id: 'ultravioleta', name: 'Ultravioleta', match: /\bultravioleta\b/, color: '#382153' },
  { id: 'nubank', name: 'nu', match: /\b(?:nubank|nu|roxinho)\b/, color: '#820ad1' },
  { id: 'itau-personnalite', name: 'Itaú Personnalité', match: /\bpersonnalite\b/, color: '#203c68' },
  { id: 'itau-uniclass', name: 'Itaú Uniclass', match: /\buniclass\b/, color: '#135e6a' },
  { id: 'itau-click', name: 'Itaú Click', match: /\b(?:itau|itaucard)\s+click\b|^click\b/, color: '#505867' },
  { id: 'itau', name: 'Itaú', match: /\b(?:itau|itaucard)\b/, color: '#dd550b' },
  { id: 'inter', name: 'Inter', match: /\binter\b/, color: '#b74500' },
  { id: 'santander', name: 'Santander', match: /\bsantander\b/, color: '#bd111e' },
  { id: 'bradesco', name: 'Bradesco', match: /\b(?:bradesco|bradescard)\b/, color: '#aa1347' },
  { id: 'carrefour', name: 'Carrefour', match: /\bcarrefour\b/, color: '#1557a6' },
  { id: 'sicoob', name: 'Sicoob', match: /\bsicoob\b/, color: '#166158' },
  { id: 'sicredi', name: 'Sicredi', match: /\bsicredi\b/, color: '#237339' },
  { id: 'caixa', name: 'Caixa', match: /\bcaixa\b/, color: '#145c93' },
  { id: 'ourocard', name: 'Ourocard', match: /\b(?:ourocard|banco do brasil)\b/, color: '#9a7100' },
  { id: 'c6', name: 'C6 Bank', match: /\bc6(?:bank)?\b/, color: '#2c3543' },
  { id: 'picpay', name: 'PicPay', match: /\bpicpay\b/, color: '#147c4b' },
  { id: 'mercado-pago', name: 'Mercado Pago', match: /\bmercado\s?pago\b/, color: '#0874ae' },
];

export const CARD_COLOR_PALETTE = [
  { hex: '#dd550b', label: 'Laranja Itaú' },
  { hex: '#820ad1', label: 'Roxo Nubank' },
  { hex: '#2563eb', label: 'Azul Royal' },
  { hex: '#20396a', label: 'Azul Coop / Marinho' },
  { hex: '#0284c7', label: 'Azul Céu' },
  { hex: '#06b6d4', label: 'Ciano Vivo' },
  { hex: '#10b981', label: 'Verde Esmeralda' },
  { hex: '#15803d', label: 'Verde Escuro' },
  { hex: '#dc2626', label: 'Vermelho Rubi' },
  { hex: '#9f1239', label: 'Vinho Bordô' },
  { hex: '#ec4899', label: 'Rosa Vibrante' },
  { hex: '#5712f8', label: 'Índigo Violeta' },
  { hex: '#d97706', label: 'Dourado Âmbar' },
  { hex: '#c35212', label: 'Cobre Atacadão' },
  { hex: '#616161', label: 'Cinza Titanium' },
  { hex: '#111827', label: 'Preto Black' },
];

export function normalizeHexColor(color) {
  const raw = typeof color === 'string' ? color.trim() : '';
  return /^#[0-9a-f]{6}$/i.test(raw) ? raw.toLowerCase() : null;
}

export function suggestIssuerColor(name = '') {
  const normalized = (name ?? '').normalize('NFD').replace(/\p{M}/gu, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  const matched = brands.find(brand => brand.match.test(normalized));
  return matched ? matched.color : null;
}

export function getCardBrand(name = '', color) {
  const normalized = (name ?? '').normalize('NFD').replace(/\p{M}/gu, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  const rawTrimmed = typeof color === 'string' ? color.trim() : '';
  const isLegacyUntouchedDefault = rawTrimmed === '#8B5CF6';
  const customHex = isLegacyUntouchedDefault ? null : normalizeHexColor(rawTrimmed);
  const matched = brands.find(brand => brand.match.test(normalized));
  if (matched) {
    const resolvedColor = customHex ?? matched.color;
    return {
      ...matched,
      color: resolvedColor,
      hasCustomColor: Boolean(customHex),
      isIssuerOverride: Boolean(customHex && customHex !== matched.color.toLowerCase()),
    };
  }
  const fallbackHex = normalizeHexColor(rawTrimmed);
  return {
    id: 'custom',
    name: name?.trim() || 'Cartão',
    color: fallbackHex ?? '#51677e',
    hasCustomColor: Boolean(fallbackHex),
    isIssuerOverride: Boolean(fallbackHex),
  };
}
