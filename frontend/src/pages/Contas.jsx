import { useState, useEffect } from 'react';
import { contas as contasApi } from '../api/client';
import {
  Building2, Plus, ArrowDownLeft, ArrowUpRight,
  ChevronDown, ChevronUp, X, Wallet
} from 'lucide-react';
import { IconConta } from '../components/ModuleIcon';

function fmt(val) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);
}

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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6 border border-gray-100">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900">Cadastrar Nova Conta</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700 rounded-lg"><X size={20} /></button>
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
            <p className="text-xs text-gray-400 mt-1">Saldo inicial a partir do qual as movimentações serão somadas.</p>
          </div>

          <div>
            <label className="label">Cor do Ícone</label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                className="w-12 h-10 rounded-lg cursor-pointer border border-gray-300"
                value={form.cor}
                onChange={e => setForm({ ...form, cor: e.target.value })}
              />
              <span className="text-xs text-gray-500 font-mono uppercase">{form.cor}</span>
            </div>
          </div>

          <div className="flex gap-2 justify-end pt-3 border-t">
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

function CardConta({ conta, onRefresh }) {
  const [expanded, setExpanded] = useState(false);
  const [extrato, setExtrato] = useState(null);
  const [loadingExtrato, setLoadingExtrato] = useState(false);

  const carregarExtrato = async () => {
    if (extrato) return;
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

  const handleToggle = () => {
    if (!expanded) carregarExtrato();
    setExpanded(!expanded);
  };

  return (
    <div className="card p-0 overflow-hidden shadow-sm hover:shadow-md transition-shadow">
      <div
        className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 cursor-pointer hover-surface transition-colors"
        onClick={handleToggle}
      >
        <div className="flex items-center gap-4">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-md overflow-hidden bg-white flex-shrink-0"
            style={{ boxShadow: `0 4px 14px ${conta.cor}55` }}
          >
            <IconConta size={52} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-extrabold text-gray-900 text-lg">{conta.nome}</h3>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                {conta.tipo}
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              Banco: {conta.banco}
              {conta.agencia && ` • Ag: ${conta.agencia}`}
              {conta.conta && ` • C/C: ${conta.conta}`}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-5">
          <div className="text-right">
            <span className="text-xs text-gray-400 font-medium block">Saldo Atual</span>
            <span className={`text-xl font-black ${conta.saldo_atual >= 0 ? 'text-gray-900' : 'text-rose-600'}`}>
              {fmt(conta.saldo_atual)}
            </span>
          </div>
          <div className="p-2 text-gray-400 hover:text-gray-700">
            {expanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
          </div>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 bg-slate-50/60 p-4">
          <h4 className="text-xs font-bold text-gray-600 uppercase tracking-wider mb-3">Extrato de Movimentações</h4>
          {loadingExtrato ? (
            <div className="text-center text-gray-400 py-6 text-sm">Carregando extrato...</div>
          ) : extrato && extrato.movimentacoes.length > 0 ? (
            <div className="space-y-1.5">
              {extrato.movimentacoes.map((m, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 rounded-xl bg-white border border-gray-100 text-xs">
                  <div className="flex items-center gap-2.5">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold ${
                      m.entrada ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'
                    }`}>
                      {m.entrada ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}
                    </div>
                    <div>
                      <p className="font-bold text-gray-900">{m.descricao}</p>
                      <p className="text-[11px] text-gray-400">{new Date(m.data + 'T00:00:00').toLocaleDateString('pt-BR')}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className={`font-black text-sm ${m.entrada ? 'text-emerald-600' : 'text-gray-900'}`}>
                      {m.entrada ? '+' : '-'}{fmt(m.valor)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-400 text-center py-4">Nenhuma movimentação registrada nesta conta.</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function Contas() {
  const [lista, setLista] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalNovo, setModalNovo] = useState(false);

  const carregar = async () => {
    setLoading(true);
    try {
      const res = await contasApi.listar();
      setLista(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregar();
  }, []);

  const saldoTotal = lista.reduce((acc, c) => acc + c.saldo_atual, 0);

  return (
    <div className="space-y-6">
      <div className="page-heading">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">Contas Bancárias</h1>
          <p className="text-gray-500 text-sm mt-0.5">Saldo real consolidado: <strong className="text-gray-900">{fmt(saldoTotal)}</strong></p>
        </div>
        <button onClick={() => setModalNovo(true)} className="btn-primary text-sm shadow-md shadow-blue-600/20">
          <Plus size={18} /> Nova Conta
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Carregando contas...</div>
      ) : lista.length === 0 ? (
        <div className="card text-center py-16">
          <div className="w-14 h-14 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <Building2 size={28} />
          </div>
          <h3 className="font-bold text-gray-900 text-lg">Nenhuma conta cadastrada</h3>
          <p className="text-gray-400 text-sm max-w-sm mx-auto mt-1 mb-5">
            Cadastre suas contas correntes, poupanças ou carteiras para controlar o saldo real.
          </p>
          <button onClick={() => setModalNovo(true)} className="btn-primary text-sm">
            Cadastrar Primeira Conta
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {lista.map(c => (
            <CardConta key={c.id} conta={c} onRefresh={carregar} />
          ))}
        </div>
      )}

      {modalNovo && (
        <ModalNovaConta onClose={() => setModalNovo(false)} onSaved={carregar} />
      )}
    </div>
  );
}
