import { Nfc } from 'lucide-react';
import { getCardBrand } from './cardBrand';
import atacadaoVisa from '../assets/cards/atacadao-visa.webp';
import atacadaoMastercard from '../assets/cards/atacadao-mastercard.webp';
import coopVisa from '../assets/cards/coop-visa.png';

const officialArt = {
  atacadao: { Visa: atacadaoVisa, Mastercard: atacadaoMastercard },
  coop: { Visa: coopVisa },
};

export default function CardArtwork({ cartao, brand: legacyBrand, bank: legacyBank, color: legacyColor, compact = false, className = '' }) {
  const resolvedCartao = cartao || {
    nome: legacyBank || 'Cartão',
    bandeira: legacyBrand || 'Visa',
    cor: legacyColor,
  };
  const nomeBruto = (resolvedCartao.nome || '').trim();
  const brand = getCardBrand(nomeBruto, resolvedCartao.cor);
  const bandeira = resolvedCartao.bandeira === 'Outro' ? '' : (resolvedCartao.bandeira || '');
  const artwork = !brand.hasCustomColor ? officialArt[brand.id]?.[bandeira] : null;
  const mostrarApelidoRodape =
    nomeBruto &&
    nomeBruto.toLowerCase() !== brand.name.toLowerCase();

  return (
    <div
      className={`card-art${compact ? ' card-art--compact' : ''}${artwork ? ' card-art--official' : ''}${className ? ` ${className}` : ''}`}
      data-issuer={brand.id}
      data-custom-color={brand.isIssuerOverride ? 'true' : 'false'}
      style={{ '--issuer': brand.color }}
      aria-hidden="true"
    >
      {artwork ? (
        <img src={artwork} alt="" />
      ) : (
        <span className="card-art__brand">{brand.name}</span>
      )}
      {!compact && !artwork && (
        <>
          <div className="card-art__hardware">
            <span className="card-art__chip" />
            <Nfc size={19} />
          </div>
          <div className="card-art__footer">
            <span className="truncate max-w-[65%]">
              {mostrarApelidoRodape ? nomeBruto : (brand.id === 'coop' ? 'bradescard' : '')}
            </span>
            {bandeira === 'Mastercard' ? <span className="card-art__mastercard" /> : <span>{bandeira}</span>}
          </div>
        </>
      )}
    </div>
  );
}
