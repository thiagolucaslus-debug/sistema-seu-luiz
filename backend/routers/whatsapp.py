import json
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel

import auth

router = APIRouter(prefix="/whatsapp", tags=["whatsapp"], dependencies=[Depends(auth.get_usuario_atual)])
SERVICE = "http://127.0.0.1:3001"


class EnvioPdf(BaseModel):
    telefone: str
    pdf_path: str
    mensagem: str | None = None
    nome_pessoa: str | None = None
    mes_ano: str | None = None


class EnvioMensagem(BaseModel):
    chat_id: str | None = None
    telefone: str | None = None
    mensagem: str


class EnvioMidia(BaseModel):
    chat_id: str | None = None
    telefone: str | None = None
    data: str
    mimetype: str
    filename: str
    caption: str | None = None


def chamar_servico(path: str, *, post: bool = False, data: dict | None = None):
    request = Request(
        SERVICE + path,
        method="POST" if post else "GET",
        data=json.dumps(data).encode() if data is not None else None,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urlopen(request, timeout=60 if post else 3) as response:
            return json.load(response)
    except HTTPError as erro:
        with erro:
            try:
                detail = json.load(erro).get("error")
            except ValueError:
                detail = None
        raise HTTPException(erro.code, detail or "Falha no serviço de WhatsApp.") from erro
    except (URLError, TimeoutError, ValueError) as erro:
        raise HTTPException(503, "Serviço de WhatsApp indisponível. Inicie o sistema pelo iniciar.bat.") from erro


@router.get("/status")
def status_whatsapp(response: Response):
    response.headers["Cache-Control"] = "no-store"
    return chamar_servico("/status")


@router.post("/connect")
def conectar():
    return chamar_servico("/connect", post=True)


@router.post("/disconnect")
def desconectar():
    return chamar_servico("/disconnect", post=True)


@router.get("/chats")
def listar_conversas(limit: int = 60):
    limit = min(100, max(1, limit))
    return chamar_servico(f"/chats?limit={limit}")


@router.get("/chats/{chat_id}/messages")
def listar_mensagens(chat_id: str, limit: int = 60):
    limit = min(100, max(10, limit))
    return chamar_servico(f"/chats/{quote(chat_id, safe='')}/messages?limit={limit}")


@router.get("/messages/{message_id}/media")
def obter_midia(message_id: str):
    return chamar_servico(f"/messages/{quote(message_id, safe='')}/media")


@router.post("/messages")
def enviar_mensagem(envio: EnvioMensagem):
    return chamar_servico("/messages", post=True, data=envio.model_dump(exclude_none=True))


@router.post("/messages/media")
def enviar_midia(envio: EnvioMidia):
    return chamar_servico("/messages/media", post=True, data=envio.model_dump())


@router.post("/send-pdf")
def enviar_pdf(envio: EnvioPdf):
    return chamar_servico("/send-pdf", post=True, data=envio.model_dump())
