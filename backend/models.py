import enum
import secrets
from sqlalchemy import (
    Column, Integer, String, Float, Date, DateTime,
    ForeignKey, Boolean, Text
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base

class TipoLancamento(str, enum.Enum):
    compra_cartao = "compra_cartao"
    despesa_conta = "despesa_conta"
    emprestimo_dado = "emprestimo_dado"
    receita = "receita"
    transferencia = "transferencia"
    pagamento_pessoa = "pagamento_pessoa"
    pagamento_fatura = "pagamento_fatura"
    compra_para_mim = "compra_para_mim"
    reembolso_pessoa = "reembolso_pessoa"

class StatusParcela(str, enum.Enum):
    pendente = "pendente"
    pago = "pago"
    cancelado = "cancelado"

class StatusFatura(str, enum.Enum):
    aberta = "aberta"
    fechada = "fechada"
    paga = "paga"

class Usuario(Base):
    __tablename__ = "usuarios"
    id = Column(Integer, primary_key=True, index=True)
    nome = Column(String(100), nullable=False, default="Seu Luiz")
    email = Column(String(200), unique=True, nullable=False, index=True)
    senha_hash = Column(String(255), nullable=False)
    logo_path = Column(String(500), nullable=True)
    sync_rev = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime, server_default=func.now())

class ContaBancaria(Base):
    __tablename__ = "contas_bancarias"
    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=True, index=True)
    nome = Column(String(100), nullable=False)
    banco = Column(String(100), nullable=False)
    agencia = Column(String(20), nullable=True)
    conta = Column(String(30), nullable=True)
    saldo_inicial = Column(Float, default=0.0)
    tipo = Column(String(50), default="corrente")  # corrente, poupanca, investimento, dinheiro
    ativa = Column(Boolean, default=True)
    cor = Column(String(20), default="#3B82F6")
    created_at = Column(DateTime, server_default=func.now())

    lancamentos = relationship("Lancamento", back_populates="conta", foreign_keys="Lancamento.conta_id")
    pagamentos_fatura = relationship("PagamentoFatura", back_populates="conta")
    pagamentos_pessoa = relationship("PagamentoPessoa", back_populates="conta")

class Cartao(Base):
    __tablename__ = "cartoes"
    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=True, index=True)
    nome = Column(String(100), nullable=False)
    bandeira = Column(String(50), default="Visa")
    dia_fechamento = Column(Integer, default=20)
    dia_vencimento = Column(Integer, default=27)
    limite = Column(Float, default=0.0)
    cor = Column(String(20), default="#8B5CF6")
    ativo = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())

    lancamentos = relationship("Lancamento", back_populates="cartao")

class Pessoa(Base):
    __tablename__ = "pessoas"
    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=True, index=True)
    nome = Column(String(100), nullable=False)
    telefone = Column(String(20), nullable=True)
    foto_path = Column(String(500), nullable=True)
    ativa = Column(Boolean, default=True)
    cor = Column(String(20), default="#10B981")
    token_acesso = Column(
        String(64),
        unique=True,
        index=True,
        nullable=True,
        default=lambda: secrets.token_urlsafe(12),
    )
    created_at = Column(DateTime, server_default=func.now())

    lancamentos = relationship("Lancamento", back_populates="pessoa")
    pagamentos = relationship("PagamentoPessoa", back_populates="pessoa", cascade="all, delete-orphan")
    solicitacoes = relationship("SolicitacaoLancamento", back_populates="pessoa", cascade="all, delete-orphan")

class Modulo(Base):
    __tablename__ = "modulos"
    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=True, index=True)
    nome = Column(String(100), nullable=False)
    icone = Column(String(50), default="home")
    cor = Column(String(20), default="#3B82F6")
    foto_path = Column(String(500), nullable=True)
    ativo = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())

    lancamentos = relationship("Lancamento", back_populates="modulo")
    subcategorias = relationship("Subcategoria", back_populates="modulo", cascade="all, delete-orphan")

class Subcategoria(Base):
    __tablename__ = "subcategorias"
    id = Column(Integer, primary_key=True, index=True)
    nome = Column(String(100), nullable=False)
    modulo_id = Column(Integer, ForeignKey("modulos.id"), nullable=False)
    modulo = relationship("Modulo", back_populates="subcategorias")

class Lancamento(Base):
    __tablename__ = "lancamentos"
    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=True, index=True)
    descricao = Column(String(255), nullable=False)
    tipo = Column(String(50), nullable=False)  # TipoLancamento enum value
    valor_total = Column(Float, nullable=False)
    total_parcelas = Column(Integer, default=1)
    data_lancamento = Column(Date, nullable=False)
    mes_fatura = Column(Integer, nullable=True)
    ano_fatura = Column(Integer, nullable=True)
    cartao_id = Column(Integer, ForeignKey("cartoes.id"), nullable=True)
    conta_id = Column(Integer, ForeignKey("contas_bancarias.id"), nullable=True)
    conta_destino_id = Column(Integer, ForeignKey("contas_bancarias.id"), nullable=True)
    pessoa_id = Column(Integer, ForeignKey("pessoas.id"), nullable=True)
    modulo_id = Column(Integer, ForeignKey("modulos.id"), nullable=True)
    subcategoria_id = Column(Integer, ForeignKey("subcategorias.id"), nullable=True)
    observacoes = Column(Text, nullable=True)
    comprovante_path = Column(String(500), nullable=True)
    cancelado = Column(Boolean, default=False)
    created_at = Column(DateTime, server_default=func.now())

    cartao = relationship("Cartao", back_populates="lancamentos")
    conta = relationship("ContaBancaria", back_populates="lancamentos", foreign_keys=[conta_id])
    conta_destino = relationship("ContaBancaria", foreign_keys=[conta_destino_id])
    pessoa = relationship("Pessoa", back_populates="lancamentos")
    modulo = relationship("Modulo", back_populates="lancamentos")
    parcelas = relationship("Parcela", back_populates="lancamento", cascade="all, delete-orphan")

class Parcela(Base):
    __tablename__ = "parcelas"
    id = Column(Integer, primary_key=True, index=True)
    lancamento_id = Column(Integer, ForeignKey("lancamentos.id"), nullable=False)
    numero = Column(Integer, nullable=False)
    valor = Column(Float, nullable=False)
    mes = Column(Integer, nullable=False)
    ano = Column(Integer, nullable=False)
    vencimento = Column(Date, nullable=True)
    data_pagamento = Column(Date, nullable=True)
    status = Column(String(20), default="pendente")

    lancamento = relationship("Lancamento", back_populates="parcelas")

class PagamentoPessoa(Base):
    __tablename__ = "pagamentos_pessoa"
    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=True, index=True)
    pessoa_id = Column(Integer, ForeignKey("pessoas.id"), nullable=False)
    valor = Column(Float, nullable=False)
    data = Column(Date, nullable=False)
    observacao = Column(Text, nullable=True)
    forma_pagamento = Column(String(100), nullable=True)
    conta_id = Column(Integer, ForeignKey("contas_bancarias.id"), nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    pessoa = relationship("Pessoa", back_populates="pagamentos")
    conta = relationship("ContaBancaria", back_populates="pagamentos_pessoa")

class PagamentoFatura(Base):
    __tablename__ = "pagamentos_fatura"
    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=True, index=True)
    cartao_id = Column(Integer, ForeignKey("cartoes.id"), nullable=False)
    mes = Column(Integer, nullable=False)
    ano = Column(Integer, nullable=False)
    valor = Column(Float, nullable=False)
    data = Column(Date, nullable=False)
    conta_id = Column(Integer, ForeignKey("contas_bancarias.id"), nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    cartao = relationship("Cartao")
    conta = relationship("ContaBancaria", back_populates="pagamentos_fatura")


class SolicitacaoLancamento(Base):
    __tablename__ = "solicitacoes_lancamento"
    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=True, index=True)
    pessoa_id = Column(Integer, ForeignKey("pessoas.id"), nullable=False)
    tipo_solicitacao = Column(String(50), default="compra_cartao")  # "compra_cartao" ou "compra_para_mim"
    cartao_id = Column(Integer, ForeignKey("cartoes.id"), nullable=True)
    descricao = Column(String(255), nullable=False)
    valor = Column(Float, nullable=False)
    total_parcelas = Column(Integer, default=1)
    data_compra = Column(Date, nullable=False)
    comprovante_path = Column(String(500), nullable=True)
    observacoes = Column(Text, nullable=True)
    status = Column(String(20), default="pendente")  # "pendente", "aprovado", "rejeitado"
    motivo_rejeicao = Column(String(255), nullable=True)
    lancamento_id = Column(Integer, ForeignKey("lancamentos.id"), nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    pessoa = relationship("Pessoa", back_populates="solicitacoes")
    cartao = relationship("Cartao")
    lancamento = relationship("Lancamento")


class Divida(Base):
    __tablename__ = "dividas"
    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=True, index=True)
    nome = Column(String(150), nullable=False)
    credor = Column(String(120), nullable=True)
    categoria = Column(String(80), default="Financiamento")
    tipo_compromisso = Column(String(30), nullable=False, default="parcelada")  # "parcelada" ou "fixa"
    valor_parcela = Column(Float, nullable=False)
    dia_vencimento = Column(Integer, nullable=False, default=10)
    total_parcelas = Column(Integer, nullable=True)
    parcelas_pagas_anteriores = Column(Integer, nullable=False, default=0)
    mes_inicio = Column(Integer, nullable=False)
    ano_inicio = Column(Integer, nullable=False)
    taxa_juros_mensal = Column(Float, nullable=False, default=0.0)
    desconto_antecipacao_pct = Column(Float, nullable=False, default=0.0)
    conta_padrao_id = Column(Integer, ForeignKey("contas_bancarias.id"), nullable=True)
    modulo_id = Column(Integer, ForeignKey("modulos.id"), nullable=True)
    cor = Column(String(20), default="#2563EB")
    observacoes = Column(Text, nullable=True)
    ativa = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())

    conta_padrao = relationship("ContaBancaria", foreign_keys=[conta_padrao_id])
    modulo = relationship("Modulo", foreign_keys=[modulo_id])
    parcelas = relationship(
        "DividaParcela",
        back_populates="divida",
        cascade="all, delete-orphan",
        order_by="DividaParcela.ano.asc(), DividaParcela.mes.asc(), DividaParcela.numero.asc()",
    )


class DividaParcela(Base):
    __tablename__ = "divida_parcelas"
    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=True, index=True)
    divida_id = Column(Integer, ForeignKey("dividas.id"), nullable=False, index=True)
    numero = Column(Integer, nullable=False, default=1)
    mes = Column(Integer, nullable=False)
    ano = Column(Integer, nullable=False)
    vencimento = Column(Date, nullable=False)
    valor_original = Column(Float, nullable=False)
    valor_atual = Column(Float, nullable=False)
    valor_pago = Column(Float, nullable=True)
    desconto = Column(Float, nullable=False, default=0.0)
    acrescimo = Column(Float, nullable=False, default=0.0)
    status = Column(String(20), nullable=False, default="pendente")  # "pendente" ou "pago"
    pago_anteriormente = Column(Boolean, nullable=False, default=False)
    antecipada = Column(Boolean, nullable=False, default=False)
    data_pagamento = Column(Date, nullable=True)
    forma_pagamento = Column(String(80), nullable=True)
    conta_id = Column(Integer, ForeignKey("contas_bancarias.id"), nullable=True)
    lancamento_id = Column(Integer, ForeignKey("lancamentos.id"), nullable=True)
    observacao = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    divida = relationship("Divida", back_populates="parcelas")
    conta = relationship("ContaBancaria", foreign_keys=[conta_id])
    lancamento = relationship("Lancamento", foreign_keys=[lancamento_id])
