from __future__ import annotations

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


def bump_user_sync_rev(db: Session, usuario_id: Optional[int]) -> None:
    """Incrementa a revisão de sincronização do usuário na mesma transação."""
    if not usuario_id:
        return
    db.query(models.Usuario).filter(models.Usuario.id == usuario_id).update(
        {models.Usuario.sync_rev: func.coalesce(models.Usuario.sync_rev, 1) + 1},
        synchronize_session=False,
    )
