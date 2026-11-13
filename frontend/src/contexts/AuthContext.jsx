import { createContext, useContext, useState, useEffect } from 'react';
import { auth as authApi } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const savedUser = localStorage.getItem('usuario');
    if (token && savedUser) {
      try {
        setUsuario(JSON.parse(savedUser));
      } catch {
        localStorage.removeItem('usuario');
      }
    }
    setLoading(false);
  }, []);

  const login = async (usuario, senha) => {
    const res = await authApi.login({ usuario, senha });
    localStorage.setItem('token', res.data.access_token);
    localStorage.setItem('usuario', JSON.stringify(res.data.usuario));
    setUsuario(res.data.usuario);
    return res.data;
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('usuario');
    setUsuario(null);
  };

  const atualizarUsuario = (perfil) => {
    localStorage.setItem('usuario', JSON.stringify(perfil));
    setUsuario(perfil);
  };

  return (
    <AuthContext.Provider value={{ usuario, login, logout, loading, setUsuario, atualizarUsuario }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
