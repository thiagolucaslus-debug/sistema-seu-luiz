import os
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from database import get_db, DATA_DIR
import models
import auth
from services.calculos import calcular_saldo_pessoa_mes
from services.pdf_generator import gerar_pdf_fechamento
from pydantic import BaseModel, Field
from typing import Literal, Optional, List
from datetime import date, datetime
import calendar
import shutil

router = APIRouter(prefix="/pessoas", tags=["pessoas"])

class PessoaCreate(BaseModel):
    nome: str
    telefone: Optional[str] = None
    cor: str = "#10B981"
    foto_path: Optional[str] = None

class PessoaUpdate(BaseModel):
    nome: Optional[str] = None
    telefone: Optional[str] = None
    cor: Optional[str] = None
    foto_path: Optional[str] = None
    ativa: Optional[bool] = None

class PagamentoPessoaRequest(BaseModel):
    valor: float = Field(gt=0, allow_inf_nan=False)
    data: date
    observacao: Optional[str] = None
    conta_id: Optional[int] = None
    forma: Literal["dinheiro", "pix", "transferencia", "abatimento", "outro"] | None = None
    outra_forma: Optional[str] = Field(default=None, max_length=100)

@router.get("/")
def listar_pessoas(db: Session = Depends(get_db), usuario = Depends(auth.get_usuario_atual)):
    hoje = date.today()
    pessoas = db.query(models.Pessoa).filter(models.Pessoa.ativa == True).all()
    resultado = []
    for p in pessoas:
        saldo = calcular_saldo_pessoa_mes(db, p.id, hoje.month, hoje.year)
        resultado.append({
            "id": p.id,
            "nome": p.nome,
            "telefone": p.telefone,
            "cor": p.cor,
            "foto_path": p.foto_path,
            "saldo_devedor": saldo["saldo_devedor"],
            "credito_a_favor": saldo.get("credito_a_favor", 0.0),
            "total_gastos_mes": saldo["total_gastos_mes"],
            "token_acesso": p.token_acesso,
            "ativa": p.ativa
        })
    return resultado

@router.post("/")
def criar_pessoa(data: PessoaCreate, db: Session = Depends(get_db), usuario = Depends(auth.get_usuario_atual)):
    pessoa = models.Pessoa(**data.model_dump())
    db.add(pessoa)
    db.commit()
    db.refresh(pessoa)
    return pessoa

@router.post("/{id}/foto")
def upload_foto(id: int, file: UploadFile = File(...), db: Session = Depends(get_db), usuario = Depends(auth.get_usuario_atual)):
    pessoa = db.query(models.Pessoa).filter(models.Pessoa.id == id).first()
    if not pessoa:
        raise HTTPException(status_code=404, detail="Pessoa não encontrada.")

    # Valida formato
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in [".jpg", ".jpeg", ".png", ".webp", ".gif"]:
        raise HTTPException(status_code=400, detail="Formato de imagem inválido. Use JPG, PNG ou WEBP.")

    uploads_dir = os.path.join(DATA_DIR, "uploads")
    os.makedirs(uploads_dir, exist_ok=True)

    old_foto = pessoa.foto_path
    timestamp = int(datetime.now().timestamp())
    filename = f"pessoa_{id}_{timestamp}{ext}"
    filepath = os.path.join(uploads_dir, filename)

    with open(filepath, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    pessoa.foto_path = f"/uploads/{filename}"
    db.commit()
    db.refresh(pessoa)

    if old_foto and old_foto.startswith("/uploads/") and old_foto != pessoa.foto_path:
        old_name = os.path.basename(old_foto.removeprefix("/uploads/"))
        old_fp = os.path.join(uploads_dir, old_name)
        if old_name and os.path.isfile(old_fp):
            try:
                os.remove(old_fp)
            except OSError:
                pass

    return {"ok": True, "foto_path": pessoa.foto_path}

@router.put("/{id}")
def atualizar_pessoa(id: int, data: PessoaUpdate, db: Session = Depends(get_db), usuario = Depends(auth.get_usuario_atual)):
    pessoa = db.query(models.Pessoa).filter(models.Pessoa.id == id).first()
    if not pessoa:
        raise HTTPException(status_code=404, detail="Pessoa não encontrada.")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(pessoa, k, v)
    db.commit()
    db.refresh(pessoa)
    return pessoa

@router.delete("/{id}")
def desativar_pessoa(id: int, db: Session = Depends(get_db), usuario = Depends(auth.get_usuario_atual)):
    pessoa = db.query(models.Pessoa).filter(models.Pessoa.id == id).first()
    if not pessoa:
        raise HTTPException(status_code=404, detail="Pessoa não encontrada.")
    pessoa.ativa = False
    db.commit()
    return {"ok": True, "mensagem": "Pessoa desativada."}

@router.get("/{id}/extrato")
def extrato_pessoa(id: int, db: Session = Depends(get_db), usuario = Depends(auth.get_usuario_atual)):
    hoje = date.today()
    pessoa = db.query(models.Pessoa).filter(models.Pessoa.id == id).first()
    if not pessoa:
        raise HTTPException(status_code=404, detail="Pessoa não encontrada.")

    # Busca todos os meses que possuem lançamentos ou pagamentos
    meses_com_dados = set()
    lancamentos_todos = db.query(models.Lancamento).filter(
        models.Lancamento.pessoa_id == id,
        models.Lancamento.cancelado == False
    ).all()

    for lanc in lancamentos_todos:
        for p in lanc.parcelas:
            meses_com_dados.add((p.ano, p.mes))

    pagamentos_todos = db.query(models.PagamentoPessoa).filter(
        models.PagamentoPessoa.pessoa_id == id
    ).all()
    for pag in pagamentos_todos:
        meses_com_dados.add((pag.data.year, pag.data.month))

    # Garante que o mês atual sempre esteja na lista
    meses_com_dados.add((hoje.year, hoje.month))

    meses_ordenados = sorted(list(meses_com_dados), reverse=True)
    nomes_meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

    historico = []
    for ano, mes in meses_ordenados:
        saldo = calcular_saldo_pessoa_mes(db, id, mes, ano)

        # Lançamentos deste mês
        lancamentos_mes = []
        for lanc in lancamentos_todos:
            for p in lanc.parcelas:
                if p.mes == mes and p.ano == ano:
                    lancamentos_mes.append({
                        "parcela_id": p.id,
                        "lancamento_id": lanc.id,
                        "descricao": lanc.descricao,
                        "tipo": lanc.tipo,
                        "parcela": f"{p.numero}/{lanc.total_parcelas}" if lanc.total_parcelas > 1 else "À vista",
                        "valor": p.valor,
                        "status": p.status,
                        "cartao": lanc.cartao.nome if lanc.cartao else None,
                        "conta": lanc.conta.nome if lanc.conta else None,
                        "modulo": lanc.modulo.nome if lanc.modulo else None,
                        "data_lancamento": str(lanc.data_lancamento)
                    })

        # Pagamentos deste mês
        _, ultimo_dia = calendar.monthrange(ano, mes)
        pagamentos_mes = [
            {
                "id": pag.id,
                "valor": pag.valor,
                "data": str(pag.data),
                "observacao": pag.observacao,
                "forma_pagamento": pag.forma_pagamento or ("Crédito em conta" if pag.conta else "Dinheiro em mãos"),
                "conta": pag.conta.nome if pag.conta else None
            }
            for pag in pagamentos_todos
            if date(ano, mes, 1) <= pag.data <= date(ano, mes, ultimo_dia)
        ]

        historico.append({
            "mes": mes,
            "ano": ano,
            "nome_mes": f"{nomes_meses[mes-1]}/{ano}",
            "is_atual": (mes == hoje.month and ano == hoje.year),
            "is_passado": (ano < hoje.year or (ano == hoje.year and mes < hoje.month)),
            "saldo_anterior": saldo["saldo_anterior"],
            "total_gastos": saldo["total_gastos_mes"],
            "total_a_pagar": saldo["total_a_pagar"],
            "total_pagamentos": saldo["total_pagamentos_mes"],
            "saldo_devedor": saldo["saldo_devedor"],
            "credito_a_favor": saldo["credito_a_favor"],
            "lancamentos": lancamentos_mes,
            "pagamentos": pagamentos_mes
        })

    return {
        "pessoa": {
            "id": pessoa.id,
            "nome": pessoa.nome,
            "telefone": pessoa.telefone,
            "cor": pessoa.cor,
            "foto_path": pessoa.foto_path,
            "token_acesso": pessoa.token_acesso
        },
        "historico": historico
    }

@router.post("/{id}/pagamento")
def registrar_pagamento(id: int, req: PagamentoPessoaRequest, db: Session = Depends(get_db), usuario = Depends(auth.get_usuario_atual)):
    pessoa = db.query(models.Pessoa).filter(models.Pessoa.id == id).first()
    if not pessoa:
        raise HTTPException(status_code=404, detail="Pessoa não encontrada.")

    formas = {
        "dinheiro": "Dinheiro em mãos", "pix": "Pix",
        "transferencia": "Transferência bancária", "abatimento": "Abatimento de dívida",
    }
    forma_pagamento = formas.get(req.forma)
    if req.forma == "outro":
        forma_pagamento = (req.outra_forma or "").strip()
        if not forma_pagamento:
            raise HTTPException(400, "Informe a outra forma de pagamento.")
    conta_id = None if req.forma in {"dinheiro", "abatimento"} else req.conta_id
    if conta_id is not None and db.get(models.ContaBancaria, conta_id) is None:
        raise HTTPException(400, "A conta de destino não existe.")

    pag = models.PagamentoPessoa(
        pessoa_id=id,
        valor=req.valor,
        data=req.data,
        observacao=req.observacao,
        forma_pagamento=forma_pagamento,
        conta_id=conta_id
    )
    db.add(pag)
    db.commit()
    db.refresh(pag)
    return {"ok": True, "mensagem": f"Pagamento de R$ {req.valor:.2f} registrado com sucesso.", "id": pag.id}

@router.delete("/{id}/pagamento/{pag_id}")
def deletar_pagamento(id: int, pag_id: int, db: Session = Depends(get_db), usuario = Depends(auth.get_usuario_atual)):
    pag = db.query(models.PagamentoPessoa).filter(
        models.PagamentoPessoa.id == pag_id,
        models.PagamentoPessoa.pessoa_id == id
    ).first()
    if not pag:
        raise HTTPException(status_code=404, detail="Registro de pagamento não encontrado.")
    db.delete(pag)
    db.commit()
    return {"ok": True, "mensagem": "Pagamento cancelado/excluído."}

@router.get("/{id}/pdf/{mes}/{ano}")
def baixar_pdf_fechamento(id: int, mes: int, ano: int, db: Session = Depends(get_db), usuario = Depends(auth.get_usuario_atual)):
    try:
        caminho_pdf = gerar_pdf_fechamento(db, id, mes, ano, usuario.nome)
        if not os.path.exists(caminho_pdf):
            raise HTTPException(status_code=500, detail="Arquivo PDF não foi gerado.")
        return FileResponse(
            caminho_pdf,
            media_type="application/pdf",
            filename=os.path.basename(caminho_pdf)
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao gerar PDF: {str(e)}")

@router.get("/{id}/pdf-path/{mes}/{ano}")
def obter_caminho_pdf(id: int, mes: int, ano: int, db: Session = Depends(get_db), usuario = Depends(auth.get_usuario_atual)):
    """Retorna o caminho absoluto do PDF para o serviço WhatsApp enviar."""
    try:
        caminho_pdf = gerar_pdf_fechamento(db, id, mes, ano, usuario.nome)
        pessoa = db.query(models.Pessoa).filter(models.Pessoa.id == id).first()
        return {
            "success": True,
            "pdf_path": caminho_pdf,
            "filename": os.path.basename(caminho_pdf),
            "pessoa_nome": pessoa.nome if pessoa else "",
            "telefone": pessoa.telefone if pessoa else ""
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
