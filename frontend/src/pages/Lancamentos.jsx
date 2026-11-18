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
  ArrowUpRight, ArrowLeftRight, HandCoins
} from 'lucide-react';
import Avatar from '../components/Avatar';
import CardArtwork from '../components/CardArtwork';
import PersonPicker from '../components/PersonPicker';
import { useAuth } from '../contexts/AuthContext';

function fmt(val) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);
}

const TIPOS = [
  { value: 'compra_cartao', label: 'Compra no cartão', short: 'Cartão', tone: 'blue', icon: CreditCard },
  { value: 'despesa_conta', label: 'Despesa bancária ou em dinheiro', short: 'Despesa', tone: 'yellow', icon: ArrowUpRight },
  { value: 'emprestimo_dado', label: 'Empréstimo de dinheiro', short: 'Empréstimo', tone: 'red', icon: HandCoins },
  { value: 'receita', label: 'Receita ou entrada', short: 'Receita', tone: 'green', icon: ArrowDownRight },
  { value: 'transferencia', label: 'Transferência entre contas', short: 'Transferência', tone: 'blue', icon: ArrowLeftRight },
];

function ModalNovoLancamento({ cartoes, contas, pessoas, modulos, onClose, onSaved }) {
  const { usuario } = useAuth();
  const hoje = new Date().toISOString().split('T')[0];
  const [form, setForm] = useState({
    tipo: 'compra_cartao',
    descricao: '',
    valor_total: '',
    total_parcelas: 1,
    data_lancamento: hoje,
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
        ...form,
        valor_total: parseFloat(form.valor_total),
        total_parcelas: parseInt(form.total_parcelas) || 1,
        cartao_id: form.tipo === 'compra_cartao' && form.cartao_id ? parseInt(form.cartao_id) : null,
        conta_id: form.tipo !== 'compra_cartao' && form.conta_id ? parseInt(form.conta_id) : null,
        conta_destino_id: form.tipo === 'transferencia' && form.conta_destino_id ? parseInt(form.conta_destino_id) : null,
        pessoa_id: ['compra_cartao', 'despesa_conta', 'emprestimo_dado'].includes(form.tipo) && form.pessoa_id
          ? parseInt(form.pessoa_id) : null,
        modulo_id: form.modulo_id ? parseInt(form.modulo_id) : null,
      };

      await lancamentosApi.criar(payload);
      onSaved();
      onClose();
    } catch (err) {
      setError(err.response?.data?.detail || 'Erro ao salvar o lançamento.');
    } finally {
      setSubmitting(false);
    }
  };

  const valorParcela = form.valor_total && form.total_parcelas > 1
    ? (parseFloat(form.valor_total) / parseInt(form.total_parcelas)).toFixed(2)
    : null;
  const cartaoSelecionado = cartoes.find(cartao => String(cartao.id) === form.cartao_id);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xl my-6 border border-gray-100">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100 bg-slate-50/70 rounded-t-3xl">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Novo Lançamento</h2>
            <p className="text-xs text-gray-500">Registrar despesa, compra, empréstimo ou receita</p>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-xl">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm font-medium">
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
                className="input text-base font-bold text-gray-900"
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
                  onChange={e => f('total_parcelas', parseInt(e.target.value))}
                >
                  <option value={1}>À vista (1x)</option>
                  {Array.from({ length: 47 }, (_, i) => i + 2).map(n => (
                    <option key={n} value={n}>{n} vezes</option>
                  ))}
                </select>
                {valorParcela && (
                  <p className="text-xs font-semibold text-blue-600 mt-1">
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
                <div className="mt-2 flex items-center gap-2 text-sm text-[var(--muted)]">
                  <CardArtwork cartao={cartaoSelecionado} compact />
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: cartaoSelecionado.cor || '#8B5CF6' }}
                  />
                  <span className="font-semibold text-[var(--ink)]">{cartaoSelecionado.nome}</span>
                  <span>• {cartaoSelecionado.bandeira}</span>
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
                {contas.filter(c => c.id !== parseInt(form.conta_id)).map(c => (
                  <option key={c.id} value={c.id}>{c.nome} ({c.banco})</option>
                ))}
              </select>
            </div>
          )}

          {/* Quem usou / Pessoa responsável */}
          {['compra_cartao', 'despesa_conta', 'emprestimo_dado'].includes(form.tipo) && (
            <div className="bg-blue-50/50 p-4 rounded-2xl border border-blue-100">
              <label className="label text-blue-900">
                {form.tipo === 'emprestimo_dado' ? 'Quem pegou o dinheiro emprestado?' : 'Quem usou / Quem vai pagar esse gasto?'}
              </label>
              <PersonPicker
                people={pessoas}
                selected={form.pessoa_id}
                onChange={value => f('pessoa_id', value)}
                ownProfile={usuario}
                required={form.tipo === 'emprestimo_dado'}
              />
              <p className="text-xs text-blue-600 mt-1.5">
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
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-gray-100">
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
  const [mes, setMes] = useState(hoje.getMonth() + 1);
  const [ano, setAno] = useState(hoje.getFullYear());
  const [tipoFiltro, setTipoFiltro] = useState('');
  const [pessoaFiltro, setPessoaFiltro] = useState('');
  const [cartaoFiltro, setCartaoFiltro] = useState('');
  const [lista, setLista] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);

  const [cartoes, setCartoes] = useState([]);
  const [contas, setContas] = useState([]);
  const [pessoas, setPessoas] = useState([]);
  const [modulos, setModulos] = useState([]);

  const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

  const carregar = async () => {
    setLoading(true);
    try {
      const params = { mes, ano };
      if (tipoFiltro) params.tipo = tipoFiltro;
      if (pessoaFiltro) params.pessoa_id = pessoaFiltro;
      if (cartaoFiltro) params.cartao_id = cartaoFiltro;

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
  }, [mes, ano, tipoFiltro, pessoaFiltro, cartaoFiltro]);

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
    const tipoInfo = TIPOS.find(item => item.value === tipo);
    if (!tipoInfo) return <span className="badge-blue">{tipo}</span>;
    const Icon = tipoInfo.icon;
    return <span className={`badge-${tipoInfo.tone} gap-1 whitespace-nowrap`}><Icon size={13} />{tipoInfo.short}</span>;
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="page-heading">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">Lançamentos</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {total === 1 ? '1 movimentação registrada' : `${total} movimentações registradas`}
          </p>
        </div>
        <button onClick={() => setModal(true)} className="btn-primary text-sm shadow-md shadow-blue-600/20">
          <Plus size={18} /> Novo Lançamento
        </button>
      </div>

      {/* Barra de Filtros */}
      <div className="card p-4 movement-filters">
        <label><span className="label">Mês</span>
          <select
            className="input"
            value={mes}
            onChange={e => setMes(Number(e.target.value))}
          >
            {meses.map((m, i) => <option key={i} value={i+1}>{m}</option>)}
          </select>
        </label>
        <label><span className="label">Ano</span>
          <select
            className="input"
            value={ano}
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
          {TIPOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
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
      </div>

      {/* Tabela de Lançamentos */}
      {loading ? (
        <div className="flex flex-col items-center justify-center h-64 gap-2">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          <span className="text-gray-400 text-sm">Carregando lista de lançamentos...</span>
        </div>
      ) : lista.length === 0 ? (
        <div className="card text-center py-16">
          <div className="w-14 h-14 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <Plus size={28} />
          </div>
          <h3 className="font-bold text-gray-900 text-lg">Nenhum lançamento no período</h3>
          <p className="text-gray-400 text-sm max-w-sm mx-auto mt-1 mb-5">
            Cadastre compras de cartões, empréstimos ou despesas para organizar o mês.
          </p>
          <button onClick={() => setModal(true)} className="btn-primary text-sm">
            Criar Lançamento Agora
          </button>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="movement-table w-full text-left text-sm">
              <thead className="bg-slate-50 border-b border-gray-100 text-gray-500 uppercase text-[11px] font-bold tracking-wider">
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
              <tbody className="divide-y divide-gray-100">
                {lista.map(item => (
                  <tr key={item.id} className="transition-colors">
                    <td className="px-5 py-3.5">
                      <p className="font-bold text-gray-900">{item.descricao}</p>
                      <div className="mt-1">{getTipoBadge(item.tipo)}</div>
                      {item.observacoes && (
                        <p className="text-xs text-gray-400 truncate max-w-xs">{item.observacoes}</p>
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
                    <td className="px-5 py-3.5 text-gray-700 font-medium text-xs">
                      {item.cartao ? (
                        <span className="inline-flex items-center gap-2 font-semibold">
                          <CardArtwork cartao={item.cartao} compact />{item.cartao.nome}
                        </span>
                      ) : item.conta ? (
                        <span className="inline-flex items-center gap-1.5 text-blue-700 font-semibold"><Building2 size={15} />{item.conta.nome}</span>
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
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-5 py-3.5 text-right font-bold money text-gray-900">
                      {fmt(item.valor_total)}
                    </td>
                    <td className="px-5 py-3.5 text-center">
                      {item.total_parcelas > 1 ? (
                        <span className="bg-blue-50 text-blue-700 font-bold px-2 py-0.5 rounded text-xs">
                          {item.total_parcelas}x
                        </span>
                      ) : (
                        <span className="text-gray-400 text-xs">1x</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-gray-500 text-xs">
                      {new Date(item.data_lancamento + 'T00:00:00').toLocaleDateString('pt-BR')}
                    </td>
                    <td className="px-5 py-3.5 text-center">
                      <button
                        onClick={() => handleCancelar(item.id, item.descricao)}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Cancelar lançamento"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
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
          onSaved={carregar}
        />
      )}
    </div>
  );
}
