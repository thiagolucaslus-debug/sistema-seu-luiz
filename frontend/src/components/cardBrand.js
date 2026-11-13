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

export function getCardBrand(name = '', color) {
  const normalized = (name ?? '').normalize('NFD').replace(/\p{M}/gu, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  return brands.find(brand => brand.match.test(normalized)) ?? {
    id: 'custom',
    name: name?.trim() || 'Cartão',
    color: /^#[0-9a-f]{6}$/i.test(color ?? '') ? color : '#51677e',
  };
}
