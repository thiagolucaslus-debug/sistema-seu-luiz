import os
import secrets
from datetime import date
from typing import Any, Optional
from fastapi import APIRouter, Body, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from database import get_db, DATA_DIR
import models
import auth
from tenancy import bump_user_sync_rev
from routers.lancamentos import determinar_mes_inicial_fatura, gerar_parcelas
from services.pdf_generator import gerar_pdf_fechamento

router = APIRouter(tags=["solicitacoes"])

UPLOADS_DIR = os.path.join(DATA_DIR, "uploads")
os.makedirs(UPLOADS_DIR, exist_ok=True)


def _normalize_status_out(status: Optional[str]) -> str:
    if status in ("aprovado", "aprovada"):
        return "aprovada"
    if status in ("rejeitado", "rejeitada"):
        return "rejeitada"
    return status or "pendente"


def _gestor_nome_for_pessoa(db: Session, pessoa: models.Pessoa) -> str:
    if pessoa.usuario_id:
        gestor = db.query(models.Usuario).filter(models.Usuario.id == pessoa.usuario_id).first()
        if gestor and gestor.nome:
            return gestor.nome
    return "Administração Financeira"


# ==========================================
# ENDPOINTS PÚBLICOS (Acessados pelo link da pessoa)
# ==========================================

@router.get("/public/lancar/{token}")
def obter_dados_publicos_pessoa(token: str, db: Session = Depends(get_db)):
    """Retorna dados básicos da pessoa e lista de cartões ativos do gestor correspondente."""
    pessoa = db.query(models.Pessoa).filter(
        models.Pessoa.token_acesso == token,
        models.Pessoa.ativa == True
    ).first()
    if not pessoa:
        raise HTTPException(status_code=404, detail="Link de lançamento inválido ou expirado.")

    q_cartoes = db.query(models.Cartao).filter(models.Cartao.ativo == True)
    if pessoa.usuario_id is not None:
        q_cartoes = q_cartoes.filter(models.Cartao.usuario_id == pessoa.usuario_id)
    cartoes = q_cartoes.all()

    return {
        "gestor_nome": _gestor_nome_for_pessoa(db, pessoa),
        "pessoa": {
            "id": pessoa.id,
            "nome": pessoa.nome,
            "foto_path": pessoa.foto_path,
            "cor": pessoa.cor
        },
        "cartoes": [
            {
                "id": c.id,
                "nome": c.nome,
                "bandeira": c.bandeira,
                "cor": c.cor
            }
            for c in cartoes
        ]
    }


@router.get("/public/fechamento/{token}/{mes}/{ano}/pdf")
def baixar_pdf_publico(token: str, mes: int, ano: int, db: Session = Depends(get_db)):
    """Permite que a pessoa baixe seu extrato/fechamento oficial em PDF direto pelo link recebido no WhatsApp."""
    pessoa = db.query(models.Pessoa).filter(
        models.Pessoa.token_acesso == token,
        models.Pessoa.ativa == True
    ).first()
    if not pessoa:
        raise HTTPException(status_code=404, detail="Link inválido ou expirado.")

    gestor_nome = _gestor_nome_for_pessoa(db, pessoa)
    try:
        caminho_pdf = gerar_pdf_fechamento(db, pessoa.id, mes, ano, gestor_nome)
        if not os.path.exists(caminho_pdf):
            raise HTTPException(status_code=500, detail="Arquivo PDF não foi gerado.")

        return FileResponse(
            caminho_pdf,
            media_type="application/pdf",
            filename=os.path.basename(caminho_pdf)
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao gerar PDF: {str(e)}")


@router.post("/public/lancar/{token}")
async def enviar_solicitacao_compra(
    token: str,
    descricao: str = Form(...),
    valor: float = Form(...),
    tipo_solicitacao: str = Form("compra_cartao"),  # "compra_cartao" ou "compra_para_mim"
    cartao_id: Optional[int] = Form(None),
    total_parcelas: int = Form(1),
    data_compra: Optional[str] = Form(None),
    observacoes: Optional[str] = Form(None),
    comprovante: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db)
):
    """Registra uma solicitação de compra enviada pela pessoa pelo link público."""
    pessoa = db.query(models.Pessoa).filter(
        models.Pessoa.token_acesso == token,
        models.Pessoa.ativa == True
    ).first()
    if not pessoa:
        raise HTTPException(status_code=404, detail="Link de lançamento inválido.")

    if valor <= 0:
        raise HTTPException(status_code=400, detail="O valor da compra deve ser maior que zero.")

    cartao_id_final: Optional[int] = None
    if tipo_solicitacao == "compra_cartao" and cartao_id:
        q_card = db.query(models.Cartao).filter(
            models.Cartao.id == cartao_id,
            models.Cartao.ativo == True,
        )
        if pessoa.usuario_id is not None:
            q_card = q_card.filter(models.Cartao.usuario_id == pessoa.usuario_id)
        cartao_valido = q_card.first()
        if not cartao_valido:
            raise HTTPException(status_code=400, detail="Cartão inválido para este link.")
        cartao_id_final = cartao_valido.id

    data_final = date.today()
    if data_compra:
        try:
            data_final = date.fromisoformat(data_compra)
        except ValueError:
            pass

    comprovante_relpath = None
    if comprovante and comprovante.filename:
        ext = os.path.splitext(comprovante.filename)[1].lower()
        if ext in [".jpg", ".jpeg", ".png", ".webp", ".pdf"]:
            uploads_dir = os.path.join(DATA_DIR, "uploads")
            os.makedirs(uploads_dir, exist_ok=True)
            nome_arq = f"comprovante_{secrets.token_hex(8)}{ext}"
            caminho_salvar = os.path.join(uploads_dir, nome_arq)
            conteudo = await comprovante.read()
            with open(caminho_salvar, "wb") as f:
                f.write(conteudo)
            comprovante_relpath = f"/uploads/{nome_arq}"

    solicitacao = models.SolicitacaoLancamento(
        usuario_id=pessoa.usuario_id,
        pessoa_id=pessoa.id,
        tipo_solicitacao=tipo_solicitacao,
        cartao_id=cartao_id_final,
        descricao=descricao.strip(),
        valor=round(valor, 2),
        total_parcelas=max(1, total_parcelas) if tipo_solicitacao == "compra_cartao" else 1,
        data_compra=data_final,
        comprovante_path=comprovante_relpath,
        observacoes=observacoes.strip() if observacoes else None,
        status="pendente"
    )
    db.add(solicitacao)
    bump_user_sync_rev(db, pessoa.usuario_id)
    db.commit()
    db.refresh(solicitacao)

    gestor_nome = _gestor_nome_for_pessoa(db, pessoa)
    return {
        "ok": True,
        "mensagem": f"Sua compra foi enviada com sucesso para aprovação de {gestor_nome}!",
        "solicitacao_id": solicitacao.id
    }


# ==========================================
# ENDPOINTS DO GESTOR (Protegidos por usuário)
# ==========================================

@router.get("/solicitacoes/")
def listar_solicitacoes(
    status: Optional[str] = "pendente",
    db: Session = Depends(get_db),
    usuario = Depends(auth.get_usuario_atual)
):
    """Lista as solicitações de compras enviadas pelas pessoas do usuário autenticado."""
    query = db.query(models.SolicitacaoLancamento).filter(
        models.SolicitacaoLancamento.usuario_id == usuario.id
    )
    if status and status != "todos":
        if status in ("aprovado", "aprovada"):
            query = query.filter(models.SolicitacaoLancamento.status.in_(["aprovado", "aprovada"]))
        elif status in ("rejeitado", "rejeitada"):
            query = query.filter(models.SolicitacaoLancamento.status.in_(["rejeitado", "rejeitada"]))
        else:
            query = query.filter(models.SolicitacaoLancamento.status == status)

    itens = query.order_by(models.SolicitacaoLancamento.created_at.desc()).all()

    resultado = []
    for s in itens:
        resultado.append({
            "id": s.id,
            "pessoa_id": s.pessoa_id,
            "pessoa_nome": s.pessoa.nome if s.pessoa else "Desconhecido",
            "pessoa_foto": s.pessoa.foto_path if s.pessoa else None,
            "foto_path": s.pessoa.foto_path if s.pessoa else None,
            "pessoa_cor": s.pessoa.cor if s.pessoa else "#3B82F6",
            "tipo_solicitacao": s.tipo_solicitacao,
            "cartao_id": s.cartao_id,
            "cartao_nome": s.cartao.nome if s.cartao else None,
            "cartao_cor": s.cartao.cor if s.cartao else None,
            "cartao_bandeira": s.cartao.bandeira if s.cartao else None,
            "descricao": s.descricao,
            "valor": s.valor,
            "total_parcelas": s.total_parcelas,
            "data_compra": s.data_compra.isoformat() if s.data_compra else None,
            "comprovante_path": s.comprovante_path,
            "comprovante_url": s.comprovante_path,
            "observacoes": s.observacoes,
            "status": _normalize_status_out(s.status),
            "motivo_rejeicao": s.motivo_rejeicao,
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "criado_em": s.created_at.isoformat() if s.created_at else None
        })
    return resultado


@router.get("/solicitacoes/pendentes/count")
def contar_solicitacoes_pendentes(
    db: Session = Depends(get_db),
    usuario = Depends(auth.get_usuario_atual)
):
    """Retorna o número de compras aguardando aprovação para exibir badge no menu."""
    count = db.query(models.SolicitacaoLancamento).filter(
        models.SolicitacaoLancamento.usuario_id == usuario.id,
        models.SolicitacaoLancamento.status == "pendente",
    ).count()
    return {"count": count, "pendentes": count}


@router.post("/solicitacoes/{id}/aprovar")
def aprovar_solicitacao(
    id: int,
    dados: Optional[dict[str, Any]] = Body(default=None),
    db: Session = Depends(get_db),
    usuario = Depends(auth.get_usuario_atual)
):
    """Aprova a compra e efetiva no sistema como lançamento oficial e parcelas."""
    solicitacao = db.query(models.SolicitacaoLancamento).filter(
        models.SolicitacaoLancamento.id == id,
        models.SolicitacaoLancamento.usuario_id == usuario.id,
    ).first()
    if not solicitacao:
        raise HTTPException(status_code=404, detail="Solicitação não encontrada.")

    if solicitacao.status != "pendente":
        raise HTTPException(status_code=400, detail=f"Esta solicitação já foi {_normalize_status_out(solicitacao.status)}.")

    dados = dados or {}
    cartao_id_escolhido = dados.get("cartao_id") if dados.get("cartao_id") is not None else solicitacao.cartao_id
    modulo_id_escolhido = dados.get("modulo_id")

    cartao = None
    if cartao_id_escolhido:
        cartao = (
            db.query(models.Cartao)
            .filter(models.Cartao.id == int(cartao_id_escolhido), models.Cartao.usuario_id == usuario.id)
            .first()
        )
        if not cartao:
            cartao_id_escolhido = None

    modulo_id_final = None
    if modulo_id_escolhido:
        mod = (
            db.query(models.Modulo)
            .filter(models.Modulo.id == int(modulo_id_escolhido), models.Modulo.usuario_id == usuario.id)
            .first()
        )
        if mod:
            modulo_id_final = mod.id

    tipo_lancamento = "compra_cartao" if solicitacao.tipo_solicitacao == "compra_cartao" else "compra_para_mim"

    mes_ini, ano_ini = determinar_mes_inicial_fatura(cartao, solicitacao.data_compra, None, None)

    lancamento = models.Lancamento(
        usuario_id=usuario.id,
        descricao=solicitacao.descricao,
        tipo=tipo_lancamento,
        valor_total=solicitacao.valor,
        total_parcelas=solicitacao.total_parcelas,
        data_lancamento=solicitacao.data_compra,
        mes_fatura=mes_ini,
        ano_fatura=ano_ini,
        cartao_id=cartao.id if cartao else None,
        pessoa_id=solicitacao.pessoa_id,
        modulo_id=modulo_id_final,
        observacoes=solicitacao.observacoes,
        comprovante_path=solicitacao.comprovante_path
    )
    db.add(lancamento)
    db.flush()

    parcelas = gerar_parcelas(lancamento.id, solicitacao.valor, solicitacao.total_parcelas, mes_ini, ano_ini)
    for p in parcelas:
        db.add(p)

    solicitacao.status = "aprovada"
    solicitacao.lancamento_id = lancamento.id
    bump_user_sync_rev(db, usuario.id)
    db.commit()

    return {
        "ok": True,
        "mensagem": "Compra aprovada e lançada com sucesso no sistema!",
        "lancamento_id": lancamento.id
    }


@router.post("/solicitacoes/{id}/rejeitar")
def rejeitar_solicitacao(
    id: int,
    motivo: Optional[str] = None,
    dados: Optional[dict[str, Any]] = Body(default=None),
    db: Session = Depends(get_db),
    usuario = Depends(auth.get_usuario_atual)
):
    """Rejeita a solicitação com motivo opcional."""
    solicitacao = db.query(models.SolicitacaoLancamento).filter(
        models.SolicitacaoLancamento.id == id,
        models.SolicitacaoLancamento.usuario_id == usuario.id,
    ).first()
    if not solicitacao:
        raise HTTPException(status_code=404, detail="Solicitação não encontrada.")

    motivo_final = (dados.get("motivo") if isinstance(dados, dict) and dados.get("motivo") is not None else motivo)
    solicitacao.status = "rejeitada"
    solicitacao.motivo_rejeicao = str(motivo_final).strip()[:255] if motivo_final else None
    bump_user_sync_rev(db, usuario.id)
    db.commit()

    return {"ok": True, "mensagem": "Solicitação rejeitada."}


@router.post("/pessoas/{id}/gerar-link")
def gerar_ou_obter_link_pessoa(
    id: int,
    db: Session = Depends(get_db),
    usuario = Depends(auth.get_usuario_atual)
):
    """Gera um token exclusivo para a pessoa lançar compras se não tiver, ou retorna o existente."""
    pessoa = (
        db.query(models.Pessoa)
        .filter(models.Pessoa.id == id, models.Pessoa.usuario_id == usuario.id)
        .first()
    )
    if not pessoa:
        raise HTTPException(status_code=404, detail="Pessoa não encontrada.")

    if not pessoa.token_acesso:
        pessoa.token_acesso = secrets.token_urlsafe(12)
        bump_user_sync_rev(db, usuario.id)
        db.commit()

    return {
        "token": pessoa.token_acesso,
        "path": f"/lancar/{pessoa.token_acesso}",
        "pessoa_nome": pessoa.nome,
        "telefone": pessoa.telefone
    }
