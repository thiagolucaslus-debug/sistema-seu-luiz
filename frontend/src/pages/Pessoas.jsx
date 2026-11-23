import { useState, useEffect, useRef, useMemo } from 'react';
import Avatar from '../components/Avatar';
import { getCardBrand } from '../components/cardBrand';
import { todayLocalISO } from '../components/dateUtils';
import {
  MONTHS_FULL,
  PAYMENT_FORM_OPTIONS,
  monthKey,
  parseMonthKey,
  shiftMonth,
  defaultDateForMonth,
  parseBrlNumber,
  formatEditableBrl,
  buildMonthTabs,
  encodeOriginValue,
  decodeOriginPatch,
  normalizePaymentFormaCode,
} from '../components/pessoasSpreadsheet';
import { mediaUrl } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import {
  pessoas as pessoasApi,
  contas as contasApi,
  cartoes as cartoesApi,
  lancamentos as lancamentosApi,
  whatsapp as whatsappApi,
  publicShareOrigin,
} from '../api/client';
import {
  Users, Plus, Download, MessageCircle, DollarSign, X, CheckCircle,
  Trash2, Camera, Edit2, User, Link2, Share2, RotateCcw, Eraser,
  AlertTriangle, Table2, Loader2, ChevronLeft, ChevronRight, Check,
} from 'lucide-react';

function fmt(val) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);
}

const MESES_NOMES = MONTHS_FULL;

function ModalNovaPessoa({ onClose, onSaved }) {
  const [form, setForm] = useState({
    nome: '',
    telefone: '',
    cor: '#10B981',
  });
  const [fotoFile, setFotoFile] = useState(null);
  const [fotoPreview, setFotoPreview] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef(null);

  const handleFotoChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setFotoFile(file);
      setFotoPreview(URL.createObjectURL(file));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await pessoasApi.criar(form);
      const pessoaCriada = res.data;

      if (fotoFile && pessoaCriada.id) {
        const formData = new FormData();
        formData.append('file', fotoFile);
        await pessoasApi.uploadFoto(pessoaCriada.id, formData);
      }

      onSaved(pessoaCriada);
      onClose();
    } catch (err) {
      alert('Erro ao cadastrar pessoa: ' + (err.response?.data?.detail || err.message));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[var(--surface)] text-[var(--ink)] rounded-3xl shadow-2xl w-full max-w-md p-6 border border-[var(--line)]">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-[var(--ink)]">Cadastrar Nova Pessoa</h2>
          <button onClick={onClose} className="p-1 text-[var(--muted)] hover:text-[var(--ink)] rounded-lg"><X size={20} /></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex flex-col items-center justify-center gap-2 pb-2">
            <div
              onClick={() => fileInputRef.current?.click()}
              className="relative w-20 h-20 rounded-full border-2 border-dashed border-[var(--line)] hover:border-blue-500 flex items-center justify-center cursor-pointer overflow-hidden group bg-[var(--raised)] transition-all shadow-sm"
              style={{ borderColor: fotoPreview ? form.cor : undefined }}
            >
              {fotoPreview ? (
                <img src={fotoPreview} alt="Preview" className="w-full h-full object-cover" />
              ) : (
                <div className="flex flex-col items-center text-[var(--muted)] group-hover:text-blue-500">
                  <Camera size={24} />
                  <span className="text-[10px] mt-1 font-medium">Foto</span>
                </div>
              )}
              <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity">
                <Camera size={20} />
              </div>
            </div>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFotoChange}
              accept="image/*"
              className="hidden"
            />
            <span className="text-xs text-[var(--muted)]">Toque para adicionar foto</span>
          </div>

          <div>
            <label className="label">Nome da Pessoa</label>
            <input
              type="text"
              className="input font-medium"
              placeholder="Ex: Thais, Luane, Alessandra..."
              value={form.nome}
              onChange={e => setForm({ ...form, nome: e.target.value })}
              required
            />
          </div>

          <div>
            <label className="label">WhatsApp / Telefone (com DDD)</label>
            <input
              type="text"
              className="input"
              placeholder="(12) 99999-9999"
              value={form.telefone}
              onChange={e => setForm({ ...form, telefone: e.target.value })}
            />
            <p className="text-xs text-[var(--muted)] mt-1">Usado para encaminhar o fechamento em PDF diretamente.</p>
          </div>

          <div>
            <label className="label">Cor de Identificação</label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                className="w-12 h-10 rounded-lg cursor-pointer border border-[var(--line)] bg-transparent"
                value={form.cor}
                onChange={e => setForm({ ...form, cor: e.target.value })}
              />
              <span className="text-xs text-[var(--muted)] font-mono uppercase">{form.cor}</span>
            </div>
          </div>

          <div className="flex gap-2 justify-end pt-3 border-t border-[var(--line)]">
            <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
            <button type="submit" disabled={submitting} className="btn-primary">
              {submitting ? 'Salvando...' : 'Salvar Pessoa'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ModalEditarPessoa({ pessoa, onClose, onSaved }) {
  const [form, setForm] = useState({
    nome: pessoa.nome || '',
    telefone: pessoa.telefone || '',
    cor: pessoa.cor || '#10B981',
  });
  const [fotoFile, setFotoFile] = useState(null);
  const [fotoPreview, setFotoPreview] = useState(pessoa.foto_path ? mediaUrl(pessoa.foto_path) : null);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef(null);

  const handleFotoChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setFotoFile(file);
      setFotoPreview(URL.createObjectURL(file));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await pessoasApi.atualizar(pessoa.id, form);

      if (fotoFile) {
        const formData = new FormData();
        formData.append('file', fotoFile);
        await pessoasApi.uploadFoto(pessoa.id, formData);
      }

      onSaved();
      onClose();
    } catch (err) {
      alert('Erro ao atualizar pessoa: ' + (err.response?.data?.detail || err.message));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[var(--surface)] text-[var(--ink)] rounded-3xl shadow-2xl w-full max-w-md p-6 border border-[var(--line)]">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-[var(--ink)]">Editar Pessoa</h2>
          <button onClick={onClose} className="p-1 text-[var(--muted)] hover:text-[var(--ink)] rounded-lg"><X size={20} /></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex flex-col items-center justify-center gap-2 pb-2">
            <div
              onClick={() => fileInputRef.current?.click()}
              className="relative w-20 h-20 rounded-full border-2 border-dashed border-[var(--line)] hover:border-blue-500 flex items-center justify-center cursor-pointer overflow-hidden group bg-[var(--raised)] transition-all shadow-sm"
              style={{ borderColor: form.cor }}
            >
              {fotoPreview ? (
                <img src={fotoPreview} alt="Preview" className="w-full h-full object-cover" />
              ) : (
                <div
                  className="w-full h-full flex items-center justify-center text-white text-2xl font-bold"
                  style={{ backgroundColor: form.cor }}
                >
                  {form.nome ? form.nome[0].toUpperCase() : <User size={28} />}
                </div>
              )}
              <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity">
                <Camera size={20} />
              </div>
            </div>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFotoChange}
              accept="image/*"
              className="hidden"
            />
            <span className="text-xs text-[var(--muted)]">Toque para alterar a foto</span>
          </div>

          <div>
            <label className="label">Nome da Pessoa</label>
            <input
              type="text"
              className="input font-medium"
              placeholder="Ex: Thais, Luane, Alessandra..."
              value={form.nome}
              onChange={e => setForm({ ...form, nome: e.target.value })}
              required
            />
          </div>

          <div>
            <label className="label">WhatsApp / Telefone (com DDD)</label>
            <input
              type="text"
              className="input"
              placeholder="(12) 99999-9999"
              value={form.telefone}
              onChange={e => setForm({ ...form, telefone: e.target.value })}
            />
          </div>

          <div>
            <label className="label">Cor de Identificação</label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                className="w-12 h-10 rounded-lg cursor-pointer border border-[var(--line)] bg-transparent"
                value={form.cor}
                onChange={e => setForm({ ...form, cor: e.target.value })}
              />
              <span className="text-xs text-[var(--muted)] font-mono uppercase">{form.cor}</span>
            </div>
          </div>

          <div className="flex gap-2 justify-end pt-3 border-t border-[var(--line)]">
            <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
            <button type="submit" disabled={submitting} className="btn-primary">
              {submitting ? 'Salvando...' : 'Salvar Alterações'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ModalRegistrarPagamento({ pessoa, contas, defaultDate, onClose, onSaved }) {
  const [form, setForm] = useState({
    valor: '',
    data: defaultDate || todayLocalISO(),
    observacao: '',
    forma: 'dinheiro',
    outra_forma: '',
    conta_id: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await pessoasApi.registrarPagamento(pessoa.id, {
        valor: parseFloat(form.valor),
        data: form.data,
        observacao: form.observacao,
        forma: form.forma,
        outra_forma: form.forma === 'outro' ? form.outra_forma : null,
        conta_id: form.conta_id ? parseInt(form.conta_id, 10) : null,
      });
      onSaved();
      onClose();
    } catch (err) {
      alert('Erro ao registrar pagamento: ' + (err.response?.data?.detail || err.message));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[var(--surface)] text-[var(--ink)] rounded-3xl shadow-2xl w-full max-w-md max-h-[90dvh] overflow-y-auto p-6 border border-[var(--line)]">
        <h2 className="text-lg font-bold text-[var(--ink)] mb-0.5">Registrar Pagamento Recebido</h2>
        <p className="text-xs text-[var(--muted)] mb-4">Recebimento de: <strong className="text-[var(--ink)]">{pessoa.nome}</strong></p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Valor Pago (R$)</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              className="input text-base font-bold text-[var(--ink)]"
              placeholder="0,00"
              value={form.valor}
              onChange={e => setForm({ ...form, valor: e.target.value })}
              required
            />
          </div>

          <div>
            <label className="label">Data do Recebimento</label>
            <input
              type="date"
              className="input"
              value={form.data}
              onChange={e => setForm({ ...form, data: e.target.value })}
              required
            />
          </div>

          <label className="block">
            <span className="label">Forma de pagamento</span>
            <select
              className="input"
              value={form.forma}
              onChange={e => setForm({ ...form, forma: e.target.value, conta_id: '' })}
            >
              {PAYMENT_FORM_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>
          {form.forma === 'outro' && (
            <label className="block">
              <span className="label">Qual foi a forma de pagamento?</span>
              <input
                className="input"
                value={form.outra_forma}
                maxLength={100}
                required
                onChange={e => setForm({ ...form, outra_forma: e.target.value })}
              />
            </label>
          )}
          {['pix', 'transferencia', 'outro'].includes(form.forma) && (
            <label className="block">
              <span className="label">Conta de destino</span>
              <select
                className="input"
                value={form.conta_id}
                onChange={e => setForm({ ...form, conta_id: e.target.value })}
              >
                <option value="">Sem vincular a uma conta</option>
                {contas.map(c => <option key={c.id} value={c.id}>{c.nome} ({c.banco})</option>)}
              </select>
            </label>
          )}
          {form.forma === 'abatimento' && (
            <p className="text-sm text-[var(--muted)]">O valor será descontado do saldo da pessoa, sem entrada em conta.</p>
          )}

          <div>
            <label className="label">Observação / Comprovante</label>
            <input
              type="text"
              className="input"
              placeholder="Ex: Pix recebido, pagamento parcial..."
              value={form.observacao}
              onChange={e => setForm({ ...form, observacao: e.target.value })}
            />
          </div>

          <div className="flex gap-2 justify-end pt-3 border-t border-[var(--line)]">
            <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
            <button type="submit" disabled={submitting} className="btn-success">
              {submitting ? 'Registrando...' : 'Registrar Pagamento'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ModalZerarPessoa({ pessoa, mesInicial, anoInicial, temLancamentosMes = true, saldoDevedorMes = 0, onClose, onSaved }) {
  const hoje = new Date();
  const semComprasMasComDividaAnterior = Boolean(mesInicial && !temLancamentosMes && saldoDevedorMes > 0);
  const [opcao, setOpcao] = useState(
    mesInicial && !semComprasMasComDividaAnterior ? 'mes' : 'tudo'
  );
  const [abaterEscopo, setAbaterEscopo] = useState(mesInicial ? 'mes' : 'tudo');
  const [mes, setMes] = useState(mesInicial || (hoje.getMonth() + 1));
  const [ano, setAno] = useState(anoInicial || hoje.getFullYear());
  const [limparPagamentos, setLimparPagamentos] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const handleConfirmar = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload =
        opcao === 'abater'
          ? (
              abaterEscopo === 'tudo'
                ? { modo: 'abater_divida', escopo: 'tudo' }
                : { modo: 'abater_divida', escopo: 'mes', mes: Number(mes), ano: Number(ano) }
            )
          : opcao === 'mes'
            ? { modo: 'apagar_lancamentos', escopo: 'mes', mes: Number(mes), ano: Number(ano), limpar_pagamentos: limparPagamentos }
            : { modo: 'apagar_lancamentos', escopo: 'tudo', limpar_pagamentos: limparPagamentos };

      await pessoasApi.zerar(pessoa.id, payload);
      onSaved();
      onClose();
    } catch (err) {
      alert('Erro ao zerar gastos: ' + (err.response?.data?.detail || err.message));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/65 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[var(--surface)] text-[var(--ink)] rounded-3xl shadow-2xl w-full max-w-lg max-h-[92dvh] overflow-y-auto p-6 border border-[var(--line)] space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/15 text-amber-500 flex items-center justify-center shrink-0">
              <Eraser size={20} />
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-[var(--ink)]">Zerar Gastos / Dívida — {pessoa.nome}</h2>
              <p className="text-xs text-emerald-500 font-semibold">
                ✓ O cadastro, foto, WhatsApp e link de {pessoa.nome} continuarão salvos!
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-[var(--muted)] hover:text-[var(--ink)]">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleConfirmar} className="space-y-3.5">
          {semComprasMasComDividaAnterior && (
            <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/25 text-xs text-amber-500">
              Este mês possui saldo pendente vindo de meses anteriores (<strong>{fmt(saldoDevedorMes)}</strong>). Para zerar tudo, mantenha <strong>Zerar Conta Completa</strong> ou escolha <strong>Apenas Quitar / Perdoar Dívida</strong>.
            </div>
          )}

          <label
            className={`block p-3.5 rounded-2xl border cursor-pointer transition-all ${
              opcao === 'tudo'
                ? 'border-blue-500 bg-[var(--accent-tint)] ring-2 ring-blue-500/20'
                : 'border-[var(--line)] bg-[var(--raised)]'
            }`}
          >
            <div className="flex items-start gap-3">
              <input type="radio" name="opcaoZerar" checked={opcao === 'tudo'} onChange={() => setOpcao('tudo')} className="mt-1" />
              <div>
                <span className="font-bold text-sm text-[var(--ink)] block">Zerar Conta Completa (Apagar todos os lançamentos)</span>
                <span className="text-xs text-[var(--muted)] block mt-0.5">
                  Cancela todas as compras/parcelas de {pessoa.nome} e deixa a conta zerada em R$ 0,00.
                </span>
              </div>
            </div>
          </label>

          <label
            className={`block p-3.5 rounded-2xl border cursor-pointer transition-all ${
              opcao === 'mes'
                ? 'border-blue-500 bg-[var(--accent-tint)] ring-2 ring-blue-500/20'
                : 'border-[var(--line)] bg-[var(--raised)]'
            }`}
          >
            <div className="flex items-start gap-3">
              <input type="radio" name="opcaoZerar" checked={opcao === 'mes'} onChange={() => setOpcao('mes')} className="mt-1" />
              <div className="flex-1">
                <span className="font-bold text-sm text-[var(--ink)] block">Limpar Apenas os Lançamentos de um Mês Específico</span>
                <span className="text-xs text-[var(--muted)] block mt-0.5">
                  Remove somente as parcelas e registros do mês selecionado abaixo, mantendo outros meses.
                </span>
              </div>
            </div>
          </label>

          <label
            className={`block p-3.5 rounded-2xl border cursor-pointer transition-all ${
              opcao === 'abater'
                ? 'border-blue-500 bg-[var(--accent-tint)] ring-2 ring-blue-500/20'
                : 'border-[var(--line)] bg-[var(--raised)]'
            }`}
          >
            <div className="flex items-start gap-3">
              <input type="radio" name="opcaoZerar" checked={opcao === 'abater'} onChange={() => setOpcao('abater')} className="mt-1" />
              <div>
                <span className="font-bold text-sm text-[var(--ink)] block">Apenas Quitar / Perdoar Dívida (Manter compras na fatura do cartão)</span>
                <span className="text-xs text-[var(--muted)] block mt-0.5">
                  Registra um abatimento automático deixando o saldo devedor de {pessoa.nome} em R$ 0,00 sem apagar as compras do cartão.
                </span>
              </div>
            </div>
          </label>

          {opcao === 'abater' && (
            <div className="p-3 rounded-2xl bg-[var(--raised)] border border-[var(--line)] space-y-2 text-xs">
              <span className="label mb-1">Alcance do abatimento</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setAbaterEscopo('tudo')}
                  className={`p-2.5 rounded-xl border text-left font-bold transition-all ${
                    abaterEscopo === 'tudo'
                      ? 'border-blue-500 bg-[var(--accent-tint)] text-blue-500'
                      : 'border-[var(--line)] bg-[var(--surface)] text-[var(--muted)]'
                  }`}
                >
                  Toda a dívida (incluindo parcelas futuras)
                </button>
                <button
                  type="button"
                  onClick={() => setAbaterEscopo('mes')}
                  className={`p-2.5 rounded-xl border text-left font-bold transition-all ${
                    abaterEscopo === 'mes'
                      ? 'border-blue-500 bg-[var(--accent-tint)] text-blue-500'
                      : 'border-[var(--line)] bg-[var(--surface)] text-[var(--muted)]'
                  }`}
                >
                  Somente até um mês específico
                </button>
              </div>
            </div>
          )}

          {(opcao === 'mes' || (opcao === 'abater' && abaterEscopo === 'mes')) && (
            <div className="grid grid-cols-2 gap-3 p-3 rounded-2xl bg-[var(--raised)] border border-[var(--line)]">
              <div>
                <label className="label">Mês</label>
                <select className="input" value={mes} onChange={(e) => setMes(Number(e.target.value))}>
                  {MESES_NOMES.map((mNome, i) => (
                    <option key={i + 1} value={i + 1}>{mNome}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Ano</label>
                <input
                  type="number"
                  min="2020"
                  max="2040"
                  className="input"
                  value={ano}
                  onChange={(e) => setAno(Number(e.target.value))}
                />
              </div>
            </div>
          )}

          {opcao !== 'abater' && (
            <label className="flex items-center gap-2.5 p-3 rounded-xl bg-[var(--raised)] border border-[var(--line)] text-xs cursor-pointer">
              <input type="checkbox" checked={limparPagamentos} onChange={(e) => setLimparPagamentos(e.target.checked)} />
              <span className="text-[var(--ink)] font-medium">
                Limpar também os pagamentos recebidos no período (evita ficar saldo de crédito sobrando)
              </span>
            </label>
          )}

          <div className="flex gap-2 justify-end pt-3 border-t border-[var(--line)]">
            <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
            <button type="submit" disabled={submitting} className="btn-primary">
              {submitting ? 'Processando...' : 'Confirmar e Zerar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ModalConfirmarExclusaoPessoa({ pessoa, onClose, onOpenZerar, onDeleted }) {
  const [deleting, setDeleting] = useState(false);

  const confirmarRemocaoCadastro = async () => {
    setDeleting(true);
    try {
      await pessoasApi.deletar(pessoa.id);
      onDeleted();
      onClose();
    } catch (err) {
      alert('Erro ao remover pessoa: ' + (err.response?.data?.detail || err.message));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/65 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[var(--surface)] text-[var(--ink)] rounded-3xl shadow-2xl w-full max-w-md p-6 border border-[var(--line)] space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-rose-500/15 text-rose-500 flex items-center justify-center shrink-0">
              <AlertTriangle size={20} />
            </div>
            <h3 className="font-extrabold text-lg text-[var(--ink)]">O que deseja fazer com {pessoa.nome}?</h3>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-[var(--muted)] hover:text-[var(--ink)]">
            <X size={20} />
          </button>
        </div>

        <p className="text-xs text-[var(--muted)] leading-relaxed">
          Se você quer apenas <strong>limpar os gastos, parcelas ou zerar a dívida</strong>, escolha a primeira opção abaixo para manter o cadastro, foto e link de {pessoa.nome}!
        </p>

        <div className="space-y-2.5 pt-1">
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenZerar();
            }}
            className="btn-primary w-full py-3 text-sm font-bold flex items-center justify-center gap-2"
          >
            <Eraser size={17} />
            <span>Apenas Zerar Gastos / Dívida (Manter {pessoa.nome})</span>
          </button>

          <button
            type="button"
            disabled={deleting}
            onClick={confirmarRemocaoCadastro}
            className="btn-danger w-full py-2.5 text-xs font-bold flex items-center justify-center gap-2"
          >
            <Trash2 size={15} />
            <span>{deleting ? 'Removendo...' : `Remover Cadastro de ${pessoa.nome}`}</span>
          </button>

          <button type="button" onClick={onClose} className="btn-secondary w-full py-2 text-xs">Cancelar</button>
        </div>
      </div>
    </div>
  );
}

function ModalExcluirLancamentoPessoa({ item, nomeMes, onClose, onSaved }) {
  const [loading, setLoading] = useState(false);
  const temMultiplasParcelas = (item.total_parcelas || 1) > 1;

  const cancelarSoParcela = async () => {
    setLoading(true);
    try {
      await lancamentosApi.alterarParcelaStatus(item.lancamento_id, item.numero, 'cancelado');
      onSaved();
      onClose();
    } catch (err) {
      alert('Erro ao cancelar parcela: ' + (err.response?.data?.detail || err.message));
    } finally {
      setLoading(false);
    }
  };

  const excluirCompraInteira = async () => {
    setLoading(true);
    try {
      await lancamentosApi.cancelar(item.lancamento_id);
      onSaved();
      onClose();
    } catch (err) {
      alert('Erro ao excluir lançamento: ' + (err.response?.data?.detail || err.message));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/65 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[var(--surface)] text-[var(--ink)] rounded-3xl shadow-2xl w-full max-w-md p-6 border border-[var(--line)] space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-extrabold text-base text-[var(--ink)]">Excluir Lançamento</h3>
          <button type="button" onClick={onClose} className="p-1 text-[var(--muted)] hover:text-[var(--ink)]">
            <X size={20} />
          </button>
        </div>

        <div className="p-3.5 rounded-2xl bg-[var(--raised)] border border-[var(--line)] text-xs space-y-1">
          <p className="font-bold text-sm text-[var(--ink)]">{item.descricao}</p>
          <p className="text-[var(--muted)]">
            Parcela: <strong>{item.parcela}</strong> • Valor em {nomeMes}: <strong>{fmt(item.valor)}</strong>
          </p>
        </div>

        <div className="space-y-2">
          {temMultiplasParcelas && (
            <button
              type="button"
              disabled={loading}
              onClick={cancelarSoParcela}
              className="btn-primary w-full py-2.5 text-xs font-bold flex items-center justify-center gap-2"
            >
              <Eraser size={15} />
              <span>Remover Só Esta Parcela ({item.parcela} em {nomeMes})</span>
            </button>
          )}

          <button
            type="button"
            disabled={loading}
            onClick={excluirCompraInteira}
            className="btn-danger w-full py-2.5 text-xs font-bold flex items-center justify-center gap-2"
          >
            <Trash2 size={15} />
            <span>
              {loading
                ? 'Excluindo...'
                : temMultiplasParcelas
                  ? `Excluir Compra Inteira (${item.total_parcelas}x)`
                  : 'Confirmar Exclusão deste Lançamento'}
            </span>
          </button>

          <button type="button" onClick={onClose} className="btn-secondary w-full py-2 text-xs">Cancelar</button>
        </div>
      </div>
    </div>
  );
}

function ModalLinkLancamento({ pessoa, onClose }) {
  const [copiado, setCopiado] = useState(false);
  const { usuario } = useAuth();
  const nomeGestor = usuario?.nome || 'Administração Financeira';
  const link = `${publicShareOrigin()}/lancar/${pessoa.token_acesso}`;

  const mensagemWhats = `Olá, *${pessoa.nome}*! 👋\n\nAqui está o seu link pessoal e exclusivo para lançar compras e comprovantes direto do seu celular (${nomeGestor}):\n\n👉 ${link}\n\n💡 *Dica:* Salve este link nos seus favoritos ou adicione na tela inicial do seu celular para enviar compras sempre que usar o cartão!`;

  const copiar = () => {
    navigator.clipboard.writeText(link);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2500);
  };

  const enviarWhatsApp = () => {
    const numLimpo = String(pessoa.telefone || '').replace(/\D/g, '');
    const telFinal = numLimpo.startsWith('55') ? numLimpo : `55${numLimpo}`;
    const urlWa = numLimpo
      ? `https://wa.me/${telFinal}?text=${encodeURIComponent(mensagemWhats)}`
      : `https://web.whatsapp.com/send?text=${encodeURIComponent(mensagemWhats)}`;
    window.open(urlWa, '_blank');
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="card rounded-3xl shadow-2xl w-full max-w-md p-6 border border-slate-700/60 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link2 className="text-blue-500" size={22} />
            <h3 className="font-bold text-[var(--ink)] text-lg">Link de Celular — {pessoa.nome}</h3>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-[var(--ink)]">
            <X size={20} />
          </button>
        </div>

        <div className="flex items-center gap-3.5 p-3 rounded-2xl border border-slate-700/40" style={{ backgroundColor: 'var(--raised)' }}>
          <Avatar nome={pessoa.nome} foto={pessoa.foto_path} cor={pessoa.cor} className="w-12 h-12 rounded-2xl shrink-0" />
          <div className="min-w-0">
            <p className="font-extrabold text-[var(--ink)] text-base truncate">{pessoa.nome}</p>
            <p className="text-xs text-slate-400 truncate">{pessoa.telefone || 'Sem telefone cadastrado'}</p>
          </div>
        </div>

        <div>
          <label className="label text-[var(--ink)] font-semibold">Link Pessoal de Lançamento (Nuvem 24/7)</label>
          <div className="flex items-center gap-2">
            <input type="text" readOnly value={link} className="input text-xs font-mono select-all" />
            <button
              type="button"
              onClick={copiar}
              className={`px-3.5 py-2.5 rounded-xl text-xs font-bold shrink-0 transition-all flex items-center gap-1.5 ${
                copiado ? 'bg-emerald-600 text-white shadow' : 'btn-secondary text-blue-500'
              }`}
            >
              {copiado ? <CheckCircle size={15} /> : <Share2 size={15} />}
              <span>{copiado ? 'Copiado!' : 'Copiar'}</span>
            </button>
          </div>
        </div>

        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-500 space-y-1">
          <strong>✅ Link HTTPS 24/7 sincronizado entre Celular e PC:</strong>
          <p>
            Funciona em qualquer celular (Wi-Fi, 4G ou 5G). Toda compra ou foto enviada por {pessoa.nome} fica sincronizada com segurança no seu painel.
          </p>
        </div>

        <div className="space-y-2 pt-2 border-t border-[var(--line)]">
          <button
            type="button"
            onClick={enviarWhatsApp}
            className="btn-primary w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20"
          >
            <MessageCircle size={18} />
            <span>Enviar Mensagem Pronta pelo WhatsApp</span>
          </button>

          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className="btn-secondary w-full py-2.5 text-xs text-center block"
          >
            Abrir e Testar Tela no Navegador
          </a>
        </div>
      </div>
    </div>
  );
}

/**
 * Linha inline editável da planilha de Compras & Parcelas do mês.
 * Cada célula salva automaticamente no blur / Enter / mudança de select.
 */
function LinhaLancamentoEditavel({
  item,
  cartoes,
  contas,
  savedHighlight,
  onSaveLaunch,
  onSaveParcela,
  onValidationError,
  onRequestDelete,
}) {
  const [dataVal, setDataVal] = useState(item.data_lancamento || '');
  const [descVal, setDescVal] = useState(item.descricao || '');
  const [originVal, setOriginVal] = useState(encodeOriginValue(item));
  const [valorVal, setValorVal] = useState(formatEditableBrl(item.valor));
  const [statusVal, setStatusVal] = useState(item.status || 'pendente');
  const focusedFieldRef = useRef(null);

  useEffect(() => {
    if (focusedFieldRef.current !== 'data') setDataVal(item.data_lancamento || '');
    if (focusedFieldRef.current !== 'descricao') setDescVal(item.descricao || '');
    if (focusedFieldRef.current !== 'origin') setOriginVal(encodeOriginValue(item));
    if (focusedFieldRef.current !== 'valor') setValorVal(formatEditableBrl(item.valor));
    if (focusedFieldRef.current !== 'status') setStatusVal(item.status || 'pendente');
  }, [item.data_lancamento, item.descricao, item.cartao_id, item.conta_id, item.valor, item.status]);

  const cardDotColor = useMemo(() => {
    if (originVal.startsWith('card:')) {
      const cid = Number(originVal.slice(5));
      const found = cartoes.find(c => c.id === cid);
      if (found) return getCardBrand(found.nome, found.cor).color;
      if (item.cartao) return getCardBrand(item.cartao, item.cartao_cor).color;
    }
    return null;
  }, [originVal, cartoes, item.cartao, item.cartao_cor]);

  const cardMissingFromList = Boolean(
    item.cartao_id && !cartoes.some(c => c.id === item.cartao_id)
  );
  const contaMissingFromList = Boolean(
    item.conta_id && !contas.some(c => c.id === item.conta_id)
  );

  const commitDescricao = async () => {
    focusedFieldRef.current = null;
    const trimmed = descVal.trim();
    if (!trimmed) {
      setDescVal(item.descricao || '');
      onValidationError('A descrição não pode ficar vazia.');
      return;
    }
    if (trimmed === (item.descricao || '').trim()) return;
    const ok = await onSaveLaunch(item, { descricao: trimmed });
    if (!ok) setDescVal(item.descricao || '');
  };

  const commitData = async (nextDate) => {
    setDataVal(nextDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) return;
    if (nextDate === item.data_lancamento) return;
    const ok = await onSaveLaunch(item, { data_lancamento: nextDate });
    if (!ok) setDataVal(item.data_lancamento || '');
  };

  const commitOrigin = async (nextOrigin) => {
    const prev = originVal;
    setOriginVal(nextOrigin);
    if (nextOrigin === encodeOriginValue(item)) return;
    const patch = decodeOriginPatch(nextOrigin, item.tipo);
    if (!patch) {
      setOriginVal(prev);
      return;
    }
    const ok = await onSaveLaunch(item, patch);
    if (!ok) setOriginVal(prev);
  };

  const commitValor = async () => {
    focusedFieldRef.current = null;
    const parsed = parseBrlNumber(valorVal);
    if (parsed === null) {
      setValorVal(formatEditableBrl(item.valor));
      onValidationError('Informe um valor válido maior que zero.');
      return;
    }
    setValorVal(formatEditableBrl(parsed));
    if (Math.abs(parsed - Number(item.valor || 0)) < 0.005) return;
    const ok = await onSaveParcela(item, { valor: parsed });
    if (!ok) setValorVal(formatEditableBrl(item.valor));
  };

  const commitStatus = async (nextStatus) => {
    const prev = statusVal;
    setStatusVal(nextStatus);
    if (nextStatus === item.status) return;
    const ok = await onSaveParcela(item, { status: nextStatus });
    if (!ok) setStatusVal(prev);
  };

  return (
    <tr
      data-testid={`launch-row-${item.lancamento_id}-${item.numero}`}
      className={savedHighlight ? 'sheet-row--saved' : ''}
    >
      {/* Data */}
      <td className="w-[8.6rem]">
        <input
          type="date"
          aria-label={`Data de ${item.descricao}`}
          data-testid={`cell-date-${item.lancamento_id}-${item.numero}`}
          className="sheet-cell-input font-mono text-xs"
          value={dataVal}
          onFocus={() => { focusedFieldRef.current = 'data'; }}
          onBlur={() => { focusedFieldRef.current = null; }}
          onChange={(e) => commitData(e.target.value)}
        />
      </td>

      {/* Descrição */}
      <td className="min-w-[14rem]">
        <input
          type="text"
          aria-label={`Descrição do lançamento ${item.lancamento_id}`}
          data-testid={`cell-desc-${item.lancamento_id}-${item.numero}`}
          className="sheet-cell-input font-semibold"
          value={descVal}
          onFocus={() => { focusedFieldRef.current = 'descricao'; }}
          onChange={(e) => setDescVal(e.target.value)}
          onBlur={commitDescricao}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              setDescVal(item.descricao || '');
              focusedFieldRef.current = null;
              e.currentTarget.blur();
            }
          }}
        />
      </td>

      {/* Cartão / Origem */}
      <td className="min-w-[12.5rem]">
        <div className="flex items-center gap-1.5 pl-1">
          {cardDotColor ? (
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: cardDotColor }}
              title="Cor do cartão"
            />
          ) : (
            <span className="w-2.5 h-2.5 rounded-full shrink-0 bg-slate-400/60" />
          )}
          <select
            aria-label={`Cartão ou origem de ${item.descricao}`}
            data-testid={`cell-origin-${item.lancamento_id}-${item.numero}`}
            className="sheet-cell-select text-xs font-medium"
            value={originVal}
            onFocus={() => { focusedFieldRef.current = 'origin'; }}
            onBlur={() => { focusedFieldRef.current = null; }}
            onChange={(e) => commitOrigin(e.target.value)}
          >
            {cartoes.length > 0 && (
              <optgroup label="Cartões de Crédito">
                {cartoes.map((c) => (
                  <option key={c.id} value={`card:${c.id}`}>
                    💳 {c.nome}
                  </option>
                ))}
              </optgroup>
            )}
            {cardMissingFromList && (
              <option value={`card:${item.cartao_id}`}>💳 {item.cartao || `Cartão #${item.cartao_id}`}</option>
            )}
            {contas.length > 0 && (
              <optgroup label="Contas Bancárias">
                {contas.map((ct) => (
                  <option key={ct.id} value={`account:${ct.id}`}>
                    🏦 {ct.nome}
                  </option>
                ))}
              </optgroup>
            )}
            {contaMissingFromList && (
              <option value={`account:${item.conta_id}`}>🏦 {item.conta || `Conta #${item.conta_id}`}</option>
            )}
            <option value="cash">💵 Dinheiro / Sem cartão</option>
          </select>
        </div>
      </td>

      {/* Parcela */}
      <td className="w-[6.4rem] text-center">
        <div className="flex flex-col items-center gap-0.5">
          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-[var(--accent-tint)] text-blue-500">
            {item.parcela}
          </span>
          {item.tipo === 'compra_para_mim' && (
            <span className="text-[9px] font-bold text-emerald-500 uppercase">Abatimento</span>
          )}
          {item.tipo === 'reembolso_pessoa' && (
            <span className="text-[9px] font-bold text-amber-500 uppercase">Reembolso</span>
          )}
        </div>
      </td>

      {/* Valor (R$) */}
      <td className="w-[8.2rem]">
        <input
          type="text"
          inputMode="decimal"
          aria-label={`Valor de ${item.descricao}`}
          data-testid={`cell-valor-${item.lancamento_id}-${item.numero}`}
          className="sheet-cell-input sheet-cell-input--money"
          value={valorVal}
          onFocus={(e) => {
            focusedFieldRef.current = 'valor';
            e.target.select();
          }}
          onChange={(e) => setValorVal(e.target.value)}
          onBlur={commitValor}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              setValorVal(formatEditableBrl(item.valor));
              focusedFieldRef.current = null;
              e.currentTarget.blur();
            }
          }}
        />
      </td>

      {/* Status */}
      <td className="w-[7.5rem]">
        <select
          aria-label={`Status de ${item.descricao}`}
          data-testid={`cell-status-${item.lancamento_id}-${item.numero}`}
          className={`sheet-cell-select text-xs font-extrabold text-center rounded-full cursor-pointer ${
            statusVal === 'pago'
              ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
              : 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30'
          }`}
          value={statusVal}
          onFocus={() => { focusedFieldRef.current = 'status'; }}
          onBlur={() => { focusedFieldRef.current = null; }}
          onChange={(e) => commitStatus(e.target.value)}
        >
          <option value="pendente">Pendente</option>
          <option value="pago">Pago</option>
        </select>
      </td>

      {/* Excluir */}
      <td className="w-[3.4rem] text-center">
        <button
          type="button"
          data-testid={`cell-delete-${item.lancamento_id}-${item.numero}`}
          onClick={() => onRequestDelete(item)}
          className="p-1.5 text-[var(--muted)] hover:text-rose-500 hover:bg-rose-500/10 rounded-lg transition-colors"
          title="Excluir este lançamento ou parcela"
        >
          <Trash2 size={15} />
        </button>
      </td>
    </tr>
  );
}

/**
 * Linha "+ Nova Linha" embutida na planilha de lançamentos do mês.
 */
function LinhaNovoLancamento({ pessoa, mes, ano, cartoes, contas, onCreated, onError }) {
  const defaultOrigin = cartoes.length > 0 ? `card:${cartoes[0].id}` : (contas.length > 0 ? `account:${contas[0].id}` : 'cash');
  const [data, setData] = useState(() => defaultDateForMonth(mes, ano));
  const [descricao, setDescricao] = useState('');
  const [origin, setOrigin] = useState(defaultOrigin);
  const [parcelas, setParcelas] = useState(1);
  const [valor, setValor] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const descRef = useRef(null);

  useEffect(() => {
    setData(defaultDateForMonth(mes, ano));
  }, [mes, ano]);

  useEffect(() => {
    if (origin === 'cash' && cartoes.length > 0) {
      setOrigin(`card:${cartoes[0].id}`);
    }
  }, [cartoes.length]);

  const isCardOrigin = origin.startsWith('card:');

  const handleAdd = async () => {
    if (submitting) return;
    const descLimpa = descricao.trim();
    if (!descLimpa) {
      onError('Digite a descrição na nova linha antes de adicionar.');
      descRef.current?.focus();
      return;
    }
    const valorParsed = parseBrlNumber(valor);
    if (valorParsed === null) {
      onError('Informe um valor válido maior que zero na nova linha.');
      return;
    }
    const patch = decodeOriginPatch(origin, 'compra_cartao');
    if (!patch) {
      onError('Selecione um cartão ou origem válida.');
      return;
    }

    setSubmitting(true);
    try {
      await lancamentosApi.criar({
        descricao: descLimpa,
        tipo: patch.tipo,
        valor_total: valorParsed,
        total_parcelas: isCardOrigin ? Math.max(1, Math.min(120, Number(parcelas) || 1)) : 1,
        data_lancamento: data || defaultDateForMonth(mes, ano),
        mes_fatura: Number(mes),
        ano_fatura: Number(ano),
        cartao_id: patch.cartao_id,
        conta_id: patch.conta_id,
        pessoa_id: pessoa.id,
      });
      setDescricao('');
      setValor('');
      setParcelas(1);
      await onCreated();
      descRef.current?.focus();
    } catch (err) {
      onError(err?.response?.data?.detail || err.message || 'Erro ao adicionar nova linha.');
    } finally {
      setSubmitting(false);
    }
  };

  const onKeyDownSubmit = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <tr className="sheet-row--new" data-testid="spreadsheet-new-launch-row">
      <td>
        <input
          type="date"
          aria-label="Data da nova linha"
          data-testid="new-launch-date"
          className="sheet-cell-input font-mono text-xs"
          value={data}
          onChange={(e) => setData(e.target.value)}
        />
      </td>
      <td>
        <input
          ref={descRef}
          type="text"
          aria-label="Descrição da nova linha"
          data-testid="new-launch-desc"
          className="sheet-cell-input font-medium"
          placeholder="+ Nova linha: digite a compra ou gasto..."
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          onKeyDown={onKeyDownSubmit}
        />
      </td>
      <td>
        <select
          aria-label="Cartão ou origem da nova linha"
          data-testid="new-launch-origin"
          className="sheet-cell-select text-xs font-medium"
          value={origin}
          onChange={(e) => setOrigin(e.target.value)}
        >
          {cartoes.length > 0 && (
            <optgroup label="Cartões de Crédito">
              {cartoes.map((c) => (
                <option key={c.id} value={`card:${c.id}`}>💳 {c.nome}</option>
              ))}
            </optgroup>
          )}
          {contas.length > 0 && (
            <optgroup label="Contas Bancárias">
              {contas.map((ct) => (
                <option key={ct.id} value={`account:${ct.id}`}>🏦 {ct.nome}</option>
              ))}
            </optgroup>
          )}
          <option value="cash">💵 Dinheiro / Sem cartão</option>
        </select>
      </td>
      <td className="text-center">
        {isCardOrigin ? (
          <select
            aria-label="Número de parcelas"
            data-testid="new-launch-parcelas"
            className="sheet-cell-select text-xs font-bold text-center"
            value={parcelas}
            onChange={(e) => setParcelas(Number(e.target.value))}
          >
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 18, 24].map((n) => (
              <option key={n} value={n}>{n === 1 ? 'À vista' : `${n}x`}</option>
            ))}
          </select>
        ) : (
          <span className="text-[11px] text-[var(--muted)] font-semibold">À vista</span>
        )}
      </td>
      <td>
        <input
          type="text"
          inputMode="decimal"
          aria-label="Valor da nova linha"
          data-testid="new-launch-valor"
          className="sheet-cell-input sheet-cell-input--money"
          placeholder="0,00"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          onKeyDown={onKeyDownSubmit}
        />
      </td>
      <td colSpan={2} className="text-right pr-2">
        <button
          type="button"
          data-testid="new-launch-submit"
          disabled={submitting}
          onClick={handleAdd}
          className="btn-primary w-full py-1.5 px-2.5 text-xs font-bold"
        >
          {submitting ? <Loader2 size={13} className="animate-spin" /> : <Plus size={14} />}
          <span>{submitting ? 'Salvando...' : 'Nova Linha'}</span>
        </button>
      </td>
    </tr>
  );
}

/**
 * Linha inline editável da planilha de Pagamentos Recebidos no mês.
 */
function LinhaPagamentoEditavel({
  pag,
  contas,
  savedHighlight,
  onSavePayment,
  onValidationError,
  onDeletePayment,
}) {
  const initialForma = pag.forma_codigo || normalizePaymentFormaCode(pag.forma_pagamento, pag.conta_id);
  const [dataVal, setDataVal] = useState(pag.data || '');
  const [formaVal, setFormaVal] = useState(initialForma);
  const [outraFormaVal, setOutraFormaVal] = useState(initialForma === 'outro' ? (pag.forma_pagamento || '') : '');
  const [contaVal, setContaVal] = useState(pag.conta_id ? String(pag.conta_id) : '');
  const [valorVal, setValorVal] = useState(formatEditableBrl(pag.valor));
  const [obsVal, setObsVal] = useState(pag.observacao || '');
  const focusedRef = useRef(null);

  useEffect(() => {
    const nextForma = pag.forma_codigo || normalizePaymentFormaCode(pag.forma_pagamento, pag.conta_id);
    if (focusedRef.current !== 'data') setDataVal(pag.data || '');
    if (focusedRef.current !== 'forma') setFormaVal(nextForma);
    if (focusedRef.current !== 'outra_forma') setOutraFormaVal(nextForma === 'outro' ? (pag.forma_pagamento || '') : '');
    if (focusedRef.current !== 'conta') setContaVal(pag.conta_id ? String(pag.conta_id) : '');
    if (focusedRef.current !== 'valor') setValorVal(formatEditableBrl(pag.valor));
    if (focusedRef.current !== 'obs') setObsVal(pag.observacao || '');
  }, [pag.data, pag.forma_codigo, pag.forma_pagamento, pag.conta_id, pag.valor, pag.observacao]);

  const commitData = async (nextDate) => {
    setDataVal(nextDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDate) || nextDate === pag.data) return;
    const ok = await onSavePayment(pag, { data: nextDate });
    if (!ok) setDataVal(pag.data || '');
  };

  const commitForma = async (nextForma) => {
    const prevForma = formaVal;
    const prevConta = contaVal;
    setFormaVal(nextForma);
    if (nextForma === 'outro') {
      const texto = (outraFormaVal || 'Outro').trim();
      setOutraFormaVal(texto);
      const ok = await onSavePayment(pag, {
        forma: 'outro',
        outra_forma: texto,
        conta_id: contaVal ? Number(contaVal) : null,
      });
      if (!ok) setFormaVal(prevForma);
      return;
    }
    const semConta = nextForma === 'dinheiro' || nextForma === 'abatimento';
    if (semConta) setContaVal('');
    const ok = await onSavePayment(pag, {
      forma: nextForma,
      conta_id: semConta ? null : (contaVal ? Number(contaVal) : null),
    });
    if (!ok) {
      setFormaVal(prevForma);
      setContaVal(prevConta);
    }
  };

  const commitOutraForma = async () => {
    focusedRef.current = null;
    const txt = outraFormaVal.trim();
    if (!txt) {
      setOutraFormaVal(pag.forma_pagamento || 'Outro');
      onValidationError('Informe a forma de pagamento.');
      return;
    }
    if (txt === (pag.forma_pagamento || '').trim()) return;
    const ok = await onSavePayment(pag, { forma: 'outro', outra_forma: txt });
    if (!ok) setOutraFormaVal(pag.forma_pagamento || 'Outro');
  };

  const commitConta = async (nextConta) => {
    const prev = contaVal;
    setContaVal(nextConta);
    const nextId = nextConta ? Number(nextConta) : null;
    if (nextId === (pag.conta_id ?? null)) return;
    const ok = await onSavePayment(pag, { conta_id: nextId });
    if (!ok) setContaVal(prev);
  };

  const commitValor = async () => {
    focusedRef.current = null;
    const parsed = parseBrlNumber(valorVal);
    if (parsed === null) {
      setValorVal(formatEditableBrl(pag.valor));
      onValidationError('Informe um valor de pagamento válido maior que zero.');
      return;
    }
    setValorVal(formatEditableBrl(parsed));
    if (Math.abs(parsed - Number(pag.valor || 0)) < 0.005) return;
    const ok = await onSavePayment(pag, { valor: parsed });
    if (!ok) setValorVal(formatEditableBrl(pag.valor));
  };

  const commitObs = async () => {
    focusedRef.current = null;
    const trimmed = obsVal.trim();
    if (trimmed === (pag.observacao || '').trim()) return;
    const ok = await onSavePayment(pag, { observacao: trimmed });
    if (!ok) setObsVal(pag.observacao || '');
  };

  const permiteConta = ['pix', 'transferencia', 'outro'].includes(formaVal);

  return (
    <tr
      data-testid={`payment-row-${pag.id}`}
      className={savedHighlight ? 'sheet-row--saved' : ''}
    >
      <td className="w-[8.6rem]">
        <input
          type="date"
          aria-label={`Data do pagamento ${pag.id}`}
          data-testid={`pay-date-${pag.id}`}
          className="sheet-cell-input font-mono text-xs"
          value={dataVal}
          onFocus={() => { focusedRef.current = 'data'; }}
          onBlur={() => { focusedRef.current = null; }}
          onChange={(e) => commitData(e.target.value)}
        />
      </td>

      <td className="min-w-[14rem]">
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-1.5">
          <select
            aria-label={`Forma do pagamento ${pag.id}`}
            data-testid={`pay-forma-${pag.id}`}
            className="sheet-cell-select text-xs font-semibold"
            value={formaVal}
            onFocus={() => { focusedRef.current = 'forma'; }}
            onBlur={() => { focusedRef.current = null; }}
            onChange={(e) => commitForma(e.target.value)}
          >
            {PAYMENT_FORM_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          {formaVal === 'outro' && (
            <input
              type="text"
              aria-label={`Detalhe da forma de pagamento ${pag.id}`}
              className="sheet-cell-input text-xs max-w-[9rem]"
              value={outraFormaVal}
              placeholder="Qual forma?"
              onFocus={() => { focusedRef.current = 'outra_forma'; }}
              onChange={(e) => setOutraFormaVal(e.target.value)}
              onBlur={commitOutraForma}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
            />
          )}

          {permiteConta && contas.length > 0 && (
            <select
              aria-label={`Conta de destino do pagamento ${pag.id}`}
              data-testid={`pay-conta-${pag.id}`}
              className="sheet-cell-select text-[11px] text-[var(--muted)] max-w-[11rem]"
              value={contaVal}
              onFocus={() => { focusedRef.current = 'conta'; }}
              onBlur={() => { focusedRef.current = null; }}
              onChange={(e) => commitConta(e.target.value)}
            >
              <option value="">Sem conta</option>
              {contas.map((c) => (
                <option key={c.id} value={c.id}>🏦 {c.nome}</option>
              ))}
            </select>
          )}
        </div>
      </td>

      <td className="w-[8.6rem]">
        <input
          type="text"
          inputMode="decimal"
          aria-label={`Valor do pagamento ${pag.id}`}
          data-testid={`pay-valor-${pag.id}`}
          className="sheet-cell-input sheet-cell-input--money text-emerald-600 dark:text-emerald-400"
          value={valorVal}
          onFocus={(e) => {
            focusedRef.current = 'valor';
            e.target.select();
          }}
          onChange={(e) => setValorVal(e.target.value)}
          onBlur={commitValor}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              setValorVal(formatEditableBrl(pag.valor));
              focusedRef.current = null;
              e.currentTarget.blur();
            }
          }}
        />
      </td>

      <td className="min-w-[13rem]">
        <input
          type="text"
          aria-label={`Observação do pagamento ${pag.id}`}
          data-testid={`pay-obs-${pag.id}`}
          className="sheet-cell-input text-xs"
          placeholder="Adicionar observação..."
          value={obsVal}
          onFocus={() => { focusedRef.current = 'obs'; }}
          onChange={(e) => setObsVal(e.target.value)}
          onBlur={commitObs}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              setObsVal(pag.observacao || '');
              focusedRef.current = null;
              e.currentTarget.blur();
            }
          }}
        />
      </td>

      <td className="w-[3.4rem] text-center">
        <button
          type="button"
          data-testid={`pay-delete-${pag.id}`}
          onClick={() => onDeletePayment(pag)}
          className="p-1.5 text-[var(--muted)] hover:text-rose-500 hover:bg-rose-500/10 rounded-lg transition-colors"
          title="Excluir este pagamento"
        >
          <Trash2 size={15} />
        </button>
      </td>
    </tr>
  );
}

/**
 * Linha inline "+ Novo Pagamento" na tabela de pagamentos recebidos.
 */
function LinhaNovoPagamento({ pessoa, mes, ano, contas, onCreated, onError }) {
  const [data, setData] = useState(() => defaultDateForMonth(mes, ano));
  const [forma, setForma] = useState('pix');
  const [contaId, setContaId] = useState('');
  const [valor, setValor] = useState('');
  const [observacao, setObservacao] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setData(defaultDateForMonth(mes, ano));
  }, [mes, ano]);

  const permiteConta = ['pix', 'transferencia', 'outro'].includes(forma);

  const handleAdd = async () => {
    if (submitting) return;
    const parsed = parseBrlNumber(valor);
    if (parsed === null) {
      onError('Informe um valor válido maior que zero para registrar o pagamento.');
      return;
    }
    setSubmitting(true);
    try {
      await pessoasApi.registrarPagamento(pessoa.id, {
        valor: parsed,
        data: data || defaultDateForMonth(mes, ano),
        forma,
        outra_forma: forma === 'outro' ? 'Outro' : null,
        conta_id: permiteConta && contaId ? Number(contaId) : null,
        observacao: observacao.trim() || null,
      });
      setValor('');
      setObservacao('');
      await onCreated();
    } catch (err) {
      onError(err?.response?.data?.detail || err.message || 'Erro ao registrar pagamento.');
    } finally {
      setSubmitting(false);
    }
  };

  const onKeyDownSubmit = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <tr className="sheet-row--new" data-testid="spreadsheet-new-payment-row">
      <td>
        <input
          type="date"
          aria-label="Data do novo pagamento"
          data-testid="new-pay-date"
          className="sheet-cell-input font-mono text-xs"
          value={data}
          onChange={(e) => setData(e.target.value)}
        />
      </td>
      <td>
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-1.5">
          <select
            aria-label="Forma do novo pagamento"
            data-testid="new-pay-forma"
            className="sheet-cell-select text-xs font-semibold"
            value={forma}
            onChange={(e) => {
              const f = e.target.value;
              setForma(f);
              if (f === 'dinheiro' || f === 'abatimento') setContaId('');
            }}
          >
            {PAYMENT_FORM_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          {permiteConta && contas.length > 0 && (
            <select
              aria-label="Conta de destino do novo pagamento"
              data-testid="new-pay-conta"
              className="sheet-cell-select text-[11px] max-w-[11rem]"
              value={contaId}
              onChange={(e) => setContaId(e.target.value)}
            >
              <option value="">Sem conta</option>
              {contas.map((c) => (
                <option key={c.id} value={c.id}>🏦 {c.nome}</option>
              ))}
            </select>
          )}
        </div>
      </td>
      <td>
        <input
          type="text"
          inputMode="decimal"
          aria-label="Valor do novo pagamento"
          data-testid="new-pay-valor"
          className="sheet-cell-input sheet-cell-input--money text-emerald-600 dark:text-emerald-400"
          placeholder="0,00"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          onKeyDown={onKeyDownSubmit}
        />
      </td>
      <td>
        <input
          type="text"
          aria-label="Observação do novo pagamento"
          data-testid="new-pay-obs"
          className="sheet-cell-input text-xs"
          placeholder="+ Novo pagamento: obs. opcional..."
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          onKeyDown={onKeyDownSubmit}
        />
      </td>
      <td className="text-center">
        <button
          type="button"
          data-testid="new-pay-submit"
          disabled={submitting}
          onClick={handleAdd}
          className="btn-success py-1.5 px-2.5 text-xs font-bold"
          title="Registrar pagamento nesta linha"
        >
          {submitting ? <Loader2 size={13} className="animate-spin" /> : <Plus size={14} />}
        </button>
      </td>
    </tr>
  );
}

/**
 * Planilha Mensal Automática e Inline-Editável aberta ao clicar em uma pessoa.
 */
function PlanilhaPessoaMensal({
  pessoa,
  cartoes,
  contas,
  onRefreshParent,
  onClose,
  onDeletedPessoa,
}) {
  const { usuario } = useAuth();
  const nomeGestor = usuario?.nome || 'Administração Financeira';
  const hoje = useMemo(() => new Date(), []);
  const defaultMonthKey = monthKey(hoje.getFullYear(), hoje.getMonth() + 1);

  const [extrato, setExtrato] = useState(null);
  const [loadingExtrato, setLoadingExtrato] = useState(true);
  const [selectedMonthKey, setSelectedMonthKey] = useState(defaultMonthKey);
  const [saveBanner, setSaveBanner] = useState({ status: 'idle', message: '' });
  const [savedRowKey, setSavedRowKey] = useState(null);

  const [modalPagamento, setModalPagamento] = useState(false);
  const [modalEditar, setModalEditar] = useState(false);
  const [modalLink, setModalLink] = useState(false);
  const [modalZerar, setModalZerar] = useState(null);
  const [modalConfirmarExclusao, setModalConfirmarExclusao] = useState(false);
  const [itemExcluindo, setItemExcluindo] = useState(null);
  const [enviandoWhats, setEnviandoWhats] = useState(false);
  const [gerandoPdf, setGerandoPdf] = useState(false);

  const requestIdRef = useRef(0);
  const inFlightSavesRef = useRef(0);
  const savedTimerRef = useRef(null);
  const rowFlashTimerRef = useRef(null);

  const carregarExtrato = async ({ mes, ano, silent = false } = {}) => {
    const reqId = ++requestIdRef.current;
    if (!silent) setLoadingExtrato(true);
    try {
      const params = mes && ano ? { mes, ano } : undefined;
      const res = await pessoasApi.extrato(pessoa.id, params);
      if (reqId !== requestIdRef.current) return null;
      setExtrato(res.data);
      return res.data;
    } catch (e) {
      if (reqId === requestIdRef.current) {
        setSaveBanner({
          status: 'error',
          message: e?.response?.data?.detail || 'Erro ao carregar planilha da pessoa.',
        });
      }
      return null;
    } finally {
      if (reqId === requestIdRef.current) {
        setLoadingExtrato(false);
      }
    }
  };

  // Ao trocar de pessoa, abre automaticamente a planilha no mês atual
  useEffect(() => {
    const curKey = monthKey(new Date().getFullYear(), new Date().getMonth() + 1);
    setSelectedMonthKey(curKey);
    setExtrato(null);
    setSaveBanner({ status: 'idle', message: '' });
    carregarExtrato({ silent: false });

    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      if (rowFlashTimerRef.current) clearTimeout(rowFlashTimerRef.current);
    };
  }, [pessoa.id]);

  const monthTabs = useMemo(
    () => buildMonthTabs(extrato?.historico || [], selectedMonthKey, new Date()),
    [extrato, selectedMonthKey]
  );

  const activeMonthCoords = useMemo(() => {
    return parseMonthKey(selectedMonthKey) || {
      ano: new Date().getFullYear(),
      mes: new Date().getMonth() + 1,
    };
  }, [selectedMonthKey]);

  const activeMonthData = useMemo(() => {
    const hist = extrato?.historico || [];
    const found = hist.find(
      (h) => h.ano === activeMonthCoords.ano && h.mes === activeMonthCoords.mes
    );
    if (found) return found;
    return {
      mes: activeMonthCoords.mes,
      ano: activeMonthCoords.ano,
      nome_mes: `${MESES_NOMES[activeMonthCoords.mes - 1].slice(0, 3)}/${activeMonthCoords.ano}`,
      is_atual: (
        activeMonthCoords.mes === new Date().getMonth() + 1
        && activeMonthCoords.ano === new Date().getFullYear()
      ),
      saldo_anterior: 0,
      total_gastos: 0,
      total_compras_para_mim: 0,
      total_reembolsos: 0,
      total_parcelas_pagas_mes: 0,
      total_a_pagar: 0,
      total_pagamentos: 0,
      saldo_devedor: 0,
      credito_a_favor: 0,
      lancamentos: [],
      pagamentos: [],
    };
  }, [extrato, activeMonthCoords]);

  const handleSelectMonth = async (ano, mes) => {
    const nextKey = monthKey(ano, mes);
    setSelectedMonthKey(nextKey);
    const jaTemNoHistorico = (extrato?.historico || []).some(
      (h) => h.ano === ano && h.mes === mes
    );
    if (!jaTemNoHistorico) {
      await carregarExtrato({ mes, ano, silent: false });
    }
  };

  const flashRow = (rowKey) => {
    if (rowFlashTimerRef.current) clearTimeout(rowFlashTimerRef.current);
    setSavedRowKey(rowKey);
    rowFlashTimerRef.current = setTimeout(() => setSavedRowKey(null), 1600);
  };

  const markSaved = () => {
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    setSaveBanner({ status: 'saved', message: '✓ Salvo' });
    savedTimerRef.current = setTimeout(() => {
      setSaveBanner((prev) => (prev.status === 'saved' ? { status: 'idle', message: '' } : prev));
    }, 3500);
  };

  const runAutoSave = async (rowKey, mutationFn) => {
    inFlightSavesRef.current += 1;
    setSaveBanner({ status: 'saving', message: 'Salvando...' });
    let failed = false;
    try {
      await mutationFn();
      const { ano, mes } = activeMonthCoords;
      await Promise.all([
        carregarExtrato({ mes, ano, silent: true }),
        onRefreshParent({ silent: true }),
      ]);
      if (rowKey) flashRow(rowKey);
      return true;
    } catch (err) {
      failed = true;
      const msg = err?.response?.data?.detail || err.message || 'Erro ao salvar alteração.';
      setSaveBanner({ status: 'error', message: msg });
      return false;
    } finally {
      inFlightSavesRef.current = Math.max(0, inFlightSavesRef.current - 1);
      if (!failed && inFlightSavesRef.current === 0) {
        setSaveBanner((prev) => (prev.status === 'error' ? prev : { status: 'saved', message: '✓ Salvo' }));
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
        savedTimerRef.current = setTimeout(() => {
          setSaveBanner((prev) => (prev.status === 'saved' ? { status: 'idle', message: '' } : prev));
        }, 3500);
      }
    }
  };

  const handleSaveLaunch = (item, payload) =>
    runAutoSave(`launch-${item.lancamento_id}-${item.numero}`, () =>
      lancamentosApi.atualizar(item.lancamento_id, payload)
    );

  const handleSaveParcela = (item, payload) =>
    runAutoSave(`launch-${item.lancamento_id}-${item.numero}`, () =>
      lancamentosApi.atualizarParcela(item.lancamento_id, item.numero, payload)
    );

  const handleSavePayment = (pag, payload) =>
    runAutoSave(`pay-${pag.id}`, () =>
      pessoasApi.atualizarPagamento(pessoa.id, pag.id, payload)
    );

  const handleValidationError = (msg) => {
    setSaveBanner({ status: 'error', message: msg });
  };

  const recarregarTudo = async () => {
    const { ano, mes } = activeMonthCoords;
    await Promise.all([
      carregarExtrato({ mes, ano, silent: true }),
      onRefreshParent({ silent: true }),
    ]);
    markSaved();
  };

  const handleDeletarPagamento = async (pag) => {
    if (!window.confirm(`Excluir o pagamento recebido de ${fmt(pag.valor)}?`)) return;
    await runAutoSave(null, () => pessoasApi.deletarPagamento(pessoa.id, pag.id));
  };

  const handleDownloadPDF = async (mes, ano) => {
    setGerandoPdf(true);
    try {
      const url = pessoasApi.gerarPDFUrl(pessoa.id, mes, ano);
      const token = localStorage.getItem('token');
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Falha ao gerar PDF no backend.');
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      const mesStr = String(mes).padStart(2, '0');
      a.download = `fechamento_${pessoa.nome}_${mesStr}_${ano}.pdf`;
      a.click();
    } catch (err) {
      alert('Erro ao baixar PDF: ' + err.message);
    } finally {
      setGerandoPdf(false);
    }
  };

  const handleEnviarWhatsApp = async (mes, ano, nomeMes, h) => {
    setEnviandoWhats(true);
    const numLimpo = (pessoa.telefone || '').replace(/\D/g, '');
    const telefoneFinal = numLimpo.startsWith('55') ? numLimpo : `55${numLimpo}`;

    const saldoAnt = h?.saldo_anterior || 0;
    const gastosMes = h?.total_gastos || 0;
    const pagsMes = h?.total_pagamentos || 0;
    const saldoDev = h?.saldo_devedor || 0;

    let msgTexto = `Olá, *${pessoa.nome}*! 👋\n\n`;
    msgTexto += `Segue o seu *Fechamento Financeiro de ${nomeMes}*:\n\n`;
    msgTexto += `📊 *Resumo dos Valores:*\n`;
    if (saldoAnt > 0) {
      msgTexto += `• Saldo Pendente do Mês Anterior: *${fmt(saldoAnt)}*\n`;
    }
    msgTexto += `• Compras / Parcelas deste mês: *${fmt(gastosMes)}*\n`;
    if (pagsMes > 0) {
      msgTexto += `• Pagamentos já realizados: *- ${fmt(pagsMes)}*\n`;
    }
    msgTexto += `━━━━━━━━━━━━━━━━━━━━━\n`;
    if (saldoDev > 0) {
      msgTexto += `👉 *TOTAL A PAGAR: ${fmt(saldoDev)}*\n\n`;
    } else {
      msgTexto += `👉 *SITUAÇÃO: TOTALMENTE QUITADO (R$ 0,00)* 🎉\n\n`;
    }

    if (h?.lancamentos && h.lancamentos.length > 0) {
      msgTexto += `🛍️ *Compras e Parcelas de ${nomeMes}:*\n`;
      h.lancamentos.slice(0, 8).forEach(item => {
        const cartaoInfo = item.cartao ? ` (${item.cartao})` : '';
        msgTexto += `• ${item.descricao} [${item.parcela}${cartaoInfo}]: *${fmt(item.valor)}*\n`;
      });
      if (h.lancamentos.length > 8) {
        msgTexto += `• ... e mais ${h.lancamentos.length - 8} compras no PDF anexo\n`;
      }
      msgTexto += `\n`;
    } else {
      msgTexto += `🛍️ *Compras deste mês:* Nenhuma nova compra no período.\n\n`;
    }

    if (extrato?.historico) {
      const futuras = extrato.historico.filter(hist => {
        if (hist.ano > ano) return true;
        if (hist.ano === ano && hist.mes > mes) return true;
        return false;
      });
      if (futuras.length > 0) {
        msgTexto += `⏳ *Parcelas nos próximos meses:*\n`;
        futuras.slice(0, 4).forEach(fut => {
          if (fut.total_gastos > 0) {
            msgTexto += `• ${fut.nome_mes}: *${fmt(fut.total_gastos)}*\n`;
          }
        });
        const totalFut = futuras.reduce((acc, fut) => acc + (fut.total_gastos || 0), 0);
        if (totalFut > 0) {
          msgTexto += `👉 *Total restante futuro: ${fmt(totalFut)}*\n\n`;
        }
      }
    }

    if (pessoa.token_acesso) {
      const linkPdf = `${publicShareOrigin()}/public/fechamento/${pessoa.token_acesso}/${mes}/${ano}/pdf`;
      msgTexto += `📄 *BAIXAR EXTRATO COMPLETO EM PDF:*\n${linkPdf}\n\n`;
    }

    msgTexto += `Qualquer dúvida só me avisar! Abraço, ${nomeGestor}.`;

    try {
      const resPath = await pessoasApi.obterPdfPath(pessoa.id, mes, ano);
      const { pdf_path, telefone } = resPath.data || {};

      try {
        const resEnvio = await whatsappApi.sendPdf({
          telefone: telefone || pessoa.telefone,
          pdf_path,
          pdfPath: pdf_path,
          nome_pessoa: pessoa.nome,
          mes_ano: nomeMes,
          mensagem: msgTexto,
        });

        if (resEnvio.data?.success) {
          alert(`✅ PDF de ${pessoa.nome} (${nomeMes}) enviado com sucesso pelo WhatsApp!`);
          setEnviandoWhats(false);
          return;
        }
      } catch {
        if (numLimpo) {
          window.open(`https://wa.me/${telefoneFinal}?text=${encodeURIComponent(msgTexto)}`, '_blank');
        } else {
          window.open('https://web.whatsapp.com', '_blank');
        }
      }
    } catch (err) {
      if (numLimpo) {
        window.open(`https://wa.me/${telefoneFinal}?text=${encodeURIComponent(msgTexto)}`, '_blank');
      } else {
        alert('Erro ao processar envio: ' + (err.response?.data?.detail || err.message));
      }
    } finally {
      setEnviandoWhats(false);
    }
  };

  const anosDisponiveis = useMemo(() => {
    const curAno = new Date().getFullYear();
    const setAnos = new Set([curAno - 1, curAno, curAno + 1, activeMonthCoords.ano]);
    for (const h of extrato?.historico || []) setAnos.add(h.ano);
    return Array.from(setAnos).sort((a, b) => a - b);
  }, [extrato, activeMonthCoords.ano]);

  const h = activeMonthData;
  const fullMonthLabel = `${MESES_NOMES[h.mes - 1]} / ${h.ano}`;

  return (
    <section
      data-testid="person-spreadsheet"
      aria-label={`Planilha mensal de ${pessoa.nome}`}
      className="card p-0 overflow-hidden border-2 border-blue-500/35 shadow-lg"
    >
      {/* Cabeçalho da Planilha da Pessoa */}
      <div className="p-4 sm:p-5 bg-[var(--surface)] border-b border-[var(--line)] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3.5 min-w-0">
          <Avatar nome={pessoa.nome} foto={pessoa.foto_path} cor={pessoa.cor} className="avatar--person shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-blue-500/15 text-blue-500">
                <Table2 size={12} /> Planilha Editável
              </span>
              <h2 className="font-extrabold text-[var(--ink)] text-lg sm:text-xl truncate">{pessoa.nome}</h2>
              {pessoa.telefone && (
                <span className="text-xs text-[var(--muted)] font-mono">📱 {pessoa.telefone}</span>
              )}
            </div>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              Clique em qualquer célula para editar — o sistema salva automaticamente e atualiza todo o painel.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Indicador de Auto-Save da Planilha */}
          <span
            data-testid="spreadsheet-save-status"
            role="status"
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${
              saveBanner.status === 'saving'
                ? 'bg-blue-500/15 text-blue-500 border-blue-500/30'
                : saveBanner.status === 'saved'
                  ? 'bg-emerald-500/15 text-emerald-500 border-emerald-500/35'
                  : saveBanner.status === 'error'
                    ? 'bg-rose-500/15 text-rose-500 border-rose-500/35'
                    : 'bg-[var(--raised)] text-[var(--muted)] border-[var(--line)]'
            }`}
          >
            {saveBanner.status === 'saving' ? (
              <>
                <Loader2 size={13} className="animate-spin shrink-0" />
                <span>Salvando...</span>
              </>
            ) : saveBanner.status === 'saved' ? (
              <>
                <Check size={14} className="shrink-0" />
                <span>✓ Salvo</span>
              </>
            ) : saveBanner.status === 'error' ? (
              <>
                <AlertTriangle size={13} className="shrink-0" />
                <span className="max-w-[220px] truncate">{saveBanner.message}</span>
              </>
            ) : (
              <>
                <CheckCircle size={13} className="text-emerald-500 shrink-0" />
                <span>Auto-save ativo</span>
              </>
            )}
          </span>

          {pessoa.token_acesso && (
            <button
              type="button"
              onClick={() => setModalLink(true)}
              className="btn-secondary text-xs py-1.5 px-2.5 text-blue-500"
              title="Abrir Link de Celular e WhatsApp"
            >
              <Link2 size={14} /> <span className="hidden sm:inline">Link</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setModalEditar(true)}
            className="btn-secondary text-xs py-1.5 px-2.5"
            title="Editar Pessoa"
          >
            <Edit2 size={14} /> <span className="hidden sm:inline">Editar</span>
          </button>
          <button
            type="button"
            onClick={() => setModalConfirmarExclusao(true)}
            className="btn-secondary text-xs py-1.5 px-2.5 text-rose-500 hover:bg-rose-500/10"
            title="Opções de Remoção / Zerar"
          >
            <Trash2 size={14} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary text-xs py-1.5 px-2.5"
            title="Fechar planilha"
            aria-label="Fechar planilha"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Barra de Abas de Meses (Excel Sheet Tabs) */}
      <div className="px-4 sm:px-5 py-3 bg-[var(--raised)] border-b border-[var(--line)] flex flex-wrap items-center justify-between gap-3">
        <div
          className="sheet-month-tabs flex-1 min-w-0"
          role="tablist"
          aria-label="Meses da planilha"
          data-testid="spreadsheet-month-tabs"
        >
          <button
            type="button"
            onClick={() => {
              const prev = shiftMonth(activeMonthCoords.ano, activeMonthCoords.mes, -1);
              handleSelectMonth(prev.ano, prev.mes);
            }}
            className="sheet-month-tab px-2"
            title="Mês anterior"
            aria-label="Mês anterior"
          >
            <ChevronLeft size={15} />
          </button>

          {monthTabs.map((tab) => {
            const isSelected = tab.key === selectedMonthKey;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={isSelected}
                data-testid={`month-tab-${tab.ano}-${tab.mes}`}
                onClick={() => handleSelectMonth(tab.ano, tab.mes)}
                className={`sheet-month-tab ${isSelected ? 'sheet-month-tab--active' : ''}`}
              >
                <span>{tab.label}</span>
                {tab.isAtual && (
                  <span
                    className={`px-1.5 py-0.2 rounded text-[9px] font-black uppercase ${
                      isSelected ? 'bg-white/25 text-current' : 'bg-blue-500/15 text-blue-500'
                    }`}
                  >
                    Atual
                  </span>
                )}
                {tab.hasServerData && tab.saldoDevedor > 0 && (
                  <span
                    className={`w-2 h-2 rounded-full ${isSelected ? 'bg-rose-200' : 'bg-rose-500'}`}
                    title={`Pendente: ${fmt(tab.saldoDevedor)}`}
                  />
                )}
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => {
              const next = shiftMonth(activeMonthCoords.ano, activeMonthCoords.mes, 1);
              handleSelectMonth(next.ano, next.mes);
            }}
            className="sheet-month-tab px-2"
            title="Próximo mês"
            aria-label="Próximo mês"
          >
            <ChevronRight size={15} />
          </button>
        </div>

        {/* Seletor rápido de qualquer Mês/Ano */}
        <div className="flex items-center gap-1.5 shrink-0">
          <select
            aria-label="Escolher mês"
            data-testid="month-jump-select"
            className="input py-1 px-2 text-xs font-bold w-auto min-h-0 h-8"
            value={activeMonthCoords.mes}
            onChange={(e) => handleSelectMonth(activeMonthCoords.ano, Number(e.target.value))}
          >
            {MESES_NOMES.map((mNome, idx) => (
              <option key={idx + 1} value={idx + 1}>{mNome}</option>
            ))}
          </select>
          <select
            aria-label="Escolher ano"
            data-testid="year-jump-select"
            className="input py-1 px-2 text-xs font-bold w-auto min-h-0 h-8"
            value={activeMonthCoords.ano}
            onChange={(e) => handleSelectMonth(Number(e.target.value), activeMonthCoords.mes)}
          >
            {anosDisponiveis.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Corpo da Planilha do Mês Selecionado */}
      {loadingExtrato && !extrato ? (
        <div className="p-10 text-center text-[var(--muted)] text-sm flex items-center justify-center gap-2">
          <Loader2 size={18} className="animate-spin text-blue-500" />
          <span>Carregando planilha de {pessoa.nome}...</span>
        </div>
      ) : (
        <div className="p-4 sm:p-5 bg-[var(--canvas)] space-y-5">
          {/* Faixa de KPIs do Mês + Ações Rápidas */}
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 flex-1">
              <div className="bg-[var(--surface)] px-3.5 py-2.5 rounded-xl border border-[var(--line)]">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)] block">
                  Dívida Mês Anterior
                </span>
                <span
                  data-testid="kpi-saldo-anterior"
                  className={`text-base font-extrabold tabular-nums ${
                    h.saldo_anterior > 0
                      ? 'text-rose-500'
                      : h.saldo_anterior < 0
                        ? 'text-blue-500'
                        : 'text-[var(--muted)]'
                  }`}
                >
                  {fmt(h.saldo_anterior)}
                </span>
              </div>

              <div className="bg-[var(--surface)] px-3.5 py-2.5 rounded-xl border border-[var(--line)]">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)] block">
                  Compras / Parcelas ({h.nome_mes})
                </span>
                <span data-testid="kpi-total-gastos" className="text-base font-extrabold text-[var(--ink)] tabular-nums">
                  {fmt(h.total_gastos)}
                </span>
                {h.total_compras_para_mim > 0 && (
                  <span className="block text-[10px] font-semibold text-emerald-500">
                    Abatimentos: -{fmt(h.total_compras_para_mim)}
                  </span>
                )}
              </div>

              <div className="bg-[var(--surface)] px-3.5 py-2.5 rounded-xl border border-[var(--line)]">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)] block">
                  Pagamentos Recebidos
                </span>
                <span data-testid="kpi-total-pagamentos" className="text-base font-extrabold text-emerald-500 tabular-nums">
                  {fmt(h.total_pagamentos)}
                </span>
                {h.total_parcelas_pagas_mes > 0 && (
                  <span className="block text-[10px] font-semibold text-emerald-500">
                    Marcado pago: {fmt(h.total_parcelas_pagas_mes)}
                  </span>
                )}
              </div>

              <div
                className={`px-3.5 py-2.5 rounded-xl border ${
                  h.saldo_devedor > 0
                    ? 'bg-rose-500/10 border-rose-500/30'
                    : h.credito_a_favor > 0
                      ? 'bg-blue-500/10 border-blue-500/30'
                      : 'bg-emerald-500/10 border-emerald-500/30'
                }`}
              >
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)] block">
                  {h.credito_a_favor > 0 ? 'Crédito a Favor' : 'Saldo Pendente'}
                </span>
                <span
                  data-testid="kpi-saldo-pendente"
                  className={`text-base font-black tabular-nums ${
                    h.saldo_devedor > 0
                      ? 'text-rose-500'
                      : h.credito_a_favor > 0
                        ? 'text-blue-500'
                        : 'text-emerald-500'
                  }`}
                >
                  {h.saldo_devedor > 0
                    ? fmt(h.saldo_devedor)
                    : h.credito_a_favor > 0
                      ? fmt(h.credito_a_favor)
                      : 'Quitado ✓'}
                </span>
              </div>
            </div>

            {/* Ações rápidas do mês */}
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => handleDownloadPDF(h.mes, h.ano)}
                disabled={gerandoPdf}
                className="btn-secondary text-xs py-2 px-3 font-bold"
                title={`Baixar PDF de ${fullMonthLabel}`}
              >
                <Download size={14} /> PDF
              </button>

              <button
                type="button"
                onClick={() => handleEnviarWhatsApp(h.mes, h.ano, h.nome_mes, h)}
                disabled={enviandoWhats}
                className="btn-success text-xs py-2 px-3 font-bold"
                title={`Enviar ${fullMonthLabel} pelo WhatsApp`}
              >
                <MessageCircle size={14} /> {enviandoWhats ? 'Enviando...' : 'WhatsApp'}
              </button>

              <button
                type="button"
                onClick={() =>
                  setModalZerar({
                    mes: h.mes,
                    ano: h.ano,
                    temLancamentos: h.lancamentos.length > 0 || h.pagamentos.length > 0,
                    saldoDevedor: h.saldo_devedor || 0,
                  })
                }
                className="btn-secondary text-xs py-2 px-3 font-bold text-amber-500 border-amber-500/30 hover:bg-amber-500/10"
                title={`Zerar gastos ou dívida de ${fullMonthLabel}`}
              >
                <Eraser size={14} /> Zerar
              </button>

              <button
                type="button"
                onClick={() => setModalPagamento(true)}
                className="btn-primary text-xs py-2 px-3 font-bold"
              >
                <DollarSign size={14} /> Registrar Pagamento
              </button>
            </div>
          </div>

          {/* Tabela 1 — Planilha de Lançamentos / Parcelas do Mês ("Tudo em Linha") */}
          <div className="bg-[var(--surface)] rounded-2xl border border-[var(--line)] overflow-hidden shadow-sm">
            <div className="px-4 py-2.5 bg-[var(--raised)] border-b border-[var(--line)] flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-black uppercase tracking-wider text-[var(--ink)]">
                  Planilha de Compras &amp; Parcelas — <span className="text-blue-500">{fullMonthLabel}</span>
                </h3>
                {loadingExtrato && (
                  <Loader2 size={13} className="animate-spin text-blue-500" />
                )}
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[var(--surface)] border border-[var(--line)] text-[var(--muted)]">
                  {h.lancamentos.length} {h.lancamentos.length === 1 ? 'linha' : 'linhas'}
                </span>
              </div>
              <span className="text-[11px] text-[var(--muted)]">
                Edite Data, Descrição, Cartão, Valor ou Status diretamente na linha • Enter/Sair salva automático
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="sheet-table" data-testid="spreadsheet-launches-table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Descrição</th>
                    <th>Cartão / Origem</th>
                    <th className="text-center">Parcela</th>
                    <th className="text-right">Valor (R$)</th>
                    <th className="text-center">Status</th>
                    <th className="text-center">Excluir</th>
                  </tr>
                </thead>
                <tbody>
                  {h.lancamentos.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-xs text-[var(--muted)] italic">
                        Nenhum lançamento registrado em {fullMonthLabel}. Use a linha azul abaixo para adicionar diretamente aqui!
                      </td>
                    </tr>
                  ) : (
                    h.lancamentos.map((item) => {
                      const rk = `launch-${item.lancamento_id}-${item.numero}`;
                      return (
                        <LinhaLancamentoEditavel
                          key={item.parcela_id || rk}
                          item={item}
                          cartoes={cartoes}
                          contas={contas}
                          savedHighlight={savedRowKey === rk}
                          onSaveLaunch={handleSaveLaunch}
                          onSaveParcela={handleSaveParcela}
                          onValidationError={handleValidationError}
                          onRequestDelete={(it) => setItemExcluindo({ item: it, nomeMes: h.nome_mes })}
                        />
                      );
                    })
                  )}

                  {/* Linha inline "+ Nova Linha" */}
                  <LinhaNovoLancamento
                    pessoa={pessoa}
                    mes={h.mes}
                    ano={h.ano}
                    cartoes={cartoes}
                    contas={contas}
                    onCreated={recarregarTudo}
                    onError={handleValidationError}
                  />
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4} className="text-right text-[var(--muted)] uppercase text-[11px]">
                      Total de Compras / Parcelas em {h.nome_mes}
                    </td>
                    <td className="text-right font-black text-[var(--ink)] tabular-nums" data-testid="launches-table-total">
                      {fmt(h.total_gastos)}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Tabela 2 — Planilha de Pagamentos Recebidos no Mês */}
          <div className="bg-[var(--surface)] rounded-2xl border border-emerald-500/25 overflow-hidden shadow-sm">
            <div className="px-4 py-2.5 bg-emerald-500/10 border-b border-emerald-500/20 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                  Pagamentos Recebidos — {fullMonthLabel}
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[var(--surface)] border border-emerald-500/30 text-emerald-600 dark:text-emerald-400">
                  {h.pagamentos.length} {h.pagamentos.length === 1 ? 'registro' : 'registros'}
                </span>
              </div>
              <span className="text-[11px] text-[var(--muted)]">
                Alterar valor, forma ou conta atualiza saldo da pessoa e da conta bancária automaticamente
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="sheet-table" data-testid="spreadsheet-payments-table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Forma / Conta Destino</th>
                    <th className="text-right">Valor (R$)</th>
                    <th>Observação</th>
                    <th className="text-center">Excluir</th>
                  </tr>
                </thead>
                <tbody>
                  {h.pagamentos.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-5 text-center text-xs text-[var(--muted)] italic">
                        Nenhum pagamento recebido em {fullMonthLabel}. Registre abaixo ou pelo botão "Registrar Pagamento".
                      </td>
                    </tr>
                  ) : (
                    h.pagamentos.map((pag) => {
                      const rk = `pay-${pag.id}`;
                      return (
                        <LinhaPagamentoEditavel
                          key={pag.id}
                          pag={pag}
                          contas={contas}
                          savedHighlight={savedRowKey === rk}
                          onSavePayment={handleSavePayment}
                          onValidationError={handleValidationError}
                          onDeletePayment={handleDeletarPagamento}
                        />
                      );
                    })
                  )}

                  {/* Linha inline para adicionar pagamento rápido */}
                  <LinhaNovoPagamento
                    pessoa={pessoa}
                    mes={h.mes}
                    ano={h.ano}
                    contas={contas}
                    onCreated={recarregarTudo}
                    onError={handleValidationError}
                  />
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2} className="text-right text-[var(--muted)] uppercase text-[11px]">
                      Total Pago em {h.nome_mes}
                    </td>
                    <td className="text-right font-black text-emerald-500 tabular-nums" data-testid="payments-table-total">
                      +{fmt(h.total_pagamentos)}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}

      {modalPagamento && (
        <ModalRegistrarPagamento
          pessoa={pessoa}
          contas={contas}
          defaultDate={defaultDateForMonth(h.mes, h.ano)}
          onClose={() => setModalPagamento(false)}
          onSaved={recarregarTudo}
        />
      )}

      {modalEditar && (
        <ModalEditarPessoa
          pessoa={pessoa}
          onClose={() => setModalEditar(false)}
          onSaved={recarregarTudo}
        />
      )}

      {modalLink && (
        <ModalLinkLancamento
          pessoa={pessoa}
          onClose={() => setModalLink(false)}
        />
      )}

      {modalZerar && (
        <ModalZerarPessoa
          pessoa={pessoa}
          mesInicial={modalZerar.mes}
          anoInicial={modalZerar.ano}
          temLancamentosMes={modalZerar.temLancamentos ?? true}
          saldoDevedorMes={modalZerar.saldoDevedor ?? pessoa.saldo_devedor ?? 0}
          onClose={() => setModalZerar(null)}
          onSaved={recarregarTudo}
        />
      )}

      {modalConfirmarExclusao && (
        <ModalConfirmarExclusaoPessoa
          pessoa={pessoa}
          onClose={() => setModalConfirmarExclusao(false)}
          onOpenZerar={() => setModalZerar({})}
          onDeleted={() => {
            onDeletedPessoa();
            onRefreshParent({ silent: false });
          }}
        />
      )}

      {itemExcluindo && (
        <ModalExcluirLancamentoPessoa
          item={itemExcluindo.item}
          nomeMes={itemExcluindo.nomeMes}
          onClose={() => setItemExcluindo(null)}
          onSaved={recarregarTudo}
        />
      )}
    </section>
  );
}

/**
 * Cartão compacto de seleção de Pessoa. Ao clicar, abre automaticamente sua Planilha Mensal.
 */
function CardSelecaoPessoa({
  pessoa,
  selected,
  modoInativas,
  onSelect,
  onRestaurar,
  onOpenQuickAction,
}) {
  return (
    <div
      role="button"
      tabIndex={modoInativas ? -1 : 0}
      aria-pressed={selected}
      data-testid={`pessoa-card-${pessoa.id}`}
      onClick={() => {
        if (!modoInativas) onSelect(pessoa);
      }}
      onKeyDown={(e) => {
        if (!modoInativas && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onSelect(pessoa);
        }
      }}
      className={`card p-4 transition-all text-left relative ${
        modoInativas
          ? 'opacity-90'
          : selected
            ? 'border-2 border-blue-500 ring-2 ring-blue-500/20 bg-[var(--accent-tint)]/30 cursor-pointer'
            : 'cursor-pointer hover:border-blue-400/60 hover:shadow-md'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Avatar nome={pessoa.nome} foto={pessoa.foto_path} cor={pessoa.cor} className="avatar--person shrink-0" />
          <div className="min-w-0">
            <h3 className="font-extrabold text-[var(--ink)] text-base truncate">{pessoa.nome}</h3>
            {pessoa.telefone && (
              <p className="text-[11px] text-[var(--muted)] font-mono truncate">📱 {pessoa.telefone}</p>
            )}
            <p className="text-[11px] text-[var(--muted)] mt-0.5 truncate">
              {modoInativas
                ? 'Cadastro arquivado'
                : `Mês atual: ${fmt(pessoa.total_gastos_mes)}`}
            </p>
          </div>
        </div>

        {!modoInativas && (
          <div className="flex items-center gap-0.5 shrink-0">
            {pessoa.token_acesso && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onOpenQuickAction('link', pessoa); }}
                className="p-1.5 text-blue-500 hover:bg-blue-500/10 rounded-lg transition-colors"
                title="Link de Celular"
              >
                <Link2 size={14} />
              </button>
            )}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onOpenQuickAction('editar', pessoa); }}
              className="p-1.5 text-[var(--muted)] hover:text-blue-500 hover:bg-[var(--accent-tint)] rounded-lg transition-colors"
              title="Editar Pessoa"
            >
              <Edit2 size={14} />
            </button>
          </div>
        )}
      </div>

      <div className="mt-3 pt-2.5 border-t border-[var(--line)] flex items-center justify-between gap-2">
        {modoInativas ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRestaurar(pessoa);
            }}
            className="btn-success w-full text-xs py-2 px-3 font-bold flex items-center justify-center gap-1.5"
          >
            <RotateCcw size={14} />
            <span>Restaurar Pessoa</span>
          </button>
        ) : (
          <>
            <div>
              {pessoa.saldo_devedor > 0 ? (
                <span className="badge-red text-xs py-0.5 px-2.5">Deve {fmt(pessoa.saldo_devedor)}</span>
              ) : pessoa.credito_a_favor > 0 ? (
                <span className="badge-blue text-xs py-0.5 px-2.5">Crédito {fmt(pessoa.credito_a_favor)}</span>
              ) : (
                <span className="badge-green text-xs py-0.5 px-2.5">Quitado ✓</span>
              )}
            </div>

            <span
              className={`inline-flex items-center gap-1 text-[11px] font-bold ${
                selected ? 'text-blue-500' : 'text-[var(--muted)]'
              }`}
            >
              <Table2 size={13} />
              <span>{selected ? 'Planilha aberta' : 'Abrir planilha'}</span>
            </span>
          </>
        )}
      </div>
    </div>
  );
}

export default function Pessoas() {
  const [lista, setLista] = useState([]);
  const [contas, setContas] = useState([]);
  const [cartoes, setCartoes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalNovo, setModalNovo] = useState(false);
  const [mostrarInativas, setMostrarInativas] = useState(false);
  const [selectedPessoaId, setSelectedPessoaId] = useState(null);
  const [quickModal, setQuickModal] = useState(null); // { type: 'link' | 'editar', pessoa }
  const spreadsheetContainerRef = useRef(null);

  const carregar = async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const [resP, resC, resCards] = await Promise.all([
        pessoasApi.listar(mostrarInativas),
        contasApi.listar(),
        cartoesApi.listar(),
      ]);
      setLista(resP.data || []);
      setContas(resC.data || []);
      setCartoes(resCards.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    setSelectedPessoaId(null);
    carregar({ silent: false });
  }, [mostrarInativas]);

  const selectedPessoa = useMemo(
    () => (mostrarInativas ? null : lista.find((p) => p.id === selectedPessoaId) || null),
    [lista, selectedPessoaId, mostrarInativas]
  );

  const handleSelectPessoa = (pessoa) => {
    setSelectedPessoaId(pessoa.id);
    setTimeout(() => {
      spreadsheetContainerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  };

  const handleRestaurar = async (pessoa) => {
    try {
      await pessoasApi.restaurar(pessoa.id);
      carregar({ silent: false });
    } catch (err) {
      alert('Erro ao restaurar pessoa: ' + (err.response?.data?.detail || err.message));
    }
  };

  const totalPendente = lista.reduce((acc, p) => acc + (p.saldo_devedor || 0), 0);

  return (
    <div className="space-y-6">
      <div className="page-heading">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--ink)] tracking-tight">Pessoas &amp; Fechamentos</h1>
          <p className="text-[var(--muted)] text-sm mt-0.5">
            {mostrarInativas ? (
              'Pessoas removidas/arquivadas — restaure com 1 clique mantendo histórico e link'
            ) : (
              <>
                Clique em uma pessoa para abrir automaticamente a planilha mensal editável • Total a receber:{' '}
                <strong className="text-rose-500" data-testid="pessoas-total-pendente">{fmt(totalPendente)}</strong>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary text-sm"
            disabled={loading}
            aria-pressed={mostrarInativas}
            onClick={() => {
              setLista([]);
              setMostrarInativas(!mostrarInativas);
            }}
          >
            {mostrarInativas ? 'Ver pessoas ativas' : 'Ver pessoas removidas'}
          </button>
          <button onClick={() => setModalNovo(true)} className="btn-primary text-sm shadow-md shadow-blue-600/20">
            <Plus size={18} /> Nova Pessoa
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-[var(--muted)] text-sm">Carregando pessoas...</div>
      ) : lista.length === 0 ? (
        <div className="card text-center py-16">
          <div className="w-14 h-14 bg-emerald-500/10 text-emerald-500 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <Users size={28} />
          </div>
          <h3 className="font-bold text-[var(--ink)] text-lg">
            {mostrarInativas ? 'Nenhuma pessoa removida' : 'Nenhuma pessoa cadastrada'}
          </h3>
          {!mostrarInativas && (
            <>
              <p className="text-[var(--muted)] text-sm max-w-sm mx-auto mt-1 mb-5">
                Cadastre as pessoas que usam seus cartões (Thais, Luane, Alessandra...) para abrir a planilha mensal editável e gerar fechamentos em PDF.
              </p>
              <button onClick={() => setModalNovo(true)} className="btn-primary text-sm">
                Cadastrar Primeira Pessoa
              </button>
            </>
          )}
        </div>
      ) : (
        <>
          {/* Grade de Pessoas — 1 clique abre automaticamente a Planilha Mensal */}
          <div
            data-testid="pessoas-grid"
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5"
          >
            {lista.map((p) => (
              <CardSelecaoPessoa
                key={p.id}
                pessoa={p}
                selected={!mostrarInativas && selectedPessoaId === p.id}
                modoInativas={mostrarInativas}
                onSelect={handleSelectPessoa}
                onRestaurar={handleRestaurar}
                onOpenQuickAction={(type, person) => setQuickModal({ type, pessoa: person })}
              />
            ))}
          </div>

          {/* Planilha Mensal Editável (abre automaticamente ao clicar na pessoa) */}
          {selectedPessoa && (
            <div ref={spreadsheetContainerRef} className="scroll-mt-4">
              <PlanilhaPessoaMensal
                key={selectedPessoa.id}
                pessoa={selectedPessoa}
                cartoes={cartoes}
                contas={contas}
                onRefreshParent={carregar}
                onClose={() => setSelectedPessoaId(null)}
                onDeletedPessoa={() => setSelectedPessoaId(null)}
              />
            </div>
          )}
        </>
      )}

      {modalNovo && (
        <ModalNovaPessoa
          onClose={() => setModalNovo(false)}
          onSaved={async (criada) => {
            await carregar({ silent: false });
            if (criada?.id && !mostrarInativas) {
              setSelectedPessoaId(criada.id);
            }
          }}
        />
      )}

      {quickModal?.type === 'editar' && (
        <ModalEditarPessoa
          pessoa={quickModal.pessoa}
          onClose={() => setQuickModal(null)}
          onSaved={() => carregar({ silent: true })}
        />
      )}

      {quickModal?.type === 'link' && (
        <ModalLinkLancamento
          pessoa={quickModal.pessoa}
          onClose={() => setQuickModal(null)}
        />
      )}
    </div>
  );
}
