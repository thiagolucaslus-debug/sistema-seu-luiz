import { useState, useEffect } from 'react';
import {
  lancamentos as lancamentosApi,
  cartoes as cartoesApi,
  contas as contasApi,
  pessoas as pessoasApi,
  modulos as modulosApi
} from '../api/client';
import {
  Plus, X, Trash2, Building2, CreditCard, ArrowDownRight,
  ArrowUpRight, ArrowLeftRight, HandCoins, Calendar, CheckCircle2, ShoppingBag
} from 'lucide-react';
import Avatar from '../components/Avatar';
import CardArtwork from '../components/CardArtwork';
import { getCardBrand } from '../components/cardBrand';
import PersonPicker from '../components/PersonPicker';
import { todayLocalISO, predictInvoiceMonth } from '../components/dateUtils';
import { useAuth } from '../contexts/AuthContext';

function fmt(val) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);
}

const MESES_CURTOS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

const TIPOS = [
  { value: 'compra_cartao', label: 'Compra no cartão', short: 'Cartão', tone: 'blue', icon: CreditCard },
  { value: 'despesa_conta', label: 'Despesa bancária ou em dinheiro', short: 'Saída / Despesa', tone: 'yellow', icon: ArrowUpRight },
  { value: 'emprestimo_dado', label: 'Empréstimo de dinheiro', short: 'Empréstimo', tone: 'red', icon: HandCoins },
  { value: 'receita', label: 'Receita ou entrada', short: 'Entrada / Receita', tone: 'green', icon: ArrowDownRight },
  { value: 'transferencia', label: 'Transferência entre contas', short: 'Transferência', tone: 'blue', icon: ArrowLeftRight },
];

const TIPOS_EXTRA = [
  { value: 'compra_para_mim', label: 'Compra feita para você (abatimento)', short: 'Abatimento', tone: 'green', icon: ShoppingBag },
  { value: 'reembolso_pessoa', label: 'Reembolso pago à pessoa', short: 'Reembolso', tone: 'yellow', icon: HandCoins },
];

const TODOS_TIPOS = [...TIPOS, ...TIPOS_EXTRA];

function ModalNovoLancamento({ cartoes, contas, pessoas, modulos, onClose, onSaved }) {
  const { usuario } = useAuth();
  const hoje = todayLocalISO();
  const [form, setForm] = useState({
    tipo: 'compra_cartao',
    descricao: '',
    valor_total: '',
    total_parcelas: 1,
    data_lancamento: hoje,
    mes_fatura_modo: 'auto', // 'auto' | 'manual'
    mes_fatura: new Date().getMonth() + 1,
    ano_fatura: new Date().getFullYear(),
    cartao_id: '',
    conta_id: '',
    conta_destino_id: '',
    pessoa_id: '',
    modulo_id: '',
    observacoes: ''
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const f = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      const payload = {
        tipo: form.tipo,
        descricao: form.descricao.trim(),
        valor_total: parseFloat(form.valor_total),
        total_parcelas: form.tipo === 'compra_cartao' ? (parseInt(form.total_parcelas, 10) || 1) : 1,
        data_lancamento: form.data_lancamento,
        mes_fatura: form.tipo === 'compra_cartao' && form.mes_fatura_modo === 'manual' ? Number(form.mes_fatura) : null,
        ano_fatura: form.tipo === 'compra_cartao' && form.mes_fatura_modo === 'manual' ? Number(form.ano_fatura) : null,
        cartao_id: form.tipo === 'compra_cartao' && form.cartao_id ? parseInt(form.cartao_id, 10) : null,
        conta_id: form.tipo !== 'compra_cartao' && form.conta_id ? parseInt(form.conta_id, 10) : null,
        conta_destino_id: form.tipo === 'transferencia' && form.conta_destino_id ? parseInt(form.conta_destino_id, 10) : null,
        pessoa_id: ['compra_cartao', 'despesa_conta', 'emprestimo_dado'].includes(form.tipo) && form.pessoa_id
          ? parseInt(form.pessoa_id, 10) : null,
        modulo_id: form.modulo_id ? parseInt(form.modulo_id, 10) : null,
        observacoes: form.observacoes?.trim() || null,
      };

      const res = await lancamentosApi.criar(payload);
      onSaved(res.data, payload);
      onClose();
    } catch (err) {
      setError(err.response?.data?.detail || 'Erro ao salvar o lançamento.');
    } finally {
      setSubmitting(false);
    }
  };

  const valorParcela = form.valor_total && form.total_parcelas > 1
    ? (parseFloat(form.valor_total) / parseInt(form.total_parcelas, 10)).toFixed(2)
    : null;
  const cartaoSelecionado = cartoes.find(cartao => String(cartao.id) === String(form.cartao_id));
  const faturaPrevista = form.tipo === 'compra_cartao' && cartaoSelecionado
    ? predictInvoiceMonth(form.data_lancamento, cartaoSelecionado.dia_fechamento)
    : null;

  return (
    <div className="fixed inset-0 bg-black/65 backdrop-blur-sm z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-[var(--surface)] text-[var(--ink)] rounded-3xl shadow-2xl w-full max-w-xl my-6 border border-[var(--line)]">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-6 border-b border-[var(--line)] bg-[var(--raised)] rounded-t-3xl">
          <div>
            <h2 className="text-lg font-bold text-[var(--ink)]">Novo Lançamento</h2>
            <p className="text-xs text-[var(--muted)]">Registrar despesa, compra, empréstimo ou receita</p>
          </div>
          <button onClick={onClose} className="p-2 text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--surface)] rounded-xl">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-rose-500/10 border border-rose-500/30 text-rose-500 px-4 py-3 rounded-xl text-sm font-medium">
              {error}
            </div>
          )}

          {/* Tipo de Lançamento */}
          <div>
            <label className="label">Tipo de Movimento</label>
            <select
              className="input font-medium"
              value={form.tipo}
              onChange={e => f('tipo', e.target.value)}
              required
            >
              {TIPOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          {/* Descrição */}
          <div>
            <label className="label">Descrição do Lançamento</label>
            <input
              type="text"
              className="input text-base"
              placeholder="Ex: Compra Material Construção, Farmácia, Empréstimo..."
              value={form.descricao}
              onChange={e => f('descricao', e.target.value)}
              required
            />
          </div>

          {/* Valor e Parcelas */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Valor Total (R$)</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                className="input text-base font-bold"
                placeholder="0,00"
                value={form.valor_total}
                onChange={e => f('valor_total', e.target.value)}
                required
              />
            </div>

            {form.tipo === 'compra_cartao' ? (
              <div>
                <label className="label">Parcelamento</label>
                <select
                  className="input font-semibold"
                  value={form.total_parcelas}
                  onChange={e => f('total_parcelas', parseInt(e.target.value, 10))}
                >
                  <option value={1}>À vista (1x)</option>
                  {Array.from({ length: 47 }, (_, i) => i + 2).map(n => (
                    <option key={n} value={n}>{n} vezes</option>
                  ))}
                </select>
                {valorParcela && (
                  <p className="text-xs font-semibold text-blue-500 mt-1">
                    {form.total_parcelas} parcelas de R$ {valorParcela}
                  </p>
                )}
              </div>
            ) : (
              <div>
                <label className="label">Data</label>
                <input
                  type="date"
                  className="input"
                  value={form.data_lancamento}
                  onChange={e => f('data_lancamento', e.target.value)}
                  required
                />
              </div>
            )}
          </div>

          {form.tipo === 'compra_cartao' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Data da Compra</label>
                <input
                  type="date"
                  className="input"
                  value={form.data_lancamento}
                  onChange={e => f('data_lancamento', e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="label">Fatura Inicial</label>
                <select
                  className="input text-xs font-semibold"
                  value={form.mes_fatura_modo}
                  onChange={e => f('mes_fatura_modo', e.target.value)}
                >
                  <option value="auto">
                    Automático {faturaPrevista ? `(${faturaPrevista.label})` : '(pelo fechamento)'}
                  </option>
                  <option value="manual">Escolher mês da fatura manualmente</option>
                </select>
              </div>
            </div>
          )}

          {form.tipo === 'compra_cartao' && form.mes_fatura_modo === 'manual' && (
            <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-[var(--raised)] border border-[var(--line)]">
              <div>
                <label className="label">Mês da 1ª Fatura</label>
                <select
                  className="input"
                  value={form.mes_fatura}
                  onChange={e => f('mes_fatura', Number(e.target.value))}
                >
                  {MESES_CURTOS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Ano da 1ª Fatura</label>
                <select
                  className="input"
                  value={form.ano_fatura}
                  onChange={e => f('ano_fatura', Number(e.target.value))}
                >
                  {[2024, 2025, 2026, 2027, 2028].map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
            </div>
          )}

          {/* Seletor de Cartão (quando for compra_cartao) */}
          {form.tipo === 'compra_cartao' && (
            <div>
              <label className="label">Cartão Utilizado</label>
              <select
                className="input"
                value={form.cartao_id}
                onChange={e => f('cartao_id', e.target.value)}
                required
              >
                <option value="">Selecione o cartão...</option>
                {cartoes.map(c => (
                  <option key={c.id} value={c.id}>{c.nome} (Fecha dia {c.dia_fechamento})</option>
                ))}
              </select>
              {cartaoSelecionado && (
                <div className="mt-2 p-2.5 rounded-xl bg-[var(--raised)] border border-[var(--line)] flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 text-[var(--muted)]">
                    <CardArtwork cartao={cartaoSelecionado} compact />
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: getCardBrand(cartaoSelecionado.nome, cartaoSelecionado.cor).color }}
                    />
                    <span className="font-semibold text-[var(--ink)]">{cartaoSelecionado.nome}</span>
                    <span>• {cartaoSelecionado.bandeira}</span>
                  </div>
                  {faturaPrevista && form.mes_fatura_modo === 'auto' && (
                    <span className="badge-blue">
                      Fatura prevista: {faturaPrevista.label}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Seletor de Conta (para despesa_conta, emprestimo_dado, receita, transferencia) */}
          {['despesa_conta', 'emprestimo_dado', 'receita', 'transferencia'].includes(form.tipo) && (
            <div>
              <label className="label">
                {form.tipo === 'receita' ? 'Conta de Destino (onde entrou)' : 'Conta de Origem (de onde saiu)'}
              </label>
              <select
                className="input"
                value={form.conta_id}
                onChange={e => f('conta_id', e.target.value)}
                required
              >
                <option value="">Selecione a conta...</option>
                {contas.map(c => (
                  <option key={c.id} value={c.id}>{c.nome} ({c.banco})</option>
                ))}
              </select>
            </div>
          )}

          {/* Conta de Destino para Transferência */}
          {form.tipo === 'transferencia' && (
            <div>
              <label className="label">Conta de Destino (para onde vai)</label>
              <select
                className="input"
                value={form.conta_destino_id}
                onChange={e => f('conta_destino_id', e.target.value)}
                required
              >
                <option value="">Selecione a conta de destino...</option>
                {contas.filter(c => c.id !== parseInt(form.conta_id, 10)).map(c => (
                  <option key={c.id} value={c.id}>{c.nome} ({c.banco})</option>
                ))}
              </select>
            </div>
          )}

          {/* Quem usou / Pessoa responsável */}
          {['compra_cartao', 'despesa_conta', 'emprestimo_dado'].includes(form.tipo) && (
            <div className="bg-[var(--raised)] p-4 rounded-2xl border border-[var(--line)]">
              <label className="label">
                {form.tipo === 'emprestimo_dado' ? 'Quem pegou o dinheiro emprestado?' : 'Quem usou / Quem vai pagar esse gasto?'}
              </label>
              <PersonPicker
                people={pessoas}
                selected={form.pessoa_id}
                onChange={value => f('pessoa_id', value)}
                ownProfile={usuario}
                required={form.tipo === 'emprestimo_dado'}
              />
              <p className="text-xs text-[var(--muted)] mt-1.5">
                Ao selecionar uma pessoa, o valor entra automaticamente no perfil e no fechamento mensal dela.
              </p>
            </div>
          )}

          {/* Módulo / Finalidade (Casa, Roça, Carro...) */}
          <div>
            <label className="label">Módulo / Finalidade</label>
            <select
              className="input"
              value={form.modulo_id}
              onChange={e => f('modulo_id', e.target.value)}
            >
              <option value="">Sem módulo específico</option>
              {modulos.map(m => (
                <option key={m.id} value={m.id}>📁 {m.nome}</option>
              ))}
            </select>
          </div>

          {/* Observações */}
          <div>
            <label className="label">Observações / Detalhes</label>
            <textarea
              className="input resize-none"
              rows={2}
              placeholder="Ex: Nota fiscal, itens comprados, etc."
              value={form.observacoes}
              onChange={e => f('observacoes', e.target.value)}
            />
          </div>

          {/* Ações do Modal */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-[var(--line)]">
            <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
            <button type="submit" disabled={submitting} className="btn-primary">
              {submitting ? 'Salvando...' : 'Salvar Lançamento'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Lancamentos() {
  const { usuario } = useAuth();
  const hoje = new Date();
  const [mes, setMes] = useState(hoje.getMonth() + 1); // 0 = Todos os meses
  const [ano, setAno] = useState(hoje.getFullYear());
  const [tipoFiltro, setTipoFiltro] = useState('');
  const [pessoaFiltro, setPessoaFiltro] = useState('');
  const [cartaoFiltro, setCartaoFiltro] = useState('');
  const [contaFiltro, setContaFiltro] = useState('');
  const [lista, setLista] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [savedNotice, setSavedNotice] = useState('');

  const [cartoes, setCartoes] = useState([]);
  const [contas, setContas] = useState([]);
  const [pessoas, setPessoas] = useState([]);
  const [modulos, setModulos] = useState([]);

  const carregar = async (overrides = null) => {
    setLoading(true);
    try {
      const mVal = overrides?.mes !== undefined ? overrides.mes : mes;
      const aVal = overrides?.ano !== undefined ? overrides.ano : ano;
      const tVal = overrides?.tipoFiltro !== undefined ? overrides.tipoFiltro : tipoFiltro;
      const pVal = overrides?.pessoaFiltro !== undefined ? overrides.pessoaFiltro : pessoaFiltro;
      const cVal = overrides?.cartaoFiltro !== undefined ? overrides.cartaoFiltro : cartaoFiltro;
      const ctVal = overrides?.contaFiltro !== undefined ? overrides.contaFiltro : contaFiltro;

      const params = {};
      if (mVal > 0) {
        params.mes = mVal;
        params.ano = aVal;
      }
      if (tVal) params.tipo = tVal;
      if (pVal) params.pessoa_id = pVal;
      if (cVal) params.cartao_id = cVal;
      if (ctVal) params.conta_id = ctVal;

      const [resL, resC, resCt, resP, resM] = await Promise.all([
        lancamentosApi.listar(params),
        cartoesApi.listar(),
        contasApi.listar(),
        pessoasApi.listar(),
        modulosApi.listar()
      ]);

      setLista(resL.data.items);
      setTotal(resL.data.total);
      setCartoes(resC.data);
      setContas(resCt.data);
      setPessoas(resP.data);
      setModulos(resM.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregar();
  }, [mes, ano, tipoFiltro, pessoaFiltro, cartaoFiltro, contaFiltro]);

  const handleSavedLancamento = (created, payload) => {
    const dtStr = created?.data_lancamento || payload?.data_lancamento || '';
    const overrides = {};
    let changedFilter = false;

    if (mes > 0 && /^\d{4}-\d{2}-\d{2}$/.test(dtStr)) {
      const [yStr, mStr] = dtStr.split('-');
      const createdAno = Number(yStr);
      const createdMes = Number(mStr);
      if (createdAno !== ano || createdMes !== mes) {
        setMes(createdMes);
        setAno(createdAno);
        overrides.mes = createdMes;
        overrides.ano = createdAno;
        changedFilter = true;
      }
    }

    if (tipoFiltro && payload?.tipo && tipoFiltro !== payload.tipo) {
      setTipoFiltro('');
      overrides.tipoFiltro = '';
      changedFilter = true;
    }
    if (pessoaFiltro && String(pessoaFiltro) !== String(payload?.pessoa_id || '')) {
      setPessoaFiltro('');
      overrides.pessoaFiltro = '';
      changedFilter = true;
    }
    if (cartaoFiltro && String(cartaoFiltro) !== String(payload?.cartao_id || '')) {
      setCartaoFiltro('');
      overrides.cartaoFiltro = '';
      changedFilter = true;
    }
    if (contaFiltro && String(contaFiltro) !== String(payload?.conta_id || '')) {
      setContaFiltro('');
      overrides.contaFiltro = '';
      changedFilter = true;
    }

    const fatInfo = created?.fatura_inicial ? ` • Fatura inicial: ${created.fatura_inicial}` : '';
    setSavedNotice(`Lançamento "${created?.descricao || payload?.descricao}" salvo automaticamente!${fatInfo}`);
    setTimeout(() => setSavedNotice(''), 7000);

    if (!changedFilter) {
      carregar();
    }
  };

  const handleCancelar = async (id, descricao) => {
    if (!confirm(`Deseja realmente cancelar o lançamento "${descricao}"?`)) return;
    try {
      await lancamentosApi.cancelar(id);
      carregar();
    } catch (e) {
      alert('Erro ao cancelar: ' + e.message);
    }
  };

  const getTipoBadge = (tipo) => {
    const tipoInfo = TODOS_TIPOS.find(item => item.value === tipo);
    if (!tipoInfo) return <span className="badge-blue">{tipo}</span>;
    const Icon = tipoInfo.icon;
    return <span className={`badge-${tipoInfo.tone} gap-1 whitespace-nowrap`}><Icon size={13} />{tipoInfo.short}</span>;
  };

  const formatFaturaBadge = (item) => {
    if (item.tipo !== 'compra_cartao' || !item.mes_fatura || !item.ano_fatura) return null;
    const label = `${MESES_CURTOS[item.mes_fatura - 1]}/${item.ano_fatura}`;
    const [dAno, dMes] = (item.data_lancamento || '').split('-').map(Number);
    const diferenteDaCompra = dMes && dAno && (dMes !== item.mes_fatura || dAno !== item.ano_fatura);
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${
          diferenteDaCompra
            ? 'bg-amber-500/15 text-amber-500 border border-amber-500/30'
            : 'bg-blue-500/10 text-blue-500 border border-blue-500/20'
        }`}
        title={diferenteDaCompra ? 'Compra feita após o fechamento do cartão — entra na fatura seguinte' : 'Fatura inicial desta compra'}
      >
        <Calendar size={11} />
        Fatura {label}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="page-heading">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--ink)] tracking-tight">Lançamentos</h1>
          <p className="text-[var(--muted)] text-sm mt-0.5">
            {total === 1 ? '1 movimentação registrada' : `${total} movimentações registradas`}
            {mes === 0 ? ' (todos os períodos)' : ` em ${MESES_CURTOS[mes - 1]}/${ano}`}
          </p>
        </div>
        <button onClick={() => setModal(true)} className="btn-primary text-sm shadow-md shadow-blue-600/20">
          <Plus size={18} /> Novo Lançamento
        </button>
      </div>

      {savedNotice && (
        <div
          data-testid="lancamento-saved-banner"
          role="status"
          className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-500 px-4 py-3 text-sm font-semibold flex items-center justify-between gap-2"
        >
          <span className="flex items-center gap-2"><CheckCircle2 size={17} /> {savedNotice}</span>
          <button type="button" onClick={() => setSavedNotice('')} className="p-1 rounded hover:bg-emerald-500/20">
            <X size={15} />
          </button>
        </div>
      )}

      {/* Barra de Filtros */}
      <div className="card p-4 movement-filters">
        <label><span className="label">Mês</span>
          <select
            className="input"
            value={mes}
            onChange={e => setMes(Number(e.target.value))}
          >
            <option value={0}>Todos os meses</option>
            {MESES_CURTOS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
        </label>
        <label><span className="label">Ano</span>
          <select
            className="input"
            value={ano}
            disabled={mes === 0}
            onChange={e => setAno(Number(e.target.value))}
          >
            {[2024, 2025, 2026, 2027, 2028].map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>

        {/* Filtro por Tipo */}
        <label><span className="label">Tipo</span><select
          className="input"
          value={tipoFiltro}
          onChange={e => setTipoFiltro(e.target.value)}
        >
          <option value="">Todos os tipos</option>
          {TODOS_TIPOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select></label>

        {/* Filtro por Pessoa */}
        <label><span className="label">Responsável</span><select
          className="input"
          value={pessoaFiltro}
          onChange={e => setPessoaFiltro(e.target.value)}
        >
          <option value="">Todas as pessoas</option>
          {pessoas.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </select></label>

        {/* Filtro por Cartão */}
        <label><span className="label">Cartão</span><select
          className="input"
          value={cartaoFiltro}
          onChange={e => setCartaoFiltro(e.target.value)}
        >
          <option value="">Todos os cartões</option>
          {cartoes.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select></label>

        {/* Filtro por Conta Bancária */}
        <label><span className="label">Conta</span><select
          className="input"
          value={contaFiltro}
          onChange={e => setContaFiltro(e.target.value)}
        >
          <option value="">Todas as contas</option>
          {contas.map(ct => <option key={ct.id} value={ct.id}>{ct.nome}</option>)}
        </select></label>
      </div>

      {/* Tabela de Lançamentos */}
      {loading ? (
        <div className="flex flex-col items-center justify-center h-64 gap-2">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          <span className="text-[var(--muted)] text-sm">Carregando lista de lançamentos...</span>
        </div>
      ) : lista.length === 0 ? (
        <div className="card text-center py-16">
          <div className="w-14 h-14 bg-blue-500/10 text-blue-500 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <Plus size={28} />
          </div>
          <h3 className="font-bold text-[var(--ink)] text-lg">Nenhum lançamento no período</h3>
          <p className="text-[var(--muted)] text-sm max-w-sm mx-auto mt-1 mb-5">
            Cadastre compras de cartões, entradas, despesas ou empréstimos para organizar o mês.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {mes !== 0 && (
              <button onClick={() => setMes(0)} className="btn-secondary text-sm">
                Ver Todos os Meses
              </button>
            )}
            <button onClick={() => setModal(true)} className="btn-primary text-sm">
              Criar Lançamento Agora
            </button>
          </div>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="movement-table w-full text-left text-sm">
              <thead className="border-b border-[var(--line)] uppercase text-[11px] font-bold tracking-wider">
                <tr>
                  <th className="px-5 py-3.5">Descrição</th>
                  <th className="px-5 py-3.5">Responsável</th>
                  <th className="px-5 py-3.5">Cartão / Origem</th>
                  <th className="px-5 py-3.5">Módulo</th>
                  <th className="px-5 py-3.5 text-right">Valor Total</th>
                  <th className="px-5 py-3.5 text-center">Parcelas</th>
                  <th className="px-5 py-3.5">Data</th>
                  <th className="px-5 py-3.5 text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {lista.map(item => {
                  const isEntrada = item.tipo === 'receita';
                  return (
                    <tr key={item.id} className="transition-colors">
                      <td className="px-5 py-3.5">
                        <p className="font-bold text-[var(--ink)]">{item.descricao}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {getTipoBadge(item.tipo)}
                          {formatFaturaBadge(item)}
                        </div>
                        {item.observacoes && (
                          <p className="text-xs text-[var(--muted)] truncate max-w-xs mt-0.5">{item.observacoes}</p>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
                          <Avatar nome={item.pessoa?.nome || usuario?.nome}
                            foto={item.pessoa ? item.pessoa.foto_path : usuario?.logo_path}
                            cor={item.pessoa?.cor} className="avatar--table" />
                          {item.pessoa?.nome || 'Você'}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 font-medium text-xs">
                        {item.cartao ? (
                          <span className="inline-flex items-center gap-2 font-semibold">
                            <CardArtwork cartao={item.cartao} compact />
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: getCardBrand(item.cartao.nome, item.cartao.cor).color }}
                            />
                            {item.cartao.nome}
                          </span>
                        ) : item.conta ? (
                          <span className="inline-flex items-center gap-1.5 text-blue-500 font-semibold">
                            <Building2 size={15} />
                            {item.conta.nome}
                            {item.conta_destino && ` → ${item.conta_destino.nome}`}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-5 py-3.5">
                        {item.modulo ? (
                          <span
                            className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium"
                            style={{ backgroundColor: item.modulo.cor + '20', color: item.modulo.cor }}
                          >
                            {item.modulo.nome}
                          </span>
                        ) : <span className="text-[var(--muted)]">—</span>}
                      </td>
                      <td className={`px-5 py-3.5 text-right font-bold money ${isEntrada ? 'text-emerald-500' : 'text-[var(--ink)]'}`}>
                        {isEntrada ? '+' : ''}{fmt(item.valor_total)}
                        {item.parcela_mes && item.total_parcelas > 1 && (
                          <span className="block text-[10px] font-semibold text-[var(--muted)]">
                            Parc. {item.parcela_mes.numero}/{item.total_parcelas}: {fmt(item.parcela_mes.valor)}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-center">
                        {item.total_parcelas > 1 ? (
                          <span className="badge-blue text-xs">
                            {item.total_parcelas}x
                          </span>
                        ) : (
                          <span className="text-[var(--muted)] text-xs">1x</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-[var(--muted)] text-xs whitespace-nowrap">
                        {new Date(item.data_lancamento + 'T00:00:00').toLocaleDateString('pt-BR')}
                      </td>
                      <td className="px-5 py-3.5 text-center">
                        <button
                          onClick={() => handleCancelar(item.id, item.descricao)}
                          className="p-1.5 text-[var(--muted)] hover:text-rose-500 hover:bg-rose-500/10 rounded-lg transition-colors"
                          title="Cancelar lançamento"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal de Cadastro */}
      {modal && (
        <ModalNovoLancamento
          cartoes={cartoes}
          contas={contas}
          pessoas={pessoas}
          modulos={modulos}
          onClose={() => setModal(false)}
          onSaved={handleSavedLancamento}
        />
      )}
    </div>
  );
}
