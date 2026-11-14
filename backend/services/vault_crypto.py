"""
Cofre Privado Criptografado AES-256-GCM (GitHub Private Vault) + Merge Seguro SQLite.

Elimina 100% dos erros HTTP 403 Quota Exceeded de clientes OAuth compartilhados,
mantendo custo R$ 0,00 e criptografia autenticada de ponta a ponta em repouso.
"""

from __future__ import annotations

import base64
import json
import secrets
import sqlite3
import time
import urllib.parse
from pathlib import Path
from typing import Any, Callable

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

VAULT_MAGIC = b"SLV1"
VAULT_AAD = b"seu-luiz-vault-v1"


def decode_vault_aes_key(raw_key: str) -> bytes:
    cleaned = (raw_key or "").strip()
    if not cleaned:
        raise ValueError("Chave AES do cofre ausente.")
    if len(cleaned) == 64:
        try:
            key = bytes.fromhex(cleaned)
            if len(key) == 32:
                return key
        except ValueError:
            pass
    padded = cleaned + "=" * (-len(cleaned) % 4)
    key = base64.urlsafe_b64decode(padded)
    if len(key) != 32:
        raise ValueError("Chave AES do cofre deve possuir exatamente 32 bytes (256 bits).")
    return key


def encrypt_vault_blob(plaintext: bytes, key: bytes) -> bytes:
    if len(key) != 32:
        raise ValueError("Chave AES-256 inválida.")
    nonce = secrets.token_bytes(12)
    ct = AESGCM(key).encrypt(nonce, plaintext, VAULT_AAD)
    return VAULT_MAGIC + nonce + ct


def decrypt_vault_blob(payload: bytes, key: bytes) -> bytes:
    if len(key) != 32:
        raise ValueError("Chave AES-256 inválida.")
    if len(payload) < 4 + 12 + 16 or payload[:4] != VAULT_MAGIC:
        raise ValueError("Blob do cofre inválido ou corrompido (assinatura SLV1 ausente).")
    nonce = payload[4:16]
    ct = payload[16:]
    return AESGCM(key).decrypt(nonce, ct, VAULT_AAD)


def merge_missing_users_sqlite(base_db_path: Path, extra_db_path: Path) -> int:
    """
    Mescla em `base_db_path` quaisquer usuários recém-criados em `extra_db_path`
    (cujo `email` ainda não exista em `base_db_path`), preservando todas as suas
    contas, cartões, pessoas, módulos, lançamentos, parcelas e solicitações com
    remapeamento seguro de chaves estrangeiras.
    Retorna o número de usuários mesclados.
    """
    if not base_db_path.is_file() or not extra_db_path.is_file():
        return 0

    base_conn = sqlite3.connect(str(base_db_path), timeout=30.0)
    base_conn.row_factory = sqlite3.Row
    extra_conn = sqlite3.connect(str(extra_db_path), timeout=30.0)
    extra_conn.row_factory = sqlite3.Row

    merged_users = 0
    try:
        extra_tables = {
            r[0]
            for r in extra_conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        base_tables = {
            r[0]
            for r in base_conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        if "usuarios" not in extra_tables or "usuarios" not in base_tables:
            return 0

        existing_emails = {
            str(r["email"]).strip().lower()
            for r in base_conn.execute("SELECT email FROM usuarios").fetchall()
        }
        existing_tokens = {
            str(r[0])
            for r in base_conn.execute(
                "SELECT token_acesso FROM pessoas WHERE token_acesso IS NOT NULL AND token_acesso != ''"
            ).fetchall()
        } if "pessoas" in base_tables else set()
        extra_users = extra_conn.execute("SELECT * FROM usuarios ORDER BY id ASC").fetchall()
        new_users = [
            u for u in extra_users if str(u["email"]).strip().lower() not in existing_emails
        ]
        if not new_users:
            return 0

        def _cols(conn: sqlite3.Connection, table: str) -> list[str]:
            return [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]

        with base_conn:
            for u in new_users:
                old_uid = u["id"]
                u_cols = [c for c in _cols(base_conn, "usuarios") if c != "id" and c in u.keys()]
                cur = base_conn.execute(
                    f"INSERT INTO usuarios ({', '.join(u_cols)}) VALUES ({', '.join('?' for _ in u_cols)})",
                    [u[c] for c in u_cols],
                )
                new_uid = int(cur.lastrowid)
                merged_users += 1

                conta_map: dict[int, int] = {}
                cartao_map: dict[int, int] = {}
                pessoa_map: dict[int, int] = {}
                modulo_map: dict[int, int] = {}
                subcat_map: dict[int, int] = {}
                lanc_map: dict[int, int] = {}

                for tbl, id_map in (
                    ("contas_bancarias", conta_map),
                    ("cartoes", cartao_map),
                    ("pessoas", pessoa_map),
                    ("modulos", modulo_map),
                ):
                    if tbl not in extra_tables or tbl not in base_tables:
                        continue
                    e_cols = _cols(extra_conn, tbl)
                    if "usuario_id" not in e_cols:
                        continue
                    b_cols = [c for c in _cols(base_conn, tbl) if c != "id" and c in e_cols]
                    for row in extra_conn.execute(
                        f"SELECT * FROM {tbl} WHERE usuario_id = ? ORDER BY id ASC", (old_uid,)
                    ).fetchall():
                        vals = []
                        for c in b_cols:
                            if c == "usuario_id":
                                vals.append(new_uid)
                            elif tbl == "pessoas" and c == "token_acesso":
                                tok_val = str(row[c] or "").strip()
                                if not tok_val or tok_val in existing_tokens:
                                    tok_val = secrets.token_urlsafe(12)
                                existing_tokens.add(tok_val)
                                vals.append(tok_val)
                            else:
                                vals.append(row[c])
                        c_ins = base_conn.execute(
                            f"INSERT INTO {tbl} ({', '.join(b_cols)}) VALUES ({', '.join('?' for _ in b_cols)})",
                            vals,
                        )
                        id_map[int(row["id"])] = int(c_ins.lastrowid)

                if "subcategorias" in extra_tables and "subcategorias" in base_tables and modulo_map:
                    b_cols = [c for c in _cols(base_conn, "subcategorias") if c != "id"]
                    placeholders_mod = ",".join("?" for _ in modulo_map)
                    for row in extra_conn.execute(
                        f"SELECT * FROM subcategorias WHERE modulo_id IN ({placeholders_mod}) ORDER BY id ASC",
                        list(modulo_map.keys()),
                    ).fetchall():
                        vals = [
                            modulo_map[int(row["modulo_id"])] if c == "modulo_id" else row[c]
                            for c in b_cols
                        ]
                        c_ins = base_conn.execute(
                            f"INSERT INTO subcategorias ({', '.join(b_cols)}) VALUES ({', '.join('?' for _ in b_cols)})",
                            vals,
                        )
                        subcat_map[int(row["id"])] = int(c_ins.lastrowid)

                if "lancamentos" in extra_tables and "lancamentos" in base_tables:
                    e_cols = _cols(extra_conn, "lancamentos")
                    if "usuario_id" in e_cols:
                        b_cols = [c for c in _cols(base_conn, "lancamentos") if c != "id" and c in e_cols]
                        for row in extra_conn.execute(
                            "SELECT * FROM lancamentos WHERE usuario_id = ? ORDER BY id ASC",
                            (old_uid,),
                        ).fetchall():
                            vals = []
                            for c in b_cols:
                                v = row[c]
                                if c == "usuario_id":
                                    v = new_uid
                                elif c == "cartao_id" and v is not None:
                                    v = cartao_map.get(int(v))
                                elif c == "conta_id" and v is not None:
                                    v = conta_map.get(int(v))
                                elif c == "conta_destino_id" and v is not None:
                                    v = conta_map.get(int(v))
                                elif c == "pessoa_id" and v is not None:
                                    v = pessoa_map.get(int(v))
                                elif c == "modulo_id" and v is not None:
                                    v = modulo_map.get(int(v))
                                elif c == "subcategoria_id" and v is not None:
                                    v = subcat_map.get(int(v))
                                vals.append(v)
                            c_ins = base_conn.execute(
                                f"INSERT INTO lancamentos ({', '.join(b_cols)}) VALUES ({', '.join('?' for _ in b_cols)})",
                                vals,
                            )
                            lanc_map[int(row["id"])] = int(c_ins.lastrowid)

                if "parcelas" in extra_tables and "parcelas" in base_tables and lanc_map:
                    b_cols = [c for c in _cols(base_conn, "parcelas") if c != "id"]
                    ph_l = ",".join("?" for _ in lanc_map)
                    for row in extra_conn.execute(
                        f"SELECT * FROM parcelas WHERE lancamento_id IN ({ph_l}) ORDER BY id ASC",
                        list(lanc_map.keys()),
                    ).fetchall():
                        vals = [
                            lanc_map[int(row["lancamento_id"])] if c == "lancamento_id" else row[c]
                            for c in b_cols
                        ]
                        base_conn.execute(
                            f"INSERT INTO parcelas ({', '.join(b_cols)}) VALUES ({', '.join('?' for _ in b_cols)})",
                            vals,
                        )

                if "pagamentos_pessoa" in extra_tables and "pagamentos_pessoa" in base_tables:
                    e_cols = _cols(extra_conn, "pagamentos_pessoa")
                    if "usuario_id" in e_cols:
                        b_cols = [c for c in _cols(base_conn, "pagamentos_pessoa") if c != "id" and c in e_cols]
                        for row in extra_conn.execute(
                            "SELECT * FROM pagamentos_pessoa WHERE usuario_id = ? ORDER BY id ASC",
                            (old_uid,),
                        ).fetchall():
                            if int(row["pessoa_id"]) not in pessoa_map:
                                continue
                            vals = []
                            for c in b_cols:
                                v = row[c]
                                if c == "usuario_id":
                                    v = new_uid
                                elif c == "pessoa_id":
                                    v = pessoa_map[int(v)]
                                elif c == "conta_id" and v is not None:
                                    v = conta_map.get(int(v))
                                vals.append(v)
                            base_conn.execute(
                                f"INSERT INTO pagamentos_pessoa ({', '.join(b_cols)}) VALUES ({', '.join('?' for _ in b_cols)})",
                                vals,
                            )

                if "pagamentos_fatura" in extra_tables and "pagamentos_fatura" in base_tables:
                    e_cols = _cols(extra_conn, "pagamentos_fatura")
                    if "usuario_id" in e_cols:
                        b_cols = [c for c in _cols(base_conn, "pagamentos_fatura") if c != "id" and c in e_cols]
                        for row in extra_conn.execute(
                            "SELECT * FROM pagamentos_fatura WHERE usuario_id = ? ORDER BY id ASC",
                            (old_uid,),
                        ).fetchall():
                            if int(row["cartao_id"]) not in cartao_map:
                                continue
                            vals = []
                            for c in b_cols:
                                v = row[c]
                                if c == "usuario_id":
                                    v = new_uid
                                elif c == "cartao_id":
                                    v = cartao_map[int(v)]
                                elif c == "conta_id" and v is not None:
                                    v = conta_map.get(int(v))
                                vals.append(v)
                            base_conn.execute(
                                f"INSERT INTO pagamentos_fatura ({', '.join(b_cols)}) VALUES ({', '.join('?' for _ in b_cols)})",
                                vals,
                            )

                if "solicitacoes_lancamento" in extra_tables and "solicitacoes_lancamento" in base_tables:
                    e_cols = _cols(extra_conn, "solicitacoes_lancamento")
                    if "usuario_id" in e_cols:
                        b_cols = [
                            c for c in _cols(base_conn, "solicitacoes_lancamento") if c != "id" and c in e_cols
                        ]
                        for row in extra_conn.execute(
                            "SELECT * FROM solicitacoes_lancamento WHERE usuario_id = ? ORDER BY id ASC",
                            (old_uid,),
                        ).fetchall():
                            if int(row["pessoa_id"]) not in pessoa_map:
                                continue
                            vals = []
                            for c in b_cols:
                                v = row[c]
                                if c == "usuario_id":
                                    v = new_uid
                                elif c == "pessoa_id":
                                    v = pessoa_map[int(v)]
                                elif c == "cartao_id" and v is not None:
                                    v = cartao_map.get(int(v))
                                elif c == "lancamento_id" and v is not None:
                                    v = lanc_map.get(int(v))
                                vals.append(v)
                            base_conn.execute(
                                f"INSERT INTO solicitacoes_lancamento ({', '.join(b_cols)}) VALUES ({', '.join('?' for _ in b_cols)})",
                                vals,
                            )

        return merged_users
    finally:
        extra_conn.close()
        base_conn.close()


class GitHubEncryptedVaultClient:
    """Cliente REST Git Data API para armazenamento atômico criptografado em repositório privado."""

    def __init__(
        self,
        *,
        token: str,
        repo: str,
        aes_key: bytes,
        branch: str = "main",
        http_transport: Callable[..., tuple[int, dict[str, str], bytes]],
    ) -> None:
        self.token = token.strip()
        self.repo = repo.strip().strip("/")
        self.aes_key = aes_key
        self.branch = (branch or "main").strip()
        self._http = http_transport

    @property
    def repo_url(self) -> str:
        return f"https://github.com/{self.repo}"

    def _request(
        self,
        method: str,
        path: str,
        *,
        json_body: dict[str, Any] | None = None,
        allow_404: bool = False,
        timeout: float = 40.0,
    ) -> tuple[int, dict[str, Any]]:
        url = f"https://api.github.com/repos/{self.repo}{path}"
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "AdministracaoFinanceira-Vault/2.1",
        }
        body_bytes = None
        if json_body is not None:
            body_bytes = json.dumps(json_body, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json; charset=utf-8"

        last_exc: Exception | None = None
        for attempt in range(3):
            try:
                status_code, _, resp_body = self._http(
                    method, url, headers=headers, data=body_bytes, timeout=timeout
                )
            except Exception as exc:
                last_exc = exc
                if attempt < 2:
                    time.sleep(0.7 * (attempt + 1))
                    continue
                raise RuntimeError(f"Erro de rede ao comunicar com o cofre em nuvem: {exc}") from exc

            if allow_404 and status_code in (404, 409):
                return status_code, {}
            if status_code in (429, 500, 502, 503, 504) and attempt < 2:
                time.sleep(0.9 * (attempt + 1))
                continue
            if status_code >= 400:
                snippet = resp_body.decode("utf-8", errors="replace")[:240]
                raise RuntimeError(f"Cofre em nuvem respondeu HTTP {status_code}: {snippet}")
            parsed = json.loads(resp_body.decode("utf-8")) if resp_body else {}
            return status_code, parsed

        raise RuntimeError(f"Falha inesperada no cofre em nuvem: {last_exc}")

    def verify_repo_access(self) -> dict[str, Any]:
        _, info = self._request("GET", "", timeout=20.0)
        return info

    def read_branch_state(self) -> dict[str, Any] | None:
        code, ref_obj = self._request(
            "GET", f"/git/ref/heads/{urllib.parse.quote(self.branch)}", allow_404=True
        )
        if code in (404, 409) or not ref_obj.get("object"):
            return None
        commit_sha = str(ref_obj["object"]["sha"])
        _, commit_obj = self._request("GET", f"/git/commits/{commit_sha}")
        tree_sha = str(commit_obj["tree"]["sha"])
        parents = [str(p["sha"]) for p in (commit_obj.get("parents") or [])]
        _, tree_obj = self._request("GET", f"/git/trees/{tree_sha}?recursive=1")
        blobs: dict[str, dict[str, Any]] = {}
        for item in tree_obj.get("tree") or []:
            if item.get("type") == "blob" and item.get("path") and item.get("sha"):
                blobs[str(item["path"])] = {
                    "sha": str(item["sha"]),
                    "size": int(item.get("size") or 0),
                }
        return {
            "commit_sha": commit_sha,
            "parents": parents,
            "blobs": blobs,
        }

    def download_decrypted(self, blob_sha: str) -> bytes:
        _, blob_obj = self._request("GET", f"/git/blobs/{blob_sha}", timeout=90.0)
        b64_raw = str(blob_obj.get("content") or "").replace("\n", "").replace("\r", "")
        enc_bytes = base64.b64decode(b64_raw)
        return decrypt_vault_blob(enc_bytes, self.aes_key)

    def upload_encrypted(self, plaintext: bytes) -> str:
        enc_bytes = encrypt_vault_blob(plaintext, self.aes_key)
        payload = {
            "content": base64.b64encode(enc_bytes).decode("ascii"),
            "encoding": "base64",
        }
        code, created = self._request("POST", "/git/blobs", json_body=payload, allow_404=True, timeout=90.0)
        if code == 409:
            self._request(
                "PUT",
                "/contents/.vault_init",
                json_body={
                    "message": "init encrypted vault",
                    "content": base64.b64encode(b"SLV1-VAULT\n").decode("ascii"),
                    "branch": self.branch,
                },
            )
            _, created = self._request("POST", "/git/blobs", json_body=payload, timeout=90.0)
        return str(created["sha"])

    def commit_tree(
        self,
        *,
        blob_entries: dict[str, str],
        prev_state: dict[str, Any] | None,
        rotate_parent: bool,
        message: str,
    ) -> str:
        tree_items = [
            {"path": p, "mode": "100644", "type": "blob", "sha": sha}
            for p, sha in sorted(blob_entries.items())
        ]
        _, new_tree = self._request("POST", "/git/trees", json_body={"tree": tree_items})

        parents: list[str] = []
        if prev_state:
            if rotate_parent:
                parents = [prev_state["commit_sha"]]
            else:
                parents = list(prev_state["parents"])[:1]

        _, new_commit = self._request(
            "POST",
            "/git/commits",
            json_body={
                "message": message,
                "tree": str(new_tree["sha"]),
                "parents": parents,
            },
        )
        new_sha = str(new_commit["sha"])

        if prev_state is None:
            # Tenta criar a referência; se o repositório acabou de ser inicializado com README, faz PATCH forçado
            code, _ = self._request(
                "POST",
                "/git/refs",
                json_body={"ref": f"refs/heads/{self.branch}", "sha": new_sha},
                allow_404=True,
            )
            if code in (404, 409, 422):
                self._request(
                    "PATCH",
                    f"/git/refs/heads/{urllib.parse.quote(self.branch)}",
                    json_body={"sha": new_sha, "force": True},
                )
        else:
            self._request(
                "PATCH",
                f"/git/refs/heads/{urllib.parse.quote(self.branch)}",
                json_body={"sha": new_sha, "force": True},
            )
        return new_sha
