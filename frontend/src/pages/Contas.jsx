import { useState, useEffect, useRef } from 'react';
import {
  contas as contasApi,
  lancamentos as lancamentosApi,
  pessoas as pessoasApi,
  modulos as modulosApi
} from '../api/client';
import {
  Building2, Plus, ArrowDownLeft, ArrowUpRight,
  ChevronDown, ChevronUp, X, PlusCircle, MinusCircle,
  SlidersHorizontal, Trash2, CheckCircle2
} from 'lucide-react';
import { IconConta } from '../components/ModuleIcon';
import PersonPicker from '../components/PersonPicker';
import { todayLocalISO } from '../components/dateUtils';
import { useAuth } from '../contexts/AuthContext';

function fmt(val) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);
}

const SUGESTOES_ENTRADA = ['Depósito', 'Salário', 'Pix Recebido', 'Aporte na Conta', 'Receita'];
const SUGESTOES_SAIDA = ['Pagamento', 'Pix Enviado', 'Saque', 'Despesa', 'Conta Paga'];

function ModalNovaConta({ onClose, onSaved }) {
  const [form, setForm] = useState({
    nome: '',
    banco: '',
    agencia: '',
    conta: '',
    saldo_inicial: '',
    tipo: 'corrente',
    cor: '#3B82F6'
  });
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await contasApi.criar({
        ...form,
        saldo_inicial: parseFloat(form.saldo_inicial) || 0.0
      });
      onSaved();
      onClose();
    } catch (err) {
      alert('Erro ao criar conta: ' + (err.response?.data?.detail || err.message));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/65 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[var(--surface)] text-[var(--ink)] rounded-3xl shadow-2xl w-full max-w-md p-6 border border-[var(--line)]">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-[var(--ink)]">Cadastrar Nova Conta</h2>
          <button onClick={onClose} className="p-1 text-[var(--muted)] hover:text-[var(--ink)] rounded-lg"><X size={20} /></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Nome da Conta / Identificação</label>
            <input
              type="text"
              className="input"
              placeholder="Ex: Itaú Corrente, Nubank PJ, Caixa..."
              value={form.nome}
              onChange={e => setForm({ ...form, nome: e.target.value })}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Instituição / Banco</label>
              <input
                type="text"
                className="input"
                placeholder="Ex: Itaú, BB, Nubank"
                value={form.banco}
                onChange={e => setForm({ ...form, banco: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="label">Tipo de Conta</label>
              <select
                className="input font-medium"
                value={form.tipo}
                onChange={e => setForm({ ...form, tipo: e.target.value })}
              >
                <option value="corrente">Conta Corrente</option>
                <option value="poupanca">Poupança</option>
                <option value="investimento">Investimento</option>
                <option value="dinheiro">Dinheiro Físico / Caixa</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Agência (opcional)</label>
              <input
                type="text"
                className="input"
                placeholder="0000"
                value={form.agencia}
                onChange={e => setForm({ ...form, agencia: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Número da Conta (opcional)</label>
              <input
                type="text"
                className="input"
                placeholder="00000-0"
                value={form.conta}
                onChange={e => setForm({ ...form, conta: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="label">Saldo Inicial (R$)</label>
            <input
              type="number"
              step="0.01"
              className="input font-bold"
              placeholder="0,00"
              value={form.saldo_inicial}
              onChange={e => setForm({ ...form, saldo_inicial: e.target.value })}
            />
            <p className="text-xs text-[var(--muted)] mt-1">Saldo inicial a partir do qual as movimentações serão somadas.</p>
          </div>

          <div>
            <label className="label">Cor do Ícone</label>
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
              {submitting ? 'Salvando...' : 'Salvar Conta'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ModalMovimentarConta({ conta, modoInicial, pessoas, modulos, onClose, onSaved }) {
  const { usuario } = useAuth();
  const [modo, setModo] = useState(modoInicial || 'entrada'); // 'entrada' | 'saida'
  const [form, setForm] = useState({
    valor: '',
    descricao: '',
    data_lancamento: todayLocalISO(),
    pessoa_id: '',
    modulo_id: '',
    observacoes: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const isEntrada = modo === 'entrada';
  const sugestoes = isEntrada ? SUGESTOES_ENTRADA : SUGESTOES_SAIDA;
  const valorNum = parseFloat(form.valor);
  const saldoPrevisto = Number.isFinite(valorNum) && valorNum > 0
    ? (isEntrada ? conta.saldo_atual + valorNum : conta.saldo_atual - valorNum)
    : conta.saldo_atual;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!Number.isFinite(valorNum) || valorNum <= 0) {
      setError('Informe um valor maior que zero.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const payload = {
        tipo: isEntrada ? 'entrada' : 'saida',
        valor: valorNum,
        descricao: (form.descricao || '').trim() || (isEntrada ? `Entrada em ${conta.nome}` : `Saída de ${conta.nome}`),
        data_lancamento: form.data_lancamento,
        pessoa_id: !isEntrada && form.pessoa_id ? parseInt(form.pessoa_id, 10) : null,
        modulo_id: form.modulo_id ? parseInt(form.modulo_id, 10) : null,
        observacoes: form.observacoes.trim() || null,
      };
      const { data } = await contasApi.movimentar(conta.id, payload);
      onSaved(data?.mensagem || 'Movimentação registrada com sucesso!');
      onClose();
    } catch (err) {
      setError(err.response?.data?.detail || 'Erro ao registrar movimentação.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/65 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-[var(--surface)] text-[var(--ink)] rounded-3xl shadow-2xl w-full max-w-lg my-6 border border-[var(--line)] overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-[var(--line)] bg-[var(--raised)]">
          <div>
            <h2 className="text-lg font-extrabold text-[var(--ink)]">
              {isEntrada ? 'Adicionar Valor / Lançar Entrada' : 'Remover Valor / Lançar Saída'}
            </h2>
            <p className="text-xs text-[var(--muted)]">
              Conta: <strong className="text-[var(--ink)]">{conta.nome}</strong> ({conta.banco}) • Saldo atual: <strong>{fmt(conta.saldo_atual)}</strong>
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 text-[var(--muted)] hover:text-[var(--ink)] rounded-lg">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="bg-rose-500/10 border border-rose-500/30 text-rose-500 px-3.5 py-2.5 rounded-xl text-xs font-semibold">
              {error}
            </div>
          )}

          {/* Alternador rápido Entrada / Saída */}
          <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-[var(--raised)] border border-[var(--line)]">
            <button
              type="button"
              onClick={() => setModo('entrada')}
              className={`py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                isEntrada ? 'bg-emerald-600 text-white shadow' : 'text-[var(--muted)] hover:text-[var(--ink)]'
              }`}
            >
              <PlusCircle size={15} /> Entrada / Adicionar
            </button>
            <button
              type="button"
              onClick={() => setModo('saida')}
              className={`py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                !isEntrada ? 'bg-rose-600 text-white shadow' : 'text-[var(--muted)] hover:text-[var(--ink)]'
              }`}
            >
              <MinusCircle size={15} /> Saída / Remover
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Valor (R$)</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                autoFocus
                className={`input text-lg font-black ${isEntrada ? 'text-emerald-500' : 'text-rose-500'}`}
                placeholder="0,00"
                value={form.valor}
                onChange={e => setForm({ ...form, valor: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="label">Data</label>
              <input
                type="date"
                className="input"
                value={form.data_lancamento}
                onChange={e => setForm({ ...form, data_lancamento: e.target.value })}
                required
              />
            </div>
          </div>

          {/* Prévia do novo saldo */}
          <div className="p-3 rounded-xl bg-[var(--raised)] border border-[var(--line)] flex items-center justify-between text-xs">
            <span className="text-[var(--muted)]">Saldo após esta movimentação:</span>
            <strong className={`text-sm font-black ${saldoPrevisto >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
              {fmt(saldoPrevisto)}
            </strong>
          </div>

          <div>
            <label className="label">Descrição</label>
            <input
              type="text"
              className="input"
              placeholder={isEntrada ? 'Ex: Depósito, Salário, Pix recebido...' : 'Ex: Saque, Pagamento, Pix enviado...'}
              value={form.descricao}
              onChange={e => setForm({ ...form, descricao: e.target.value })}
              required
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {sugestoes.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setForm(prev => ({ ...prev, descricao: s }))}
                  className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[var(--raised)] border border-[var(--line)] text-[var(--muted)] hover:text-[var(--ink)] hover:border-blue-500/40 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {!isEntrada && (
            <div>
              <label className="label">Responsável / Pessoa (opcional)</label>
              <PersonPicker
                people={pessoas}
                selected={form.pessoa_id}
                onChange={val => setForm(prev => ({ ...prev, pessoa_id: val }))}
                ownProfile={usuario}
              />
            </div>
          )}

          <div>
            <label className="label">Módulo / Finalidade (opcional)</label>
            <select
              className="input"
              value={form.modulo_id}
              onChange={e => setForm({ ...form, modulo_id: e.target.value })}
            >
              <option value="">Sem módulo específico</option>
              {modulos.map(m => (
                <option key={m.id} value={m.id}>📁 {m.nome}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">Observações (opcional)</label>
            <input
              type="text"
              className="input text-xs"
              placeholder="Detalhes adicionais..."
              value={form.observacoes}
              onChange={e => setForm({ ...form, observacoes: e.target.value })}
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--line)]">
            <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
            <button
              type="submit"
              disabled={submitting}
              className={isEntrada ? 'btn-success font-bold' : 'btn-danger font-bold'}
            >
              {submitting ? 'Salvando...' : (isEntrada ? 'Confirmar Entrada' : 'Confirmar Saída')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ModalAjustarSaldoConta({ conta, onClose, onSaved }) {
  const [saldoDesejado, setSaldoDesejado] = useState(String(conta.saldo_atual ?? 0));
  const [descricao, setDescricao] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const novoVal = parseFloat(saldoDesejado);
  const diff = Number.isFinite(novoVal) ? Number((novoVal - conta.saldo_atual).toFixed(2)) : 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!Number.isFinite(novoVal)) return;
    setSubmitting(true);
    try {
      const { data } = await contasApi.ajustarSaldo(conta.id, {
        saldo_desejado: novoVal,
        descricao: descricao.trim() || undefined,
        data_lancamento: todayLocalISO(),
      });
      onSaved(data?.mensagem || 'Saldo ajustado com sucesso!');
      onClose();
    } catch (err) {
      alert('Erro ao ajustar saldo: ' + (err.response?.data?.detail || err.message));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/65 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[var(--surface)] text-[var(--ink)] rounded-3xl shadow-2xl w-full max-w-md p-6 border border-[var(--line)] space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-extrabold text-[var(--ink)]">Ajustar Saldo — {conta.nome}</h2>
            <p className="text-xs text-[var(--muted)]">Informe o saldo exato que aparece no seu banco</p>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-[var(--muted)] hover:text-[var(--ink)] rounded-lg">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="p-3 rounded-xl bg-[var(--raised)] border border-[var(--line)] flex justify-between text-xs">
            <span className="text-[var(--muted)]">Saldo atual no sistema:</span>
            <strong className="text-[var(--ink)]">{fmt(conta.saldo_atual)}</strong>
          </div>

          <div>
            <label className="label">Novo Saldo Real (R$)</label>
            <input
              type="number"
              step="0.01"
              className="input text-lg font-black"
              value={saldoDesejado}
              onChange={e => setSaldoDesejado(e.target.value)}
              required
            />
            {diff !== 0 && (
              <p className={`text-xs font-bold mt-1.5 ${diff > 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                Será lançado um ajuste automático de {diff > 0 ? `+${fmt(diff)} (Entrada)` : `${fmt(diff)} (Saída)`}.
              </p>
            )}
          </div>

          <div>
            <label className="label">Motivo / Descrição (opcional)</label>
            <input
              type="text"
              className="input text-xs"
              placeholder="Ex: Conferência de extrato bancário"
              value={descricao}
              onChange={e => setDescricao(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-[var(--line)]">
            <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
            <button type="submit" disabled={submitting} className="btn-primary">
              {submitting ? 'Ajustando...' : 'Salvar Novo Saldo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CardConta({ conta, pessoas, modulos, refreshTick, onRefresh, onNotice }) {
  const [expanded, setExpanded] = useState(false);
  const [extrato, setExtrato] = useState(null);
  const [loadingExtrato, setLoadingExtrato] = useState(false);
  const [modalMov, setModalMov] = useState(null); // null | 'entrada' | 'saida'
  const [modalAjuste, setModalAjuste] = useState(false);

  const carregarExtrato = async () => {
    setLoadingExtrato(true);
    try {
      const res = await contasApi.extrato(conta.id);
      setExtrato(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingExtrato(false);
    }
  };

  useEffect(() => {
    if (expanded) {
      carregarExtrato();
    }
  }, [conta.saldo_atual, expanded, refreshTick]);

  const handleToggle = () => {
    setExpanded(prev => !prev);
  };

  const handleAfterMove = async (msg) => {
    if (onNotice && msg) onNotice(msg);
    await onRefresh();
  };

  const handleCancelarMov = async (mov) => {
    if (typeof mov.id !== 'number') return;
    if (!window.confirm(`Cancelar a movimentação "${mov.descricao}" (${fmt(mov.valor)})?`)) return;
    try {
      await lancamentosApi.cancelar(mov.id);
      await handleAfterMove(`Movimentação "${mov.descricao}" removida e saldo atualizado.`);
    } catch (err) {
      alert('Erro ao remover movimentação: ' + (err.response?.data?.detail || err.message));
    }
  };

  return (
    <div className="card p-0 overflow-hidden shadow-sm hover:shadow-md transition-shadow" data-testid={`conta-card-${conta.id}`}>
      <div
        className="p-5 flex flex-col gap-4 cursor-pointer hover-surface transition-colors"
        onClick={handleToggle}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-md overflow-hidden bg-white flex-shrink-0"
              style={{ boxShadow: `0 4px 14px ${conta.cor}55` }}
            >
              <IconConta size={52} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-extrabold text-[var(--ink)] text-lg">{conta.nome}</h3>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-[var(--raised)] text-[var(--muted)] border border-[var(--line)]">
                  {conta.tipo}
                </span>
              </div>
              <p className="text-xs text-[var(--muted)] mt-0.5">
                Banco: {conta.banco}
                {conta.agencia && ` • Ag: ${conta.agencia}`}
                {conta.conta && ` • C/C: ${conta.conta}`}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between sm:justify-end gap-5">
            <div className="text-right">
              <span className="text-xs text-[var(--muted)] font-medium block">Saldo Atual</span>
              <span
                data-testid={`conta-saldo-${conta.id}`}
                className={`text-xl font-black ${conta.saldo_atual >= 0 ? 'text-[var(--ink)]' : 'text-rose-500'}`}
              >
                {fmt(conta.saldo_atual)}
              </span>
            </div>
            <div className="p-2 text-[var(--muted)] hover:text-[var(--ink)]">
              {expanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </div>
          </div>
        </div>

        {/* Barra de Ações Diretas na Conta: Adicionar Entrada, Remover Saída, Ajustar Saldo */}
        <div
          className="flex flex-wrap items-center gap-2 pt-3 border-t border-[var(--line)]"
          onClick={e => e.stopPropagation()}
        >
          <button
            type="button"
            data-testid={`btn-conta-entrada-${conta.id}`}
            onClick={() => setModalMov('entrada')}
            className="btn-success text-xs py-1.5 px-3 font-bold"
          >
            <PlusCircle size={15} /> + Adicionar / Entrada
          </button>

          <button
            type="button"
            data-testid={`btn-conta-saida-${conta.id}`}
            onClick={() => setModalMov('saida')}
            className="btn-danger text-xs py-1.5 px-3 font-bold"
          >
            <MinusCircle size={15} /> - Remover / Saída
          </button>

          <button
            type="button"
            data-testid={`btn-conta-ajustar-${conta.id}`}
            onClick={() => setModalAjuste(true)}
            className="btn-secondary text-xs py-1.5 px-3"
          >
            <SlidersHorizontal size={14} /> Ajustar Saldo
          </button>

          <button
            type="button"
            onClick={handleToggle}
            className="btn-secondary text-xs py-1.5 px-3 ml-auto"
          >
            {expanded ? 'Ocultar Extrato' : 'Ver Extrato'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-[var(--line)] bg-[var(--raised)] p-4">
          <h4 className="text-xs font-bold text-[var(--muted)] uppercase tracking-wider mb-3">Extrato de Movimentações</h4>
          {loadingExtrato ? (
            <div className="text-center text-[var(--muted)] py-6 text-sm">Carregando extrato...</div>
          ) : extrato && extrato.movimentacoes.length > 0 ? (
            <div className="space-y-1.5">
              {extrato.movimentacoes.map((m, idx) => (
                <div key={`${m.id}_${idx}`} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-xs">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold shrink-0 ${
                      m.entrada ? 'bg-emerald-500/15 text-emerald-500' : 'bg-rose-500/15 text-rose-500'
                    }`}>
                      {m.entrada ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-[var(--ink)] truncate">{m.descricao}</p>
                      <p className="text-[11px] text-[var(--muted)]">
                        {new Date(m.data + 'T00:00:00').toLocaleDateString('pt-BR')}
                        {m.modulo && ` • ${m.modulo}`}
                        {m.pessoa && ` • ${m.pessoa}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`font-black text-sm ${m.entrada ? 'text-emerald-500' : 'text-[var(--ink)]'}`}>
                      {m.entrada ? '+' : '-'}{fmt(m.valor)}
                    </span>
                    {typeof m.id === 'number' && (
                      <button
                        type="button"
                        onClick={() => handleCancelarMov(m)}
                        className="p-1 text-[var(--muted)] hover:text-rose-500 hover:bg-rose-500/10 rounded-lg transition-colors"
                        title="Cancelar esta movimentação"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[var(--muted)] text-center py-4">Nenhuma movimentação registrada nesta conta.</p>
          )}
        </div>
      )}

      {modalMov && (
        <ModalMovimentarConta
          conta={conta}
          modoInicial={modalMov}
          pessoas={pessoas}
          modulos={modulos}
          onClose={() => setModalMov(null)}
          onSaved={handleAfterMove}
        />
      )}

      {modalAjuste && (
        <ModalAjustarSaldoConta
          conta={conta}
          onClose={() => setModalAjuste(false)}
          onSaved={handleAfterMove}
        />
      )}
    </div>
  );
}

export default function Contas() {
  const [lista, setLista] = useState([]);
  const [pessoas, setPessoas] = useState([]);
  const [modulos, setModulos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalNovo, setModalNovo] = useState(false);
  const [notice, setNotice] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);
  const noticeTimerRef = useRef(null);

  const carregar = async () => {
    setLoading(true);
    try {
      const [resC, resP, resM] = await Promise.all([
        contasApi.listar(),
        pessoasApi.listar(),
        modulosApi.listar(),
      ]);
      setLista(resC.data);
      setPessoas(resP.data);
      setModulos(resM.data);
      setRefreshTick(t => t + 1);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregar();
    return () => {
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    };
  }, []);

  const showNotice = (msg) => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    setNotice(msg);
    noticeTimerRef.current = setTimeout(() => setNotice(''), 6000);
  };

  const saldoTotal = lista.reduce((acc, c) => acc + c.saldo_atual, 0);

  return (
    <div className="space-y-6">
      <div className="page-heading">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--ink)] tracking-tight">Contas Bancárias</h1>
          <p className="text-[var(--muted)] text-sm mt-0.5">
            Saldo real consolidado: <strong className="text-[var(--ink)]">{fmt(saldoTotal)}</strong>
          </p>
        </div>
        <button onClick={() => setModalNovo(true)} className="btn-primary text-sm shadow-md shadow-blue-600/20">
          <Plus size={18} /> Nova Conta
        </button>
      </div>

      {notice && (
        <div
          data-testid="contas-notice-banner"
          role="status"
          className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-500 px-4 py-3 text-sm font-semibold flex items-center justify-between gap-2"
        >
          <span className="flex items-center gap-2"><CheckCircle2 size={17} /> {notice}</span>
          <button type="button" onClick={() => setNotice('')} className="p-1 rounded hover:bg-emerald-500/20">
            <X size={15} />
          </button>
        </div>
      )}

      {loading && lista.length === 0 ? (
        <div className="flex items-center justify-center h-64 text-[var(--muted)] text-sm">Carregando contas...</div>
      ) : lista.length === 0 ? (
        <div className="card text-center py-16">
          <div className="w-14 h-14 bg-blue-500/10 text-blue-500 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <Building2 size={28} />
          </div>
          <h3 className="font-bold text-[var(--ink)] text-lg">Nenhuma conta cadastrada</h3>
          <p className="text-[var(--muted)] text-sm max-w-sm mx-auto mt-1 mb-5">
            Cadastre suas contas correntes, poupanças ou carteiras para lançar entradas, saídas e controlar o saldo real.
          </p>
          <button onClick={() => setModalNovo(true)} className="btn-primary text-sm">
            Cadastrar Primeira Conta
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {lista.map(c => (
            <CardConta
              key={c.id}
              conta={c}
              pessoas={pessoas}
              modulos={modulos}
              refreshTick={refreshTick}
              onRefresh={carregar}
              onNotice={showNotice}
            />
          ))}
        </div>
      )}

      {modalNovo && (
        <ModalNovaConta onClose={() => setModalNovo(false)} onSaved={carregar} />
      )}
    </div>
  );
}
