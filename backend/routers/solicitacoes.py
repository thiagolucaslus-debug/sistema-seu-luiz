import os
import secrets
from datetime import date
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from database import get_db
import models
import auth
from routers.lancamentos import determinar_mes_inicial_fatura, gerar_parcelas

router = APIRouter(tags=["solicitacoes"])

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UPLOADS_DIR = os.path.join(BASE_DIR, "uploads")
os.makedirs(UPLOADS_DIR, exist_ok=True)


# ==========================================
# ENDPOINTS PÚBLICOS (Acessados pelo link da pessoa)
# ==========================================

@router.get("/public/lancar/{token}")
def obter_dados_publicos_pessoa(token: str, db: Session = Depends(get_db)):
    """Retorna dados básicos da pessoa e lista de cartões ativos para o formulário de compra."""
    pessoa = db.query(models.Pessoa).filter(
        models.Pessoa.token_acesso == token,
        models.Pessoa.ativa == True
    ).first()
    if not pessoa:
        raise HTTPException(status_code=404, detail="Link de lançamento inválido ou expirado.")

    cartoes = db.query(models.Cartao).filter(models.Cartao.ativo == True).all()

    return {
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
            nome_arq = f"comprovante_{secrets.token_hex(8)}{ext}"
            caminho_salvar = os.path.join(UPLOADS_DIR, nome_arq)
            conteudo = await comprovante.read()
            with open(caminho_salvar, "wb") as f:
                f.write(conteudo)
            comprovante_relpath = f"/uploads/{nome_arq}"

    solicitacao = models.SolicitacaoLancamento(
        pessoa_id=pessoa.id,
        tipo_solicitacao=tipo_solicitacao,
        cartao_id=cartao_id if tipo_solicitacao == "compra_cartao" else None,
        descricao=descricao.strip(),
        valor=round(valor, 2),
        total_parcelas=max(1, total_parcelas) if tipo_solicitacao == "compra_cartao" else 1,
        data_compra=data_final,
        comprovante_path=comprovante_relpath,
        observacoes=observacoes.strip() if observacoes else None,
        status="pendente"
    )
    db.add(solicitacao)
    db.commit()
    db.refresh(solicitacao)

    return {
        "ok": True,
        "mensagem": "Sua compra foi enviada com sucesso para aprovação do Seu Luiz!",
        "solicitacao_id": solicitacao.id
    }


# ==========================================
# ENDPOINTS DO GESTOR (Seu Luiz - Protegidos)
# ==========================================

@router.get("/solicitacoes/")
def listar_solicitacoes(
    status: Optional[str] = "pendente",
    db: Session = Depends(get_db),
    usuario = Depends(auth.get_usuario_atual)
):
    """Lista as solicitações de compras enviadas pelas pessoas para o Seu Luiz aprovar."""
    query = db.query(models.SolicitacaoLancamento)
    if status and status != "todos":
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
            "status": s.status,
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
        models.SolicitacaoLancamento.status == "pendente"
    ).count()
    return {"count": count}


@router.post("/solicitacoes/{id}/aprovar")
def aprovar_solicitacao(
    id: int,
    db: Session = Depends(get_db),
    usuario = Depends(auth.get_usuario_atual)
):
    """Aprova a compra e efetiva no sistema como lançamento oficial e parcelas."""
    solicitacao = db.query(models.SolicitacaoLancamento).filter(
        models.SolicitacaoLancamento.id == id
    ).first()
    if not solicitacao:
        raise HTTPException(status_code=404, detail="Solicitação não encontrada.")

    if solicitacao.status != "pendente":
        raise HTTPException(status_code=400, detail=f"Esta solicitação já foi {solicitacao.status}.")

    cartao = None
    if solicitacao.cartao_id:
        cartao = db.query(models.Cartao).filter(models.Cartao.id == solicitacao.cartao_id).first()

    tipo_lancamento = "compra_cartao" if solicitacao.tipo_solicitacao == "compra_cartao" else "compra_para_mim"

    mes_ini, ano_ini = determinar_mes_inicial_fatura(cartao, solicitacao.data_compra, None, None)

    lancamento = models.Lancamento(
        descricao=solicitacao.descricao,
        tipo=tipo_lancamento,
        valor_total=solicitacao.valor,
        total_parcelas=solicitacao.total_parcelas,
        data_lancamento=solicitacao.data_compra,
        mes_fatura=mes_ini,
        ano_fatura=ano_ini,
        cartao_id=solicitacao.cartao_id,
        pessoa_id=solicitacao.pessoa_id,
        observacoes=solicitacao.observacoes,
        comprovante_path=solicitacao.comprovante_path
    )
    db.add(lancamento)
    db.flush()

    parcelas = gerar_parcelas(lancamento.id, solicitacao.valor, solicitacao.total_parcelas, mes_ini, ano_ini)
    for p in parcelas:
        db.add(p)

    solicitacao.status = "aprovado"
    solicitacao.lancamento_id = lancamento.id
    db.commit()

    return {
        "ok": True,
        "mensagem": "Compra aprovada e lançada com sucesso no sistema!",
        "lancamento_id": lancamento.id
    }


@router.post("/solicitacoes/{id}/rejeitar")
def rejeitar_solicitacao(
    id: int,
    dados: Optional[dict] = None,
    db: Session = Depends(get_db),
    usuario = Depends(auth.get_usuario_atual)
):
    """Rejeita a solicitação com motivo opcional."""
    solicitacao = db.query(models.SolicitacaoLancamento).filter(
        models.SolicitacaoLancamento.id == id
    ).first()
    if not solicitacao:
        raise HTTPException(status_code=404, detail="Solicitação não encontrada.")

    motivo = dados.get("motivo") if dados else None
    solicitacao.status = "rejeitado"
    solicitacao.motivo_rejeicao = motivo
    db.commit()

    return {"ok": True, "mensagem": "Solicitação rejeitada."}


@router.post("/pessoas/{id}/gerar-link")
def gerar_ou_obter_link_pessoa(
    id: int,
    db: Session = Depends(get_db),
    usuario = Depends(auth.get_usuario_atual)
):
    """Gera um token exclusivo para a pessoa lançar compras se não tiver, ou retorna o existente."""
    pessoa = db.query(models.Pessoa).filter(models.Pessoa.id == id).first()
    if not pessoa:
        raise HTTPException(status_code=404, detail="Pessoa não encontrada.")

    if not pessoa.token_acesso:
        pessoa.token_acesso = secrets.token_urlsafe(12)
        db.commit()

    return {
        "token": pessoa.token_acesso,
        "path": f"/lancar/{pessoa.token_acesso}",
        "pessoa_nome": pessoa.nome,
        "telefone": pessoa.telefone
    }
