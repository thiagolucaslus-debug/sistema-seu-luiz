"""
Ponte de Sincronização Bidirecional Desktop (SQLite Local) <-> Hub em Nuvem (Render).

Garantias:
- Login/Cadastro unificados (`usuario` + `senha`): qualquer perfil criado no PC funciona
  imediatamente no celular (`https://sistema-seu-luiz.onrender.com`) e vice-versa, em qualquer PC.
- Isolamento estrito por `usuario_id`: cada usuário sincroniza apenas sua própria fatia e mídias.
- Resiliência Offline: se o PC estiver sem internet, grava no SQLite local e enfileira em
  `offline_outbox.json`, sincronizando automaticamente assim que a conexão retornar.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import os
import secrets
import sqlite3
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable

from jose import JWTError, jwt

import auth
import models
from routers.sync_hub import compute_sync_proof
from services.cloud_sync import DEFAULT_RENDER_URL, _atomic_write_bytes, _atomic_write_json, _read_json_safe

SYNCED_AUTH_MUTATIONS = {"/auth/senha", "/auth/perfil", "/auth/perfil/foto"}
READONLY_POST_PATHS = {"/dividas/simular"}
SYNCED_PREFIXES = (
    "/contas",
    "/cartoes",
    "/pessoas",
    "/modulos",
    "/lancamentos",
    "/dividas",
    "/relatorios",
    "/solicitacoes",
)


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(256 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _default_hub_http(
    method: str,
    url: str,
    headers: dict[str, str] | None = None,
    data: bytes | None = None,
    timeout: float = 12.0,
) -> tuple[int, dict[str, str], bytes]:
    req = urllib.request.Request(
        url,
        data=data,
        headers=headers or {},
        method=method.upper(),
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return int(resp.status), {k: v for k, v in resp.headers.items()}, resp.read()
    except urllib.error.HTTPError as err:
        hdrs = {k: v for k, v in err.headers.items()} if err.headers else {}
        body = err.read() if err.fp else b""
        return int(err.code), hdrs, body


class HubUnreachableError(RuntimeError):
    """Sinaliza indisponibilidade temporária de rede ou manutenção 5xx no hub remoto."""


class HubSyncClient:
    def __init__(
        self,
        *,
        data_dir: str | Path,
        db_path: str | Path,
        hub_url: str | None = None,
        http_transport: Callable[..., tuple[int, dict[str, str], bytes]] | None = None,
        enabled: bool | None = None,
        version_poll_interval_sec: float = 2.5,
        offline_cooldown_sec: float = 8.0,
    ) -> None:
        self.data_dir = Path(data_dir).resolve()
        self.db_path = Path(db_path).resolve()
        self.uploads_dir = self.data_dir / "uploads"
        self.uploads_dir.mkdir(parents=True, exist_ok=True)

        self.sessions_path = self.data_dir / ".hub_sessions.json"
        self.outbox_path = self.data_dir / "offline_outbox.json"

        self.hub_url = (
            hub_url
            or os.environ.get("SEU_LUIZ_HUB_URL")
            or DEFAULT_RENDER_URL
        ).rstrip("/")
        self._http = http_transport or _default_hub_http
        self._explicit_enabled = enabled
        self.version_poll_interval_sec = float(version_poll_interval_sec)
        self.offline_cooldown_sec = float(offline_cooldown_sec)

        self._lock = threading.RLock()
        self._sessions: dict[str, str] = _read_json_safe(self.sessions_path).get("tokens") or {}
        self._last_poll_by_user: dict[str, float] = {}
        self._offline_until: float = 0.0

    def is_enabled(self) -> bool:
        if self._explicit_enabled is not None:
            return bool(self._explicit_enabled)
        if os.environ.get("RENDER") or os.environ.get("RENDER_SERVICE_ID"):
            return False
        if os.environ.get("SEU_LUIZ_DISABLE_HUB_SYNC") == "1":
            return False
        return os.environ.get("SEU_LUIZ_DESKTOP_MODE") == "1"

    def _save_sessions(self) -> None:
        with self._lock:
            _atomic_write_json(self.sessions_path, {"tokens": self._sessions}, private=True)

    def _load_outbox(self) -> list[dict[str, Any]]:
        data = _read_json_safe(self.outbox_path)
        items = data.get("items")
        return list(items) if isinstance(items, list) else []

    def _save_outbox(self, items: list[dict[str, Any]]) -> None:
        _atomic_write_json(self.outbox_path, {"items": items}, private=True)

    def enqueue_offline_mutation(
        self,
        *,
        usuario: str,
        method: str,
        path: str,
        query: str,
        content_type: str,
        raw_body: bytes,
        local_created_id: int | None = None,
        entity_kind: str | None = None,
        local_parcelas: list[dict[str, Any]] | None = None,
    ) -> None:
        with self._lock:
            items = self._load_outbox()
            entry: dict[str, Any] = {
                "id": secrets.token_hex(8),
                "usuario": usuario.strip().lower(),
                "method": method.upper(),
                "path": path,
                "query": query,
                "content_type": content_type,
                "body_b64": base64.b64encode(raw_body).decode("ascii"),
                "local_created_id": local_created_id,
                "entity_kind": entity_kind,
                "created_at": time.time(),
            }
            if local_parcelas:
                entry["local_parcelas"] = local_parcelas
            items.append(entry)
            self._save_outbox(items)

    def _request_hub(
        self,
        method: str,
        path_and_query: str,
        *,
        headers: dict[str, str] | None = None,
        data: bytes | None = None,
        json_body: dict[str, Any] | None = None,
        timeout: float = 12.0,
    ) -> tuple[int, dict[str, str], bytes]:
        url = f"{self.hub_url}{path_and_query}"
        req_headers = {"User-Agent": "AdministracaoFinanceira-Desktop/2.1"}
        if headers:
            req_headers.update(headers)
        payload = data
        if json_body is not None:
            payload = json.dumps(json_body, ensure_ascii=False).encode("utf-8")
            req_headers["Content-Type"] = "application/json; charset=utf-8"

        try:
            code, resp_hdrs, resp_body = self._http(
                method, url, headers=req_headers, data=payload, timeout=timeout
            )
        except Exception as exc:
            with self._lock:
                self._offline_until = time.monotonic() + self.offline_cooldown_sec
            raise HubUnreachableError(f"Hub indisponível: {exc}") from exc

        if code in (502, 503, 504):
            with self._lock:
                self._offline_until = time.monotonic() + self.offline_cooldown_sec
            raise HubUnreachableError(f"Hub temporariamente indisponível (HTTP {code}).")

        with self._lock:
            self._offline_until = 0.0
        return code, resp_hdrs, resp_body

    # =========================================================================
    # Leitura e Aplicação Atômica da Fatia SQLite por Usuário
    # =========================================================================

    def get_local_user_by_email(self, email: str) -> dict[str, Any] | None:
        if not self.db_path.is_file():
            return None
        conn = sqlite3.connect(str(self.db_path), timeout=15.0)
        conn.row_factory = sqlite3.Row
        try:
            row = conn.execute(
                "SELECT id, nome, email, senha_hash, logo_path, sync_rev FROM usuarios WHERE email = ? LIMIT 1",
                (email.strip().lower(),),
            ).fetchone()
            return dict(row) if row else None
        except Exception:
            return None
        finally:
            conn.close()

    def count_local_users(self) -> int:
        if not self.db_path.is_file():
            return 0
        conn = sqlite3.connect(str(self.db_path), timeout=10.0)
        try:
            row = conn.execute("SELECT COUNT(*) FROM usuarios").fetchone()
            return int(row[0] if row else 0)
        except Exception:
            return 0
        finally:
            conn.close()

    def _ensure_hub_token(self, local_user: dict[str, Any], force_refresh: bool = False) -> str:
        email = str(local_user["email"]).strip().lower()
        with self._lock:
            cached = self._sessions.get(email)
        if cached and not force_refresh:
            return cached

        ts = int(time.time())
        senha_hash = str(local_user["senha_hash"])
        proof = compute_sync_proof(senha_hash, email, ts)
        code, _, body = self._request_hub(
            "POST",
            "/sync/session",
            json_body={
                "usuario": email,
                "timestamp": ts,
                "proof": proof,
                "nome": local_user.get("nome") or email,
                "senha_hash": senha_hash,
                "auto_provision": True,
            },
            timeout=10.0,
        )
        if code != 200:
            detail = "Falha ao autenticar sessão de sincronização."
            try:
                detail = json.loads(body.decode("utf-8")).get("detail") or detail
            except Exception:
                pass
            raise RuntimeError(detail)

        tok = str(json.loads(body.decode("utf-8"))["access_token"])
        with self._lock:
            self._sessions[email] = tok
            self._save_sessions()
        return tok

    def apply_user_snapshot(self, snapshot: dict[str, Any], render_token: str) -> dict[str, Any]:
        """Aplica atomicamente a fatia do usuário no SQLite local e baixa uploads ausentes."""
        u_remote = snapshot["usuario"]
        email = str(u_remote["email"]).strip().lower()

        with self._lock:
            conn = sqlite3.connect(str(self.db_path), timeout=30.0)
            conn.row_factory = sqlite3.Row
            try:
                conn.execute("PRAGMA foreign_keys = OFF;")

                def _table_cols(tbl: str) -> list[str]:
                    return [r[1] for r in conn.execute(f"PRAGMA table_info({tbl})").fetchall()]

                def _pk_taken(tbl: str, pk_val: int) -> bool:
                    return (
                        conn.execute(f"SELECT 1 FROM {tbl} WHERE id = ? LIMIT 1", (pk_val,)).fetchone()
                        is not None
                    )

                tbl_to_kind = {
                    "contas_bancarias": "conta",
                    "cartoes": "cartao",
                    "pessoas": "pessoa",
                    "modulos": "modulo",
                    "subcategorias": "subcategoria",
                    "lancamentos": "lancamento",
                    "pagamentos_pessoa": "pagamento_pessoa",
                    "dividas": "divida",
                    "divida_parcelas": "divida_parcela",
                }

                def _rewrite_outbox_local_id(owner_email: str | None, kind: str, old_id: int, new_id: int) -> None:
                    if not owner_email or not kind:
                        return
                    items = self._load_outbox()
                    if not items:
                        return
                    changed = False
                    prefix_map = {
                        "conta": "/contas/",
                        "cartao": "/cartoes/",
                        "pessoa": "/pessoas/",
                        "modulo": "/modulos/",
                        "lancamento": "/lancamentos/",
                        "divida": "/dividas/",
                    }
                    fk_fields_map = {
                        "conta": ("conta_id", "conta_destino_id", "conta_padrao_id"),
                        "cartao": ("cartao_id",),
                        "pessoa": ("pessoa_id",),
                        "modulo": ("modulo_id",),
                        "subcategoria": ("subcategoria_id",),
                        "divida": ("divida_id",),
                        "divida_parcela": ("parcela_id",),
                    }
                    for it in items:
                        if it.get("usuario") != owner_email:
                            continue
                        if it.get("entity_kind") == kind and it.get("local_created_id") == old_id:
                            it["local_created_id"] = new_id
                            changed = True
                        if kind == "divida_parcela" and isinstance(it.get("local_parcelas"), list):
                            for lp in it["local_parcelas"]:
                                if isinstance(lp, dict) and lp.get("parcela_id") == old_id:
                                    lp["parcela_id"] = new_id
                                    changed = True
                        pfx = prefix_map.get(kind)
                        p_str = str(it.get("path") or "")
                        if pfx and p_str.startswith(pfx):
                            rest = p_str[len(pfx):]
                            seg = rest.split("/", 1)[0]
                            if seg.isdigit() and int(seg) == old_id:
                                suffix = ("/" + rest.split("/", 1)[1]) if "/" in rest else ""
                                it["path"] = f"{pfx}{new_id}{suffix}"
                                changed = True
                        if kind == "pagamento_pessoa" and p_str.startswith("/pessoas/") and "/pagamento/" in p_str:
                            head_p, pag_seg = p_str.rsplit("/pagamento/", 1)
                            if pag_seg.isdigit() and int(pag_seg) == old_id:
                                it["path"] = f"{head_p}/pagamento/{new_id}"
                                changed = True
                        ct_str = str(it.get("content_type") or "").lower()
                        b64_str = str(it.get("body_b64") or "")
                        if "application/json" in ct_str and b64_str and kind in fk_fields_map:
                            try:
                                j_obj = json.loads(base64.b64decode(b64_str).decode("utf-8"))
                                if isinstance(j_obj, dict):
                                    j_mod = False
                                    for fk_f in fk_fields_map[kind]:
                                        if j_obj.get(fk_f) == old_id:
                                            j_obj[fk_f] = new_id
                                            j_mod = True
                                    if j_mod:
                                        raw_new = json.dumps(j_obj, ensure_ascii=False).encode("utf-8")
                                        it["body_b64"] = base64.b64encode(raw_new).decode("ascii")
                                        changed = True
                            except Exception:
                                pass
                    if changed:
                        self._save_outbox(items)

                def _vacate_conflicting_pk(tbl: str, conflict_id: int) -> None:
                    if not _pk_taken(tbl, conflict_id):
                        return
                    cols = _table_cols(tbl)
                    owner_email: str | None = None
                    if "usuario_id" in cols:
                        r_own = conn.execute(
                            f"SELECT u.email FROM {tbl} t JOIN usuarios u ON u.id = t.usuario_id WHERE t.id = ? LIMIT 1",
                            (conflict_id,),
                        ).fetchone()
                        if r_own and r_own[0]:
                            owner_email = str(r_own[0]).strip().lower()
                    elif tbl == "subcategorias":
                        r_own = conn.execute(
                            "SELECT u.email FROM subcategorias s JOIN modulos m ON m.id = s.modulo_id JOIN usuarios u ON u.id = m.usuario_id WHERE s.id = ? LIMIT 1",
                            (conflict_id,),
                        ).fetchone()
                        if r_own and r_own[0]:
                            owner_email = str(r_own[0]).strip().lower()

                    max_row = conn.execute(f"SELECT COALESCE(MAX(id), 0) FROM {tbl}").fetchone()
                    new_id = max(int(max_row[0] if max_row else 0) + 1, 900000)
                    while _pk_taken(tbl, new_id):
                        new_id += 1

                    conn.execute(f"UPDATE {tbl} SET id = ? WHERE id = ?", (new_id, conflict_id))
                    fk_updates: dict[str, list[tuple[str, str]]] = {
                        "contas_bancarias": [
                            ("lancamentos", "conta_id"),
                            ("lancamentos", "conta_destino_id"),
                            ("pagamentos_pessoa", "conta_id"),
                            ("pagamentos_fatura", "conta_id"),
                            ("dividas", "conta_padrao_id"),
                            ("divida_parcelas", "conta_id"),
                        ],
                        "cartoes": [
                            ("lancamentos", "cartao_id"),
                            ("pagamentos_fatura", "cartao_id"),
                            ("solicitacoes_lancamento", "cartao_id"),
                        ],
                        "pessoas": [
                            ("lancamentos", "pessoa_id"),
                            ("pagamentos_pessoa", "pessoa_id"),
                            ("solicitacoes_lancamento", "pessoa_id"),
                        ],
                        "modulos": [
                            ("subcategorias", "modulo_id"),
                            ("lancamentos", "modulo_id"),
                            ("dividas", "modulo_id"),
                        ],
                        "subcategorias": [
                            ("lancamentos", "subcategoria_id"),
                        ],
                        "lancamentos": [
                            ("parcelas", "lancamento_id"),
                            ("solicitacoes_lancamento", "lancamento_id"),
                            ("divida_parcelas", "lancamento_id"),
                        ],
                        "dividas": [
                            ("divida_parcelas", "divida_id"),
                        ],
                    }
                    for child_tbl, fk_col in fk_updates.get(tbl, []):
                        if fk_col in _table_cols(child_tbl):
                            conn.execute(
                                f"UPDATE {child_tbl} SET {fk_col} = ? WHERE {fk_col} = ?",
                                (new_id, conflict_id),
                            )
                    _rewrite_outbox_local_id(owner_email, tbl_to_kind.get(tbl, ""), conflict_id, new_id)

                with conn:
                    existing_u = conn.execute(
                        "SELECT id FROM usuarios WHERE email = ? LIMIT 1", (email,)
                    ).fetchone()
                    if existing_u:
                        local_uid = int(existing_u["id"])
                        conn.execute(
                            """
                            UPDATE usuarios
                               SET nome = ?, senha_hash = ?, logo_path = ?, sync_rev = ?
                             WHERE id = ?
                            """,
                            (
                                u_remote["nome"],
                                u_remote["senha_hash"],
                                u_remote.get("logo_path"),
                                int(u_remote.get("sync_rev") or 1),
                                local_uid,
                            ),
                        )
                    else:
                        want_uid = int(u_remote["id"])
                        if not _pk_taken("usuarios", want_uid):
                            conn.execute(
                                """
                                INSERT INTO usuarios (id, nome, email, senha_hash, logo_path, sync_rev)
                                VALUES (?, ?, ?, ?, ?, ?)
                                """,
                                (
                                    want_uid,
                                    u_remote["nome"],
                                    email,
                                    u_remote["senha_hash"],
                                    u_remote.get("logo_path"),
                                    int(u_remote.get("sync_rev") or 1),
                                ),
                            )
                            local_uid = want_uid
                        else:
                            cur = conn.execute(
                                """
                                INSERT INTO usuarios (nome, email, senha_hash, logo_path, sync_rev)
                                VALUES (?, ?, ?, ?, ?)
                                """,
                                (
                                    u_remote["nome"],
                                    email,
                                    u_remote["senha_hash"],
                                    u_remote.get("logo_path"),
                                    int(u_remote.get("sync_rev") or 1),
                                ),
                            )
                            local_uid = int(cur.lastrowid)

                    # Limpa apenas a fatia anterior deste usuário (ordem filho -> pai)
                    if _table_cols("divida_parcelas") and _table_cols("dividas"):
                        conn.execute(
                            "DELETE FROM divida_parcelas WHERE divida_id IN (SELECT id FROM dividas WHERE usuario_id = ?) OR usuario_id = ?",
                            (local_uid, local_uid),
                        )
                    conn.execute(
                        "DELETE FROM parcelas WHERE lancamento_id IN (SELECT id FROM lancamentos WHERE usuario_id = ?)",
                        (local_uid,),
                    )
                    conn.execute(
                        "DELETE FROM subcategorias WHERE modulo_id IN (SELECT id FROM modulos WHERE usuario_id = ?)",
                        (local_uid,),
                    )
                    for tbl in (
                        "dividas",
                        "solicitacoes_lancamento",
                        "pagamentos_pessoa",
                        "pagamentos_fatura",
                        "lancamentos",
                        "modulos",
                        "pessoas",
                        "cartoes",
                        "contas_bancarias",
                    ):
                        if _table_cols(tbl):
                            conn.execute(f"DELETE FROM {tbl} WHERE usuario_id = ?", (local_uid,))

                    conta_map: dict[int, int] = {}
                    cartao_map: dict[int, int] = {}
                    pessoa_map: dict[int, int] = {}
                    modulo_map: dict[int, int] = {}
                    subcat_map: dict[int, int] = {}
                    lanc_map: dict[int, int] = {}
                    divida_map: dict[int, int] = {}

                    def _insert_rows(
                        tbl: str,
                        rows: list[dict[str, Any]],
                        id_map: dict[int, int] | None = None,
                        fk_rewrites: dict[str, dict[int, int]] | None = None,
                        has_usuario_id: bool = True,
                    ) -> None:
                        if not rows:
                            return
                        cols = _table_cols(tbl)
                        for raw in rows:
                            r = dict(raw)
                            orig_id = int(r["id"])
                            if has_usuario_id and "usuario_id" in cols:
                                r["usuario_id"] = local_uid
                            if fk_rewrites:
                                for fk_col, mapping in fk_rewrites.items():
                                    if r.get(fk_col) is not None:
                                        r[fk_col] = mapping.get(int(r[fk_col]), r[fk_col])

                            # Evita conflito de token_acesso único se houver lixo órfão
                            if tbl == "pessoas" and r.get("token_acesso"):
                                conn.execute(
                                    "UPDATE pessoas SET token_acesso = NULL WHERE token_acesso = ? AND usuario_id IS NULL",
                                    (r["token_acesso"],),
                                )

                            # Realoca qualquer registro offline colidente de outro usuário local para preservar 1:1 o ID canônico do Hub
                            _vacate_conflicting_pk(tbl, orig_id)
                            use_explicit_id = not _pk_taken(tbl, orig_id)
                            ins_cols = [
                                c for c in cols if (use_explicit_id or c != "id") and c in r
                            ]
                            cur_i = conn.execute(
                                f"INSERT INTO {tbl} ({', '.join(ins_cols)}) VALUES ({', '.join('?' for _ in ins_cols)})",
                                [r[c] for c in ins_cols],
                            )
                            actual_id = orig_id if use_explicit_id else int(cur_i.lastrowid)
                            if id_map is not None:
                                id_map[orig_id] = actual_id

                    _insert_rows("contas_bancarias", snapshot.get("contas_bancarias") or [], conta_map)
                    _insert_rows("cartoes", snapshot.get("cartoes") or [], cartao_map)
                    _insert_rows("pessoas", snapshot.get("pessoas") or [], pessoa_map)
                    _insert_rows("modulos", snapshot.get("modulos") or [], modulo_map)
                    _insert_rows(
                        "subcategorias",
                        snapshot.get("subcategorias") or [],
                        subcat_map,
                        fk_rewrites={"modulo_id": modulo_map},
                        has_usuario_id=False,
                    )
                    _insert_rows(
                        "lancamentos",
                        snapshot.get("lancamentos") or [],
                        lanc_map,
                        fk_rewrites={
                            "cartao_id": cartao_map,
                            "conta_id": conta_map,
                            "conta_destino_id": conta_map,
                            "pessoa_id": pessoa_map,
                            "modulo_id": modulo_map,
                            "subcategoria_id": subcat_map,
                        },
                    )
                    _insert_rows(
                        "parcelas",
                        snapshot.get("parcelas") or [],
                        None,
                        fk_rewrites={"lancamento_id": lanc_map},
                        has_usuario_id=False,
                    )
                    _insert_rows(
                        "pagamentos_pessoa",
                        snapshot.get("pagamentos_pessoa") or [],
                        None,
                        fk_rewrites={"pessoa_id": pessoa_map, "conta_id": conta_map},
                    )
                    _insert_rows(
                        "pagamentos_fatura",
                        snapshot.get("pagamentos_fatura") or [],
                        None,
                        fk_rewrites={"cartao_id": cartao_map, "conta_id": conta_map},
                    )
                    _insert_rows(
                        "solicitacoes_lancamento",
                        snapshot.get("solicitacoes_lancamento") or [],
                        None,
                        fk_rewrites={
                            "pessoa_id": pessoa_map,
                            "cartao_id": cartao_map,
                            "lancamento_id": lanc_map,
                        },
                    )
                    if _table_cols("dividas"):
                        _insert_rows(
                            "dividas",
                            snapshot.get("dividas") or [],
                            divida_map,
                            fk_rewrites={
                                "conta_padrao_id": conta_map,
                                "modulo_id": modulo_map,
                            },
                        )
                    if _table_cols("divida_parcelas"):
                        _insert_rows(
                            "divida_parcelas",
                            snapshot.get("divida_parcelas") or [],
                            None,
                            fk_rewrites={
                                "divida_id": divida_map,
                                "conta_id": conta_map,
                                "lancamento_id": lanc_map,
                            },
                        )

                final_row = conn.execute(
                    "SELECT id, nome, email, senha_hash, logo_path, sync_rev FROM usuarios WHERE id = ?",
                    (local_uid,),
                ).fetchone()
                local_user_dict = dict(final_row)
            finally:
                conn.close()

        # Sincroniza mídias referenciadas por este usuário (fotos e comprovantes)
        for up in snapshot.get("uploads") or []:
            fname = Path(str(up.get("filename") or "")).name
            if not fname or fname in (".", ".."):
                continue
            target = self.uploads_dir / fname
            want_sha = str(up.get("sha256") or "")
            if target.is_file() and want_sha and _sha256_file(target) == want_sha:
                continue
            try:
                u_code, _, u_bytes = self._request_hub(
                    "GET",
                    f"/sync/uploads/{urllib.parse.quote(fname)}",
                    headers={"Authorization": f"Bearer {render_token}"},
                    timeout=30.0,
                )
                if u_code == 200 and u_bytes:
                    _atomic_write_bytes(target, u_bytes)
            except Exception:
                pass

        with self._lock:
            self._last_poll_by_user[email] = time.monotonic()
        return local_user_dict

    def pull_user_snapshot(self, render_token: str) -> dict[str, Any]:
        code, _, body = self._request_hub(
            "GET",
            "/sync/snapshot",
            headers={"Authorization": f"Bearer {render_token}"},
            timeout=20.0,
        )
        if code != 200:
            raise RuntimeError(f"Falha ao obter snapshot do usuário (HTTP {code}).")
        snap = json.loads(body.decode("utf-8"))
        return self.apply_user_snapshot(snap, render_token)

    # =========================================================================
    # Replay Automático da Fila Offline (offline_outbox.json)
    # =========================================================================

    def _replay_outbox_for_user(self, local_user: dict[str, Any], render_token: str) -> tuple[bool, str]:
        email = str(local_user["email"]).strip().lower()
        with self._lock:
            all_items = self._load_outbox()
            user_items = [it for it in all_items if it.get("usuario") == email]
            other_items = [it for it in all_items if it.get("usuario") != email]

        if not user_items:
            return False, render_token

        id_remaps: dict[str, dict[int, int]] = {
            "conta": {},
            "cartao": {},
            "pessoa": {},
            "modulo": {},
            "subcategoria": {},
            "lancamento": {},
            "pagamento_pessoa": {},
            "divida": {},
            "divida_parcela": {},
        }
        remaining_for_user: list[dict[str, Any]] = []
        current_tok = render_token
        drained_any = False

        for idx, item in enumerate(user_items):
            raw_body = base64.b64decode(item.get("body_b64") or "")
            ct = str(item.get("content_type") or "")
            path = str(item.get("path") or "")
            query = str(item.get("query") or "")
            method = str(item.get("method") or "POST")

            # Remapeia chaves estrangeiras e IDs de rota criados temporariamente em modo offline
            for kind, prefix in (
                ("conta", "/contas/"),
                ("cartao", "/cartoes/"),
                ("pessoa", "/pessoas/"),
                ("modulo", "/modulos/"),
                ("lancamento", "/lancamentos/"),
                ("divida", "/dividas/"),
            ):
                if path.startswith(prefix):
                    rest = path[len(prefix) :]
                    seg = rest.split("/", 1)[0]
                    if seg.isdigit() and int(seg) in id_remaps[kind]:
                        new_seg = str(id_remaps[kind][int(seg)])
                        suffix = ("/" + rest.split("/", 1)[1]) if "/" in rest else ""
                        path = f"{prefix}{new_seg}{suffix}"

            if path.startswith("/pessoas/") and "/pagamento/" in path:
                head_p, pag_seg = path.rsplit("/pagamento/", 1)
                if pag_seg.isdigit() and int(pag_seg) in id_remaps["pagamento_pessoa"]:
                    path = f"{head_p}/pagamento/{id_remaps['pagamento_pessoa'][int(pag_seg)]}"

            if "application/json" in ct.lower() and raw_body:
                try:
                    j_obj = json.loads(raw_body.decode("utf-8"))
                    if isinstance(j_obj, dict):
                        for fk_field, kind in (
                            ("conta_id", "conta"),
                            ("conta_destino_id", "conta"),
                            ("conta_padrao_id", "conta"),
                            ("cartao_id", "cartao"),
                            ("pessoa_id", "pessoa"),
                            ("modulo_id", "modulo"),
                            ("subcategoria_id", "subcategoria"),
                            ("divida_id", "divida"),
                            ("parcela_id", "divida_parcela"),
                        ):
                            val = j_obj.get(fk_field)
                            if isinstance(val, int) and val in id_remaps[kind]:
                                j_obj[fk_field] = id_remaps[kind][val]
                        raw_body = json.dumps(j_obj, ensure_ascii=False).encode("utf-8")
                except Exception:
                    pass

            pq = f"{path}?{query}" if query else path
            hdrs = {"Authorization": f"Bearer {current_tok}"}
            if ct:
                hdrs["Content-Type"] = ct

            try:
                code, _, resp_body = self._request_hub(
                    method, pq, headers=hdrs, data=raw_body, timeout=15.0
                )
            except HubUnreachableError:
                remaining_for_user.extend(user_items[idx:])
                break

            if code == 401:
                current_tok = self._ensure_hub_token(local_user, force_refresh=True)
                hdrs["Authorization"] = f"Bearer {current_tok}"
                code, _, resp_body = self._request_hub(
                    method, pq, headers=hdrs, data=raw_body, timeout=15.0
                )

            if code in (408, 429):
                remaining_for_user.extend(user_items[idx:])
                break

            drained_any = True
            if 200 <= code < 300:
                loc_id = item.get("local_created_id")
                ekind = item.get("entity_kind")
                try:
                    r_json = json.loads(resp_body.decode("utf-8"))
                except Exception:
                    r_json = None
                if isinstance(r_json, dict):
                    if loc_id is not None and ekind in id_remaps:
                        rem_id = (
                            r_json.get("parcela_id")
                            if ekind == "divida_parcela"
                            else r_json.get("id")
                        )
                        if rem_id is not None:
                            id_remaps[ekind][int(loc_id)] = int(rem_id)
                    if (
                        ekind == "divida"
                        and isinstance(item.get("local_parcelas"), list)
                        and isinstance(r_json.get("parcelas"), list)
                    ):
                        remote_by_key = {
                            (int(rp["numero"]), int(rp["mes"]), int(rp["ano"])): int(rp["parcela_id"])
                            for rp in r_json["parcelas"]
                            if isinstance(rp, dict)
                            and rp.get("parcela_id") is not None
                            and rp.get("numero") is not None
                            and rp.get("mes") is not None
                            and rp.get("ano") is not None
                        }
                        for lp in item["local_parcelas"]:
                            if (
                                isinstance(lp, dict)
                                and lp.get("parcela_id") is not None
                                and lp.get("numero") is not None
                                and lp.get("mes") is not None
                                and lp.get("ano") is not None
                            ):
                                k_p = (int(lp["numero"]), int(lp["mes"]), int(lp["ano"]))
                                if k_p in remote_by_key:
                                    id_remaps["divida_parcela"][int(lp["parcela_id"])] = remote_by_key[k_p]

        with self._lock:
            self._save_outbox(other_items + remaining_for_user)
        return drained_any, current_tok

    # =========================================================================
    # Fluxos Principais: Check-Setup, Login, Register, Leitura e Escrita
    # =========================================================================

    def check_setup_status(self) -> dict[str, bool] | None:
        if self.count_local_users() > 0:
            return {"configured": True}
        with self._lock:
            if time.monotonic() < self._offline_until:
                return None
        try:
            code, _, body = self._request_hub("GET", "/auth/check-setup", timeout=6.0)
            if code == 200:
                return json.loads(body.decode("utf-8"))
        except Exception:
            pass
        return None

    def login_via_hub(self, usuario_raw: str, senha: str) -> tuple[int, dict[str, Any]] | None:
        usuario_id = (usuario_raw or "").strip().lower()
        code, _, body = self._request_hub(
            "POST",
            "/auth/login",
            json_body={"usuario": usuario_id, "senha": senha},
            timeout=20.0,
        )
        if code == 200:
            resp = json.loads(body.decode("utf-8"))
            render_tok = str(resp["access_token"])
            with self._lock:
                self._sessions[usuario_id] = render_tok
                self._save_sessions()
            local_before = self.get_local_user_by_email(usuario_id)
            if local_before:
                _, render_tok = self._replay_outbox_for_user(local_before, render_tok)
            local_u = self.pull_user_snapshot(render_tok)
            detached = models.Usuario(
                id=local_u["id"],
                nome=local_u["nome"],
                email=local_u["email"],
                senha_hash=local_u["senha_hash"],
                logo_path=local_u.get("logo_path"),
            )
            return 200, {
                "access_token": auth.criar_token(detached),
                "token_type": "bearer",
                "usuario": {
                    "id": detached.id,
                    "nome": detached.nome,
                    "usuario": detached.email,
                    "logo_path": detached.logo_path,
                },
            }

        # Caso especial: usuário criado offline neste PC que ainda não subiu para o Render
        if code == 401:
            local_u = self.get_local_user_by_email(usuario_id)
            if local_u and auth.verificar_senha(senha, local_u["senha_hash"]):
                try:
                    render_tok = self._ensure_hub_token(local_u, force_refresh=True)
                    _, render_tok = self._replay_outbox_for_user(local_u, render_tok)
                    synced_u = self.pull_user_snapshot(render_tok)
                    detached = models.Usuario(
                        id=synced_u["id"],
                        nome=synced_u["nome"],
                        email=synced_u["email"],
                        senha_hash=synced_u["senha_hash"],
                        logo_path=synced_u.get("logo_path"),
                    )
                    return 200, {
                        "access_token": auth.criar_token(detached),
                        "token_type": "bearer",
                        "usuario": {
                            "id": detached.id,
                            "nome": detached.nome,
                            "usuario": detached.email,
                            "logo_path": detached.logo_path,
                        },
                    }
                except Exception:
                    pass

        err_payload = {"detail": "Usuário ou senha incorretos."}
        try:
            err_payload = json.loads(body.decode("utf-8"))
        except Exception:
            pass
        return code, err_payload

    def register_via_hub(self, nome: str, usuario_raw: str, senha: str) -> tuple[int, dict[str, Any]]:
        usuario_id = (usuario_raw or "").strip().lower()
        code, _, body = self._request_hub(
            "POST",
            "/auth/register",
            json_body={"nome": nome, "usuario": usuario_id, "senha": senha},
            timeout=20.0,
        )
        if code == 200:
            resp = json.loads(body.decode("utf-8"))
            render_tok = str(resp["access_token"])
            with self._lock:
                self._sessions[usuario_id] = render_tok
                self._save_sessions()
            local_u = self.pull_user_snapshot(render_tok)
            detached = models.Usuario(
                id=local_u["id"],
                nome=local_u["nome"],
                email=local_u["email"],
                senha_hash=local_u["senha_hash"],
                logo_path=local_u.get("logo_path"),
            )
            return 200, {
                "access_token": auth.criar_token(detached),
                "token_type": "bearer",
                "usuario": {
                    "id": detached.id,
                    "nome": detached.nome,
                    "usuario": detached.email,
                    "logo_path": detached.logo_path,
                },
            }

        err_payload = {"detail": "Não foi possível criar o perfil."}
        try:
            err_payload = json.loads(body.decode("utf-8"))
        except Exception:
            pass
        return code, err_payload

    def sync_user_if_needed(self, local_user: dict[str, Any]) -> None:
        email = str(local_user["email"]).strip().lower()
        now = time.monotonic()
        with self._lock:
            if now < self._offline_until:
                return
            last_poll = self._last_poll_by_user.get(email, 0.0)
            has_outbox = any(it.get("usuario") == email for it in self._load_outbox())
            if not has_outbox and (now - last_poll) < self.version_poll_interval_sec:
                return

        try:
            render_tok = self._ensure_hub_token(local_user)
            replayed, render_tok = self._replay_outbox_for_user(local_user, render_tok)
            if replayed:
                self.pull_user_snapshot(render_tok)
                return

            code, _, body = self._request_hub(
                "GET",
                "/sync/version",
                headers={"Authorization": f"Bearer {render_tok}"},
                timeout=3.5,
            )
            if code == 401:
                render_tok = self._ensure_hub_token(local_user, force_refresh=True)
                code, _, body = self._request_hub(
                    "GET",
                    "/sync/version",
                    headers={"Authorization": f"Bearer {render_tok}"},
                    timeout=3.5,
                )
            if code == 200:
                remote_rev = int(json.loads(body.decode("utf-8")).get("sync_rev") or 1)
                local_rev = int(local_user.get("sync_rev") or 1)
                with self._lock:
                    self._last_poll_by_user[email] = time.monotonic()
                if remote_rev != local_rev:
                    self.pull_user_snapshot(render_tok)
        except Exception:
            # Modo offline transparente: leitura segue instantânea pelo SQLite local
            pass

    def forward_authenticated_mutation(
        self,
        *,
        local_user: dict[str, Any],
        method: str,
        path: str,
        query: str,
        content_type: str,
        raw_body: bytes,
    ) -> tuple[int, dict[str, str], bytes]:
        email = str(local_user["email"]).strip().lower()
        render_tok = self._ensure_hub_token(local_user)
        _, render_tok = self._replay_outbox_for_user(local_user, render_tok)

        pq = f"{path}?{query}" if query else path
        hdrs = {"Authorization": f"Bearer {render_tok}"}
        if content_type:
            hdrs["Content-Type"] = content_type

        code, resp_hdrs, resp_body = self._request_hub(
            method, pq, headers=hdrs, data=raw_body, timeout=20.0
        )
        if code == 401 and path != "/auth/senha":
            render_tok = self._ensure_hub_token(local_user, force_refresh=True)
            hdrs["Authorization"] = f"Bearer {render_tok}"
            code, resp_hdrs, resp_body = self._request_hub(
                method, pq, headers=hdrs, data=raw_body, timeout=20.0
            )

        if 200 <= code < 300:
            if path == "/auth/senha":
                r_data = json.loads(resp_body.decode("utf-8"))
                new_render_tok = str(r_data["access_token"])
                with self._lock:
                    self._sessions[email] = new_render_tok
                    self._save_sessions()
                updated_u = self.pull_user_snapshot(new_render_tok)
                detached = models.Usuario(
                    id=updated_u["id"],
                    nome=updated_u["nome"],
                    email=updated_u["email"],
                    senha_hash=updated_u["senha_hash"],
                )
                local_tok_payload = json.dumps(
                    {"access_token": auth.criar_token(detached), "token_type": "bearer"}
                ).encode("utf-8")
                return 200, {"content-type": "application/json"}, local_tok_payload

            self.pull_user_snapshot(render_tok)

        return code, resp_hdrs, resp_body


def _decode_bearer_local_user(hub_client: HubSyncClient, headers_list: list[tuple[bytes, bytes]]) -> dict[str, Any] | None:
    auth_val = ""
    for k, v in headers_list:
        if k.lower() == b"authorization":
            auth_val = v.decode("latin1", errors="ignore")
            break
    if not auth_val.lower().startswith("bearer "):
        return None
    tok = auth_val[7:].strip()
    try:
        payload = jwt.decode(tok, auth.SECRET_KEY, algorithms=[auth.ALGORITHM])
        email = str(payload.get("sub") or "").strip().lower()
        sess_sig = payload.get("sessao")
        if not email or not isinstance(sess_sig, str):
            return None
    except JWTError:
        return None

    local_u = hub_client.get_local_user_by_email(email)
    if not local_u:
        return None
    detached = models.Usuario(email=local_u["email"], senha_hash=local_u["senha_hash"])
    if sess_sig != auth._assinatura_sessao(detached):
        return None
    return local_u


def _infer_entity_kind(method: str, path: str) -> str | None:
    if method.upper() != "POST":
        return None
    clean_path = path.rstrip("/")
    if clean_path.startswith("/dividas/") and clean_path.endswith("/pagar"):
        return "divida_parcela"
    if clean_path.startswith("/pessoas/") and clean_path.endswith("/pagamento"):
        return "pagamento_pessoa"
    mapping = {
        "/contas/": "conta",
        "/contas": "conta",
        "/cartoes/": "cartao",
        "/cartoes": "cartao",
        "/pessoas/": "pessoa",
        "/pessoas": "pessoa",
        "/modulos/": "modulo",
        "/modulos": "modulo",
        "/modulos/subcategorias": "subcategoria",
        "/modulos/subcategorias/": "subcategoria",
        "/lancamentos/": "lancamento",
        "/lancamentos": "lancamento",
        "/dividas/": "divida",
        "/dividas": "divida",
    }
    return mapping.get(path)


class HubSyncASGIMiddleware:
    """Middleware ASGI puro (sem consumir streams de UploadFile) para Desktop <-> Cloud Hub."""

    def __init__(self, app: Any, hub_client: HubSyncClient) -> None:
        self.app = app
        self.hub_client = hub_client

    @staticmethod
    async def _send_raw_response(
        send: Any, status_code: int, body: bytes, content_type: str = "application/json"
    ) -> None:
        await send(
            {
                "type": "http.response.start",
                "status": status_code,
                "headers": [
                    (b"content-type", content_type.encode("latin1")),
                    (b"content-length", str(len(body)).encode("ascii")),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body, "more_body": False})

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope.get("type") != "http" or not self.hub_client.is_enabled():
            await self.app(scope, receive, send)
            return

        method = str(scope.get("method") or "GET").upper()
        path = str(scope.get("path") or "")
        query = (scope.get("query_string") or b"").decode("latin1")
        headers_list: list[tuple[bytes, bytes]] = list(scope.get("headers") or [])

        # 1. /auth/check-setup em instalação nova no PC consulta o Hub
        if method == "GET" and path == "/auth/check-setup":
            res = await asyncio.to_thread(self.hub_client.check_setup_status)
            if res is not None:
                await self._send_raw_response(
                    send, 200, json.dumps(res).encode("utf-8")
                )
                return
            await self.app(scope, receive, send)
            return

        # 2. /auth/login, /auth/register e /auth/setup unificados com o Hub
        if method == "POST" and path in ("/auth/login", "/auth/register", "/auth/setup"):
            raw_body, replay_receive = await self._buffer_request_body(receive)
            try:
                payload = json.loads(raw_body.decode("utf-8")) if raw_body else {}
            except Exception:
                payload = {}

            try:
                if path == "/auth/login":
                    hub_res = await asyncio.to_thread(
                        self.hub_client.login_via_hub,
                        str(payload.get("usuario") or ""),
                        str(payload.get("senha") or ""),
                    )
                else:
                    hub_res = await asyncio.to_thread(
                        self.hub_client.register_via_hub,
                        str(payload.get("nome") or ""),
                        str(payload.get("usuario") or ""),
                        str(payload.get("senha") or ""),
                    )
                if hub_res is not None:
                    st_code, resp_json = hub_res
                    await self._send_raw_response(
                        send, st_code, json.dumps(resp_json, ensure_ascii=False).encode("utf-8")
                    )
                    return
            except HubUnreachableError:
                # Continua localmente quando sem internet
                pass

            await self.app(scope, replay_receive, send)
            return

        # 3. Rotas autenticadas de dados financeiros e perfil
        is_synced_route = path in ("/auth/me",) or path in SYNCED_AUTH_MUTATIONS or any(
            path == pfx or path.startswith(pfx + "/") for pfx in SYNCED_PREFIXES
        )
        if not is_synced_route:
            await self.app(scope, receive, send)
            return

        local_user = _decode_bearer_local_user(self.hub_client, headers_list)
        if not local_user:
            await self.app(scope, receive, send)
            return

        if method in ("GET", "HEAD") or (
            method == "POST" and path.rstrip("/") in READONLY_POST_PATHS
        ):
            await asyncio.to_thread(self.hub_client.sync_user_if_needed, local_user)
            await self.app(scope, receive, send)
            return

        if method in ("POST", "PUT", "PATCH", "DELETE"):
            raw_body, replay_receive = await self._buffer_request_body(receive)
            content_type = ""
            for k, v in headers_list:
                if k.lower() == b"content-type":
                    content_type = v.decode("latin1", errors="ignore")
                    break

            try:
                st_code, resp_hdrs, resp_bytes = await asyncio.to_thread(
                    self.hub_client.forward_authenticated_mutation,
                    local_user=local_user,
                    method=method,
                    path=path,
                    query=query,
                    content_type=content_type,
                    raw_body=raw_body,
                )
                resp_ct = (
                    resp_hdrs.get("Content-Type")
                    or resp_hdrs.get("content-type")
                    or "application/json"
                )
                await self._send_raw_response(send, st_code, resp_bytes, content_type=resp_ct)
                return
            except HubUnreachableError:
                # Executa no SQLite local e enfileira no outbox offline se bem-sucedido
                captured_status = 500
                captured_chunks: list[bytes] = []

                async def capture_send(message: dict[str, Any]) -> None:
                    nonlocal captured_status
                    if message["type"] == "http.response.start":
                        captured_status = int(message["status"])
                    elif message["type"] == "http.response.body":
                        captured_chunks.append(message.get("body") or b"")
                    await send(message)

                await self.app(scope, replay_receive, capture_send)

                if 200 <= captured_status < 300 and path != "/auth/senha":
                    created_id: int | None = None
                    local_parcelas: list[dict[str, Any]] | None = None
                    ekind = _infer_entity_kind(method, path)
                    if ekind:
                        try:
                            out_json = json.loads(b"".join(captured_chunks).decode("utf-8"))
                            if isinstance(out_json, dict):
                                if ekind == "divida_parcela" and out_json.get("parcela_id") is not None:
                                    created_id = int(out_json["parcela_id"])
                                elif out_json.get("id") is not None:
                                    created_id = int(out_json["id"])
                                if ekind == "divida" and isinstance(out_json.get("parcelas"), list):
                                    local_parcelas = [
                                        {
                                            "parcela_id": int(p["parcela_id"]),
                                            "numero": p.get("numero"),
                                            "mes": p.get("mes"),
                                            "ano": p.get("ano"),
                                        }
                                        for p in out_json["parcelas"]
                                        if isinstance(p, dict) and p.get("parcela_id") is not None
                                    ]
                        except Exception:
                            pass
                    self.hub_client.enqueue_offline_mutation(
                        usuario=local_user["email"],
                        method=method,
                        path=path,
                        query=query,
                        content_type=content_type,
                        raw_body=raw_body,
                        local_created_id=created_id,
                        entity_kind=ekind,
                        local_parcelas=local_parcelas,
                    )
                return

        await self.app(scope, receive, send)

    @staticmethod
    async def _buffer_request_body(receive: Any) -> tuple[bytes, Any]:
        chunks: list[bytes] = []
        more = True
        while more:
            msg = await receive()
            if msg["type"] == "http.request":
                chunks.append(msg.get("body") or b"")
                more = bool(msg.get("more_body", False))
            elif msg["type"] == "http.disconnect":
                more = False
        raw = b"".join(chunks)

        replayed = False

        async def replay_receive() -> dict[str, Any]:
            nonlocal replayed
            if not replayed:
                replayed = True
                return {"type": "http.request", "body": raw, "more_body": False}
            return {"type": "http.disconnect"}

        return raw, replay_receive
