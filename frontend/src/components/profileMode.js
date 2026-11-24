const PERSONAL_ONLY_USERS = new Set(['thiagolucas121']);

export function isPersonalOnlyProfile(usuario) {
  const login = String(usuario?.usuario || usuario?.email || '').trim().toLowerCase();
  return PERSONAL_ONLY_USERS.has(login);
}
