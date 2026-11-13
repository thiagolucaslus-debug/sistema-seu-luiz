import { Nfc } from 'lucide-react';
import { getCardBrand } from './cardBrand';
import atacadaoVisa from '../assets/cards/atacadao-visa.webp';
import atacadaoMastercard from '../assets/cards/atacadao-mastercard.webp';
import coopVisa from '../assets/cards/coop-visa.png';

const officialArt = {
  atacadao: { Visa: atacadaoVisa, Mastercard: atacadaoMastercard },
  coop: { Visa: coopVisa },
};

export default function CardArtwork({ cartao, compact = false }) {
  const brand = getCardBrand(cartao.nome, cartao.cor);
  const bandeira = cartao.bandeira === 'Outro' ? '' : cartao.bandeira;
  const artwork = officialArt[brand.id]?.[bandeira];

  return (
    <div
      className={`card-art${compact ? ' card-art--compact' : ''}${artwork ? ' card-art--official' : ''}`}
      data-issuer={brand.id}
      style={{ '--issuer': brand.color }}
      aria-hidden="true"
    >
      {artwork ? <img src={artwork} alt="" /> : <span className="card-art__brand">{brand.name}</span>}
      {!compact && !artwork && (
        <>
          <div className="card-art__hardware">
            <span className="card-art__chip" />
            <Nfc size={19} />
          </div>
          <div className="card-art__footer">
            <span>{brand.id === 'coop' ? 'bradescard' : ''}</span>
            {bandeira === 'Mastercard' ? <span className="card-art__mastercard" /> : <span>{bandeira}</span>}
          </div>
        </>
      )}
    </div>
  );
}
