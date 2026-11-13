// Ícones SVG ilustrados para módulos — estilo iOS, com gradientes e detalhes visuais

export function IconCasa({ size = 48 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g-casa-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#60A5FA"/>
          <stop offset="100%" stopColor="#3B82F6"/>
        </linearGradient>
        <linearGradient id="g-casa-roof" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#EF4444"/>
          <stop offset="100%" stopColor="#B91C1C"/>
        </linearGradient>
        <linearGradient id="g-casa-wall" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FEF3C7"/>
          <stop offset="100%" stopColor="#FDE68A"/>
        </linearGradient>
      </defs>
      {/* Chão */}
      <ellipse cx="24" cy="43" rx="18" ry="3" fill="#16A34A" opacity="0.3"/>
      {/* Parede */}
      <rect x="10" y="26" width="28" height="17" rx="2" fill="url(#g-casa-wall)"/>
      {/* Telhado */}
      <polygon points="6,27 24,10 42,27" fill="url(#g-casa-roof)"/>
      <polygon points="6,27 24,10 42,27" fill="none" stroke="#991B1B" strokeWidth="0.8" opacity="0.4"/>
      {/* Chaminé */}
      <rect x="30" y="13" width="5" height="9" rx="1" fill="#B91C1C"/>
      <rect x="29" y="11" width="7" height="3" rx="1" fill="#991B1B"/>
      {/* Porta */}
      <rect x="19" y="33" width="10" height="10" rx="2" fill="#92400E"/>
      <rect x="20" y="34" width="4" height="9" rx="1" fill="#A16207"/>
      <rect x="25" y="34" width="4" height="9" rx="1" fill="#A16207"/>
      <circle cx="24.5" cy="38.5" r="1" fill="#78350F"/>
      {/* Janelas */}
      <rect x="12" y="29" width="7" height="6" rx="1.5" fill="#BAE6FD"/>
      <line x1="15.5" y1="29" x2="15.5" y2="35" stroke="white" strokeWidth="0.8"/>
      <line x1="12" y1="32" x2="19" y2="32" stroke="white" strokeWidth="0.8"/>
      <rect x="29" y="29" width="7" height="6" rx="1.5" fill="#BAE6FD"/>
      <line x1="32.5" y1="29" x2="32.5" y2="35" stroke="white" strokeWidth="0.8"/>
      <line x1="29" y1="32" x2="36" y2="32" stroke="white" strokeWidth="0.8"/>
    </svg>
  );
}

export function IconRoca({ size = 48 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g-roca-green" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4ADE80"/>
          <stop offset="100%" stopColor="#16A34A"/>
        </linearGradient>
        <linearGradient id="g-roca-soil" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#A3833A"/>
          <stop offset="100%" stopColor="#78580F"/>
        </linearGradient>
        <linearGradient id="g-trator-body" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#F59E0B"/>
          <stop offset="100%" stopColor="#D97706"/>
        </linearGradient>
      </defs>
      {/* Terra / solo */}
      <ellipse cx="24" cy="41" rx="20" ry="5" fill="url(#g-roca-soil)" opacity="0.6"/>
      {/* Roda traseira grande */}
      <circle cx="14" cy="34" r="10" fill="#374151"/>
      <circle cx="14" cy="34" r="7" fill="#4B5563"/>
      <circle cx="14" cy="34" r="3" fill="#6B7280"/>
      <line x1="14" y1="27" x2="14" y2="41" stroke="#374151" strokeWidth="1.5"/>
      <line x1="7" y1="34" x2="21" y2="34" stroke="#374151" strokeWidth="1.5"/>
      {/* Roda dianteira pequena */}
      <circle cx="34" cy="37" r="6" fill="#374151"/>
      <circle cx="34" cy="37" r="4" fill="#4B5563"/>
      <circle cx="34" cy="37" r="1.5" fill="#6B7280"/>
      {/* Corpo do trator */}
      <rect x="14" y="22" width="22" height="14" rx="2" fill="url(#g-trator-body)"/>
      {/* Cabine */}
      <rect x="20" y="15" width="14" height="12" rx="2" fill="#D97706"/>
      {/* Vidro */}
      <rect x="22" y="17" width="10" height="7" rx="1.5" fill="#BAE6FD" opacity="0.8"/>
      {/* Exaustor */}
      <rect x="27" y="10" width="3" height="7" rx="1" fill="#6B7280"/>
      <ellipse cx="28.5" cy="10" rx="2.5" ry="1.5" fill="#9CA3AF"/>
      {/* Plantas ao redor */}
      <path d="M6 20 Q8 14 10 18 Q8 22 6 20Z" fill="url(#g-roca-green)"/>
      <path d="M4 15 Q7 10 9 15" stroke="#16A34A" strokeWidth="1.5" fill="none"/>
      <path d="M40 20 Q42 14 44 18 Q42 22 40 20Z" fill="url(#g-roca-green)"/>
    </svg>
  );
}

export function IconCarro({ size = 48 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g-car-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#60A5FA"/>
          <stop offset="100%" stopColor="#2563EB"/>
        </linearGradient>
        <linearGradient id="g-car-glass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#E0F2FE"/>
          <stop offset="100%" stopColor="#BAE6FD"/>
        </linearGradient>
        <linearGradient id="g-car-wheel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#374151"/>
          <stop offset="100%" stopColor="#111827"/>
        </linearGradient>
      </defs>
      {/* Sombra */}
      <ellipse cx="24" cy="43" rx="19" ry="3" fill="black" opacity="0.12"/>
      {/* Carroceria baixa */}
      <rect x="4" y="28" width="40" height="12" rx="4" fill="url(#g-car-body)"/>
      {/* Topo / cabine */}
      <path d="M12 28 L14 16 Q15 13 18 13 L30 13 Q33 13 34 16 L36 28Z" fill="url(#g-car-body)"/>
      {/* Vidro dianteiro */}
      <path d="M15 28 L17 17 Q18 15 20 15 L28 15 Q30 15 31 17 L33 28Z" fill="url(#g-car-glass)"/>
      {/* Detalhe lateral */}
      <rect x="4" y="32" width="40" height="2" rx="1" fill="#1D4ED8" opacity="0.5"/>
      {/* Faróis dianteiros */}
      <ellipse cx="38" cy="30" rx="3" ry="2" fill="#FEF08A"/>
      <ellipse cx="38" cy="30" rx="2" ry="1.5" fill="#FDE047"/>
      {/* Faróis traseiros */}
      <ellipse cx="10" cy="30" rx="3" ry="2" fill="#FCA5A5"/>
      <ellipse cx="10" cy="30" rx="2" ry="1.5" fill="#F87171"/>
      {/* Rodas */}
      <circle cx="14" cy="38" r="6" fill="url(#g-car-wheel)"/>
      <circle cx="14" cy="38" r="4" fill="#4B5563"/>
      <circle cx="14" cy="38" r="2" fill="#9CA3AF"/>
      <circle cx="34" cy="38" r="6" fill="url(#g-car-wheel)"/>
      <circle cx="34" cy="38" r="4" fill="#4B5563"/>
      <circle cx="34" cy="38" r="2" fill="#9CA3AF"/>
      {/* Espelhos */}
      <rect x="34" y="22" width="5" height="3" rx="1" fill="#1D4ED8"/>
      <rect x="9" y="22" width="5" height="3" rx="1" fill="#1D4ED8"/>
      {/* Grade dianteira */}
      <rect x="34" y="34" width="6" height="4" rx="1" fill="#1E40AF"/>
      <line x1="35" y1="35" x2="35" y2="38" stroke="#BAE6FD" strokeWidth="0.8" opacity="0.5"/>
      <line x1="37" y1="35" x2="37" y2="38" stroke="#BAE6FD" strokeWidth="0.8" opacity="0.5"/>
      <line x1="39" y1="35" x2="39" y2="38" stroke="#BAE6FD" strokeWidth="0.8" opacity="0.5"/>
    </svg>
  );
}

export function IconPessoal({ size = 48 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g-pes-shirt" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#A78BFA"/>
          <stop offset="100%" stopColor="#7C3AED"/>
        </linearGradient>
        <linearGradient id="g-pes-skin" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FBBF24"/>
          <stop offset="100%" stopColor="#F59E0B"/>
        </linearGradient>
      </defs>
      {/* Sombra */}
      <ellipse cx="24" cy="46" rx="14" ry="2" fill="black" opacity="0.1"/>
      {/* Corpo / roupa */}
      <path d="M10 44 Q10 32 16 29 Q19 28 24 28 Q29 28 32 29 Q38 32 38 44Z" fill="url(#g-pes-shirt)"/>
      {/* Detalhe gola */}
      <path d="M20 29 Q24 33 28 29" stroke="#8B5CF6" strokeWidth="1.5" fill="none"/>
      {/* Pescoço */}
      <rect x="21" y="22" width="6" height="7" rx="3" fill="url(#g-pes-skin)"/>
      {/* Cabeça */}
      <circle cx="24" cy="17" r="10" fill="url(#g-pes-skin)"/>
      {/* Cabelo */}
      <path d="M14 15 Q14 7 24 7 Q34 7 34 15" fill="#78350F"/>
      <path d="M14 15 Q13 10 16 9" stroke="#78350F" strokeWidth="2" fill="none"/>
      <path d="M34 15 Q35 10 32 9" stroke="#78350F" strokeWidth="2" fill="none"/>
      {/* Olhos */}
      <circle cx="20" cy="17" r="2" fill="white"/>
      <circle cx="28" cy="17" r="2" fill="white"/>
      <circle cx="20.5" cy="17.5" r="1.2" fill="#1E293B"/>
      <circle cx="28.5" cy="17.5" r="1.2" fill="#1E293B"/>
      <circle cx="21" cy="17" r="0.4" fill="white"/>
      <circle cx="29" cy="17" r="0.4" fill="white"/>
      {/* Sorriso */}
      <path d="M20 21 Q24 24 28 21" stroke="#C2410C" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
      {/* Bochechas */}
      <circle cx="17" cy="19" r="2" fill="#FCA5A5" opacity="0.5"/>
      <circle cx="31" cy="19" r="2" fill="#FCA5A5" opacity="0.5"/>
      {/* Braços */}
      <path d="M12 32 Q7 36 9 42" stroke="url(#g-pes-shirt)" strokeWidth="6" strokeLinecap="round" fill="none"/>
      <path d="M36 32 Q41 36 39 42" stroke="url(#g-pes-shirt)" strokeWidth="6" strokeLinecap="round" fill="none"/>
    </svg>
  );
}

export function IconSaude({ size = 48 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g-heart" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FB7185"/>
          <stop offset="100%" stopColor="#E11D48"/>
        </linearGradient>
        <linearGradient id="g-pulse" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#34D399"/>
          <stop offset="100%" stopColor="#059669"/>
        </linearGradient>
      </defs>
      {/* Coração */}
      <path d="M24 40 L7 23 Q4 18 8 13 Q12 8 17 10 Q20 11 24 15 Q28 11 31 10 Q36 8 40 13 Q44 18 41 23 Z"
        fill="url(#g-heart)"/>
      {/* Brilho no coração */}
      <ellipse cx="16" cy="17" rx="4" ry="3" fill="white" opacity="0.25" transform="rotate(-20 16 17)"/>
      {/* Cruz médica */}
      <rect x="20" y="20" width="8" height="16" rx="2" fill="white" opacity="0.9"/>
      <rect x="16" y="24" width="16" height="8" rx="2" fill="white" opacity="0.9"/>
      {/* Linha de pulso */}
      <path d="M4 32 L10 32 L13 26 L17 38 L20 30 L23 33 L26 32 L44 32"
        stroke="url(#g-pulse)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export function IconViagem({ size = 48 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#38BDF8"/>
          <stop offset="100%" stopColor="#0284C7"/>
        </linearGradient>
        <linearGradient id="g-plane" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#F1F5F9"/>
          <stop offset="100%" stopColor="#CBD5E1"/>
        </linearGradient>
      </defs>
      {/* Nuvens de fundo */}
      <ellipse cx="10" cy="12" rx="8" ry="5" fill="white" opacity="0.8"/>
      <ellipse cx="6" cy="14" rx="5" ry="4" fill="white" opacity="0.8"/>
      <ellipse cx="40" cy="20" rx="7" ry="4" fill="white" opacity="0.6"/>
      <ellipse cx="36" cy="22" rx="5" ry="3" fill="white" opacity="0.6"/>
      {/* Avião */}
      {/* Fuselagem */}
      <path d="M6 26 Q14 20 38 22 Q42 23 42 26 Q42 29 38 30 Q14 32 6 26Z" fill="url(#g-plane)"/>
      {/* Cockpit */}
      <ellipse cx="41" cy="26" rx="4" ry="4" fill="#BAE6FD"/>
      <ellipse cx="42" cy="25" rx="2" ry="2.5" fill="#7DD3FC"/>
      {/* Asa principal */}
      <path d="M20 22 L28 10 L34 10 L30 22Z" fill="#CBD5E1"/>
      <path d="M20 22 L28 10 L34 10 L30 22Z" fill="none" stroke="#94A3B8" strokeWidth="0.8"/>
      {/* Asa traseira */}
      <path d="M10 26 L14 20 L17 20 L15 26Z" fill="#CBD5E1"/>
      {/* Estabilizador */}
      <path d="M8 26 L10 20 L13 20 L12 26Z" fill="#CBD5E1"/>
      {/* Motor */}
      <ellipse cx="26" cy="22" rx="4" ry="2.5" fill="#94A3B8"/>
      <ellipse cx="26" cy="22" rx="2.5" ry="1.5" fill="#64748B"/>
      {/* Janelas */}
      <circle cx="30" cy="26" r="1.5" fill="#BAE6FD"/>
      <circle cx="25" cy="26" r="1.5" fill="#BAE6FD"/>
      <circle cx="20" cy="26" r="1.5" fill="#BAE6FD"/>
      <circle cx="15" cy="26" r="1.5" fill="#BAE6FD"/>
      {/* Rastro */}
      <path d="M4 28 Q6 27 8 26" stroke="white" strokeWidth="2" strokeLinecap="round" opacity="0.6"/>
      <path d="M2 30 Q5 29 8 28" stroke="white" strokeWidth="1.5" strokeLinecap="round" opacity="0.4"/>
    </svg>
  );
}

export function IconTrabalho({ size = 48 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g-brief" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6366F1"/>
          <stop offset="100%" stopColor="#4338CA"/>
        </linearGradient>
        <linearGradient id="g-brief2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#818CF8"/>
          <stop offset="100%" stopColor="#6366F1"/>
        </linearGradient>
      </defs>
      {/* Alça */}
      <path d="M18 16 L18 13 Q18 10 24 10 Q30 10 30 13 L30 16" stroke="#4338CA" strokeWidth="3" fill="none" strokeLinecap="round"/>
      {/* Corpo da maleta */}
      <rect x="6" y="16" width="36" height="26" rx="4" fill="url(#g-brief)"/>
      {/* Faixa central */}
      <rect x="6" y="26" width="36" height="5" fill="#4338CA" opacity="0.4"/>
      {/* Fecho */}
      <rect x="20" y="24" width="8" height="7" rx="2" fill="url(#g-brief2)"/>
      <rect x="22" y="26" width="4" height="3" rx="1" fill="#312E81"/>
      {/* Detalhes de costura */}
      <rect x="8" y="18" width="32" height="22" rx="3" fill="none" stroke="#818CF8" strokeWidth="0.8" opacity="0.4"/>
      {/* Documento dentro */}
      <rect x="14" y="20" width="8" height="10" rx="1" fill="white" opacity="0.15"/>
      <line x1="15" y1="23" x2="21" y2="23" stroke="white" strokeWidth="0.8" opacity="0.4"/>
      <line x1="15" y1="25" x2="21" y2="25" stroke="white" strokeWidth="0.8" opacity="0.4"/>
      <line x1="15" y1="27" x2="19" y2="27" stroke="white" strokeWidth="0.8" opacity="0.4"/>
      {/* Lápis */}
      <rect x="30" y="20" width="3" height="11" rx="1" fill="#FDE68A" transform="rotate(-15 30 20)"/>
      <polygon points="30,30 33,30 31.5,34" fill="#F59E0B" transform="rotate(-15 30 20)"/>
    </svg>
  );
}

export function IconMercado({ size = 48 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g-bag" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#34D399"/>
          <stop offset="100%" stopColor="#059669"/>
        </linearGradient>
      </defs>
      {/* Alça */}
      <path d="M17 22 Q17 14 24 14 Q31 14 31 22" stroke="#059669" strokeWidth="3" fill="none" strokeLinecap="round"/>
      {/* Sacola */}
      <path d="M8 22 L10 42 Q10 44 12 44 L36 44 Q38 44 38 42 L40 22Z" fill="url(#g-bag)"/>
      {/* Detalhe sacola */}
      <path d="M8 22 L10 42 Q10 44 12 44 L36 44 Q38 44 38 42 L40 22Z" fill="none" stroke="#047857" strokeWidth="0.8"/>
      {/* Faixas decorativas */}
      <line x1="10" y1="30" x2="40" y2="30" stroke="#047857" strokeWidth="0.8" opacity="0.4"/>
      {/* Produtos dentro */}
      <circle cx="18" cy="35" r="5" fill="#FDE68A"/>
      <circle cx="30" cy="34" r="4" fill="#FCA5A5"/>
      <rect x="22" y="32" width="6" height="8" rx="1" fill="#BAE6FD"/>
      {/* Rótulos */}
      <circle cx="18" cy="35" r="2" fill="#F59E0B"/>
      <rect x="23" y="34" width="4" height="2" rx="0.5" fill="#7DD3FC"/>
      {/* Logo mercado */}
      <text x="12" y="27" fontSize="5" fill="white" fontWeight="bold" opacity="0.8">MERCADO</text>
    </svg>
  );
}

export function IconReforma({ size = 48 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g-wrench" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#94A3B8"/>
          <stop offset="100%" stopColor="#475569"/>
        </linearGradient>
        <linearGradient id="g-hammer" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#78716C"/>
          <stop offset="100%" stopColor="#44403C"/>
        </linearGradient>
      </defs>
      {/* Chave de fenda */}
      <rect x="30" y="6" width="4" height="28" rx="2" fill="url(#g-wrench)" transform="rotate(30 30 6)"/>
      <rect x="29" y="4" width="6" height="6" rx="1" fill="#64748B" transform="rotate(30 29 4)"/>
      {/* Martelo */}
      <rect x="10" y="30" width="6" height="18" rx="2" fill="#A78BFA" transform="rotate(-20 10 30)"/>
      <rect x="6" y="25" width="14" height="8" rx="2" fill="url(#g-hammer)" transform="rotate(-20 6 25)"/>
      {/* Chave inglesa */}
      <path d="M28 28 Q32 24 36 26 Q40 28 38 32 Q36 36 32 34 L20 44 Q18 46 16 44 Q14 42 16 40 Z"
        fill="url(#g-wrench)"/>
      <circle cx="34" cy="28" r="4" fill="none" stroke="#94A3B8" strokeWidth="2"/>
      <circle cx="17" cy="41" r="2.5" fill="#64748B"/>
      {/* Parafuso */}
      <circle cx="22" cy="16" r="5" fill="#CBD5E1"/>
      <circle cx="22" cy="16" r="3" fill="#94A3B8"/>
      <line x1="22" y1="13" x2="22" y2="19" stroke="#64748B" strokeWidth="1.5"/>
      <line x1="19" y1="16" x2="25" y2="16" stroke="#64748B" strokeWidth="1.5"/>
      {/* Faísca */}
      <path d="M8 8 L12 12 M14 6 L14 11 M8 14 L13 12" stroke="#FCD34D" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
}

export function IconEstudo({ size = 48 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g-book1" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#F87171"/>
          <stop offset="100%" stopColor="#EF4444"/>
        </linearGradient>
        <linearGradient id="g-book2" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#60A5FA"/>
          <stop offset="100%" stopColor="#3B82F6"/>
        </linearGradient>
        <linearGradient id="g-book3" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#4ADE80"/>
          <stop offset="100%" stopColor="#16A34A"/>
        </linearGradient>
      </defs>
      {/* Livro 3 (fundo) */}
      <rect x="30" y="10" width="12" height="32" rx="2" fill="url(#g-book3)"/>
      <rect x="30" y="10" width="2" height="32" fill="#15803D"/>
      <line x1="32" y1="16" x2="40" y2="16" stroke="white" strokeWidth="1" opacity="0.4"/>
      <line x1="32" y1="20" x2="40" y2="20" stroke="white" strokeWidth="1" opacity="0.4"/>
      <line x1="32" y1="24" x2="38" y2="24" stroke="white" strokeWidth="1" opacity="0.4"/>
      {/* Livro 2 (meio) */}
      <rect x="18" y="8" width="14" height="34" rx="2" fill="url(#g-book2)"/>
      <rect x="18" y="8" width="2" height="34" fill="#1D4ED8"/>
      <line x1="20" y1="15" x2="30" y2="15" stroke="white" strokeWidth="1" opacity="0.4"/>
      <line x1="20" y1="20" x2="30" y2="20" stroke="white" strokeWidth="1" opacity="0.4"/>
      <line x1="20" y1="25" x2="30" y2="25" stroke="white" strokeWidth="1" opacity="0.4"/>
      <line x1="20" y1="30" x2="28" y2="30" stroke="white" strokeWidth="1" opacity="0.4"/>
      {/* Livro 1 (frente) */}
      <rect x="6" y="6" width="14" height="36" rx="2" fill="url(#g-book1)"/>
      <rect x="6" y="6" width="2" height="36" fill="#B91C1C"/>
      <line x1="8" y1="13" x2="18" y2="13" stroke="white" strokeWidth="1" opacity="0.4"/>
      <line x1="8" y1="18" x2="18" y2="18" stroke="white" strokeWidth="1" opacity="0.4"/>
      <line x1="8" y1="23" x2="18" y2="23" stroke="white" strokeWidth="1" opacity="0.4"/>
      <line x1="8" y1="28" x2="18" y2="28" stroke="white" strokeWidth="1" opacity="0.4"/>
      <line x1="8" y1="33" x2="16" y2="33" stroke="white" strokeWidth="1" opacity="0.4"/>
      {/* Caneta / marcador */}
      <rect x="34" y="4" width="3" height="12" rx="1" fill="#FDE68A"/>
      <polygon points="34,16 37,16 35.5,20" fill="#F59E0B"/>
      <rect x="34" y="4" width="3" height="2" rx="0.5" fill="#D97706"/>
      {/* Chapéu de formatura */}
      <polygon points="24,2 44,8 24,14 4,8" fill="#1E293B"/>
      <rect x="22" y="14" width="4" height="2" fill="#1E293B"/>
      <rect x="22" y="14" width="4" height="2" fill="#94A3B8"/>
    </svg>
  );
}

export function IconCartao({ size = 48 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g-card-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#6366F1"/>
          <stop offset="40%" stopColor="#8B5CF6"/>
          <stop offset="100%" stopColor="#EC4899"/>
        </linearGradient>
        <linearGradient id="g-card-chip" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FDE68A"/>
          <stop offset="100%" stopColor="#F59E0B"/>
        </linearGradient>
        <radialGradient id="g-card-glow" cx="30%" cy="30%">
          <stop offset="0%" stopColor="white" stopOpacity="0.2"/>
          <stop offset="100%" stopColor="white" stopOpacity="0"/>
        </radialGradient>
      </defs>
      {/* Cartão principal */}
      <rect x="4" y="10" width="40" height="28" rx="5" fill="url(#g-card-bg)"/>
      <rect x="4" y="10" width="40" height="28" rx="5" fill="url(#g-card-glow)"/>
      {/* Chip */}
      <rect x="10" y="18" width="10" height="8" rx="2" fill="url(#g-card-chip)"/>
      <line x1="13" y1="18" x2="13" y2="26" stroke="#D97706" strokeWidth="0.8"/>
      <line x1="16" y1="18" x2="16" y2="26" stroke="#D97706" strokeWidth="0.8"/>
      <line x1="10" y1="22" x2="20" y2="22" stroke="#D97706" strokeWidth="0.8"/>
      {/* Contactless */}
      <path d="M24 20 Q28 22 24 26" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" opacity="0.7"/>
      <path d="M26 18 Q32 22 26 28" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" opacity="0.5"/>
      <path d="M28 16 Q36 22 28 30" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" opacity="0.3"/>
      {/* Número do cartão */}
      <text x="10" y="34" fontSize="6" fill="white" fontFamily="monospace" opacity="0.9" letterSpacing="2">•••• •••• 4521</text>
      {/* Bandeira (círculos Mastercard style) */}
      <circle cx="36" cy="18" r="5" fill="#EB001B" opacity="0.9"/>
      <circle cx="41" cy="18" r="5" fill="#F79E1B" opacity="0.9"/>
      <path d="M38.5 15 Q40 18 38.5 21" fill="#FF5F00" opacity="0.9"/>
    </svg>
  );
}

export function IconConta({ size = 48 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g-bank" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#34D399"/>
          <stop offset="100%" stopColor="#047857"/>
        </linearGradient>
        <linearGradient id="g-bank-col" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6EE7B7"/>
          <stop offset="100%" stopColor="#34D399"/>
        </linearGradient>
      </defs>
      {/* Base */}
      <rect x="4" y="40" width="40" height="4" rx="2" fill="url(#g-bank)"/>
      {/* Colunas */}
      <rect x="8" y="20" width="5" height="20" rx="1" fill="url(#g-bank-col)"/>
      <rect x="15" y="20" width="5" height="20" rx="1" fill="url(#g-bank-col)"/>
      <rect x="22" y="20" width="5" height="20" rx="1" fill="url(#g-bank-col)"/>
      <rect x="29" y="20" width="5" height="20" rx="1" fill="url(#g-bank-col)"/>
      <rect x="36" y="20" width="5" height="20" rx="1" fill="url(#g-bank-col)"/>
      {/* Plataforma das colunas */}
      <rect x="4" y="18" width="40" height="4" rx="1" fill="url(#g-bank)"/>
      {/* Telhado triangular */}
      <polygon points="2,18 24,5 46,18" fill="url(#g-bank)"/>
      {/* Detalhe telhado */}
      <polygon points="2,18 24,5 46,18" fill="none" stroke="#065F46" strokeWidth="0.8"/>
      {/* Cifrão */}
      <text x="21" y="15" fontSize="8" fill="white" fontWeight="bold">$</text>
    </svg>
  );
}

// Mapa de ícones por chave — disponível para o seletor de módulos
export const ICONES = [
  { key: 'home',     Comp: IconCasa,      label: 'Casa' },
  { key: 'tree',     Comp: IconRoca,      label: 'Roça' },
  { key: 'car',      Comp: IconCarro,     label: 'Carro' },
  { key: 'user',     Comp: IconPessoal,   label: 'Pessoal' },
  { key: 'health',   Comp: IconSaude,     label: 'Saúde' },
  { key: 'plane',    Comp: IconViagem,    label: 'Viagem' },
  { key: 'work',     Comp: IconTrabalho,  label: 'Trabalho' },
  { key: 'shopping', Comp: IconMercado,   label: 'Mercado' },
  { key: 'wrench',   Comp: IconReforma,   label: 'Reforma' },
  { key: 'book',     Comp: IconEstudo,    label: 'Estudo' },
];

export const EMOJIS_SUGERIDOS = [
  { emoji: '🐂', label: 'Boi / Gado' },
  { emoji: '🐮', label: 'Vaca' },
  { emoji: '🚜', label: 'Trator' },
  { emoji: '🌾', label: 'Roça / Fazenda' },
  { emoji: '🐎', label: 'Cavalo' },
  { emoji: '🥩', label: 'Churrasco' },
  { emoji: '🐕', label: 'Pet / Animal' },
  { emoji: '🛠️', label: 'Ferramentas' },
  { emoji: '🛒', label: 'Mercado' },
  { emoji: '🏠', label: 'Casa' },
  { emoji: '🚗', label: 'Carro' },
  { emoji: '💰', label: 'Investimento' },
  { emoji: '💊', label: 'Saúde / Remédio' },
  { emoji: '✈️', label: 'Viagem' },
  { emoji: '🍺', label: 'Lazer' },
  { emoji: '📱', label: 'Celular' },
  { emoji: '⚙️', label: 'Oficina' },
  { emoji: '🌽', label: 'Milho' },
  { emoji: '🐖', label: 'Porco' },
  { emoji: '🐔', label: 'Galinha' },
];

export function IconEmoji({ emoji, size = 48 }) {
  return (
    <span
      style={{
        fontSize: `${size * 0.72}px`,
        lineHeight: 1,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: `${size}px`,
        height: `${size}px`
      }}
      role="img"
      aria-label="ícone do módulo"
    >
      {emoji}
    </span>
  );
}

const ICON_MAP_INTERNAL = {
  home: IconCasa, tree: IconRoca, car: IconCarro, user: IconPessoal,
  health: IconSaude, plane: IconViagem, work: IconTrabalho,
  shopping: IconMercado, wrench: IconReforma, book: IconEstudo,
  cartao: IconCartao, conta: IconConta,
  casa: IconCasa, roca: IconRoca, carro: IconCarro, pessoal: IconPessoal,
  saude: IconSaude, viagem: IconViagem, trabalho: IconTrabalho,
  mercado: IconMercado, reforma: IconReforma, estudo: IconEstudo,
};

export function getModuleIcon(icone, nome) {
  if (!icone && !nome) return IconPessoal;
  if (icone && (icone.startsWith('emoji:') || /\p{Extended_Pictographic}/u.test(icone))) {
    const em = icone.startsWith('emoji:') ? icone.replace('emoji:', '') : icone;
    return function EmojiWrapper({ size = 48 }) {
      return <IconEmoji emoji={em} size={size} />;
    };
  }
  const key = (icone || '').toLowerCase();
  const nomeKey = (nome || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return ICON_MAP_INTERNAL[key] || ICON_MAP_INTERNAL[nomeKey] || IconPessoal;
}
