import { useState } from 'react';
import { mediaUrl } from '../api/client';

export default function Avatar({ nome, foto, cor, className = '' }) {
  const [failedPhoto, setFailedPhoto] = useState(null);
  const initials = nome?.trim().split(/\s+/).slice(0, 2)
    .map(word => word[0]).join('').toUpperCase() || 'SL';
  return (
    <span className={`avatar ${className}`} aria-hidden="true" style={{ '--avatar-color': cor }}>
      {foto && foto !== failedPhoto
        ? <img src={mediaUrl(foto)} alt="" onError={() => setFailedPhoto(foto)} />
        : initials}
    </span>
  );
}
