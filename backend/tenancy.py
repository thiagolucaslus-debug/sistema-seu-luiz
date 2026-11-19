from __future__ import annotations

import re
import unicodedata
from typing import Optional
from sqlalchemy import func
from sqlalchemy.orm import Session
import models

USER_OWNED_TABLES = (
    "contas_bancarias",
    "cartoes",
    "pessoas",
    "modulos",
    "lancamentos",
    "pagamentos_pessoa",
    "pagamentos_fatura",
    "solicitacoes_lancamento",
    "dividas",
    "divida_parcelas",
)

LEGACY_ISSUER_COLOR_RULES = (
    (re.compile(r"\batacadao\b"), "#c35212"),
    (re.compile(r"\b(?:co{2,}p|co op)\b"), "#20396a"),
    (re.compile(r"\bultravioleta\b"), "#382153"),
    (re.compile(r"\b(?:nubank|nu|roxinho)\b"), "#820ad1"),
    (re.compile(r"\bpersonnalite\b"), "#203c68"),
    (re.compile(r"\buniclass\b"), "#135e6a"),
    (re.compile(r"\b(?:itau|itaucard)\s+click\b|^click\b"), "#505867"),
    (re.compile(r"\b(?:itau|itaucard)\b"), "#dd550b"),
    (re.compile(r"\binter\b"), "#b74500"),
    (re.compile(r"\bsantander\b"), "#bd111e"),
    (re.compile(r"\b(?:bradesco|bradescard)\b"), "#aa1347"),
    (re.compile(r"\bcarrefour\b"), "#1557a6"),
    (re.compile(r"\bsicoob\b"), "#166158"),
    (re.compile(r"\bsicredi\b"), "#237339"),
    (re.compile(r"\bcaixa\b"), "#145c93"),
    (re.compile(r"\b(?:ourocard|banco do brasil)\b"), "#9a7100"),
    (re.compile(r"\bc6(?:bank)?\b"), "#2c3543"),
    (re.compile(r"\bpicpay\b"), "#147c4b"),
    (re.compile(r"\bmercado\s?pago\b"), "#0874ae"),
)


def bump_user_sync_rev(db: Session, usuario_id: Optional[int]) -> None:
    """Incrementa a revisão de sincronização do usuário na mesma transação."""
    if not usuario_id:
        return
    db.query(models.Usuario).filter(models.Usuario.id == usuario_id).update(
        {models.Usuario.sync_rev: func.coalesce(models.Usuario.sync_rev, 1) + 1},
        synchronize_session=False,
    )


def normalize_legacy_issuer_card_colors(session: Session) -> bool:
    """Converte cartões legados com o default intocado '#8B5CF6' para a cor real do emissor."""
    changed = False
    touched_users: set[int] = set()
    for cartao_row in session.query(models.Cartao).filter(models.Cartao.cor == "#8B5CF6").all():
        norm_nome = unicodedata.normalize("NFD", cartao_row.nome or "")
        norm_nome = "".join(ch for ch in norm_nome if unicodedata.category(ch) != "Mn").lower()
        norm_nome = re.sub(r"[^a-z0-9]+", " ", norm_nome).strip()
        for rgx, cor_padrao in LEGACY_ISSUER_COLOR_RULES:
            if rgx.search(norm_nome):
                cartao_row.cor = cor_padrao
                changed = True
                if cartao_row.usuario_id:
                    touched_users.add(int(cartao_row.usuario_id))
                break
    for uid_tocado in touched_users:
        u_obj = session.query(models.Usuario).filter(models.Usuario.id == uid_tocado).first()
        if u_obj:
            u_obj.sync_rev = int(u_obj.sync_rev or 1) + 1
    return changed
