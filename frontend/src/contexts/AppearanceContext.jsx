import { createContext, useContext, useEffect, useState } from 'react';

const AppearanceContext = createContext(null);

export function AppearanceProvider({ children }) {
  const [theme, setTheme] = useState(() => localStorage.getItem('seuluiz.theme') === 'dark' ? 'dark' : 'light');
  const [size, setSize] = useState(() => {
    const saved = Number(localStorage.getItem('seuluiz.fontSize'));
    return [90, 100, 110, 120, 130].includes(saved) ? saved : 100;
  });
  const [backgroundIntensity, setBackgroundIntensity] = useState(() => {
    const saved = localStorage.getItem('seuluiz.backgroundIntensity');
    const value = saved === null ? 80 : Number(saved);
    return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 80;
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.fontSize = `${size}%`;
    localStorage.setItem('seuluiz.theme', theme);
    localStorage.setItem('seuluiz.fontSize', String(size));
  }, [theme, size]);

  useEffect(() => {
    document.documentElement.style.setProperty('--photo-intensity', String(backgroundIntensity / 100));
    localStorage.setItem('seuluiz.backgroundIntensity', String(backgroundIntensity));
  }, [backgroundIntensity]);

  return (
    <AppearanceContext.Provider value={{
      theme, setTheme, size, setSize, backgroundIntensity, setBackgroundIntensity,
    }}>
      {children}
    </AppearanceContext.Provider>
  );
}

export const useAppearance = () => useContext(AppearanceContext);
