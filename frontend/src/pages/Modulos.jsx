import { useState, useEffect } from 'react';
import { modulos as modulosApi } from '../api/client';
import { Grid3X3, Plus, ChevronDown, ChevronUp, X, Archive, Sparkles } from 'lucide-react';
import { getModuleIcon, ICONES, EMOJIS_SUGERIDOS } from '../components/ModuleIcon';

function fmt(val) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);
}

function ModalNovoModulo({ onClose, onSaved }) {
  const [form, setForm] = useState({
    nome: '',
    icone: 'home',
    cor: '#3B82F6'
  });
  const [customEmoji, setCustomEmoji] = useState('');
  const [tabIcones, setTabIcones] = useState('emojis'); // 'emojis' | 'ilustrados'
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await modulosApi.criar(form);
      onSaved();
      onClose();
    } catch (err) {
      alert('Erro ao criar módulo: ' + (err.response?.data?.detail || err.message));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSelectEmoji = (emoji) => {
    setForm(prev => ({ ...prev, icone: `emoji:${emoji}` }));
  };

  const handleCustomEmojiChange = (val) => {
    setCustomEmoji(val);
    if (val.trim()) {
      setForm(prev => ({ ...prev, icone: `emoji:${val.trim()}` }));
    }
  };

  const IconeSelecionado = getModuleIcon(form.icone, form.nome);

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="card rounded-3xl shadow-2xl w-full max-w-lg p-6 border border-slate-700/60 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Sparkles className="text-blue-500" size={20} />
            <h2 className="text-lg font-bold text-ink">Novo Módulo / Categoria</h2>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-ink rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Preview do ícone ilustrado / emoji */}
          <div className="flex items-center gap-4 p-4 rounded-2xl border border-slate-700/40" style={{ backgroundColor: 'var(--raised)' }}>
            <div
              className="w-16 h-16 rounded-2xl overflow-hidden shadow-md shrink-0 flex items-center justify-center border border-white/10"
              style={{ backgroundColor: 'var(--surface)' }}
            >
              <IconeSelecionado size={52} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-extrabold text-ink text-base truncate">{form.nome || 'Nome do Módulo'}</p>
              <p className="text-xs text-slate-400 mt-0.5">Prévia em tempo real ao selecionar</p>
            </div>
          </div>

          <div>
            <label className="label text-ink font-semibold">Nome do Módulo</label>
            <input
              type="text"
              className="input font-medium"
              placeholder="Ex: Gado / Roça, Reforma, Saúde, Mercado..."
              value={form.nome}
              onChange={e => setForm({ ...form, nome: e.target.value })}
              required
            />
          </div>

          {/* Abas de Escolha do Ícone: Emojis Livres ou Ilustrados */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="label text-ink font-semibold m-0">Escolha o Ícone</label>
              <div className="flex rounded-lg p-0.5 border border-slate-700 text-xs" style={{ backgroundColor: 'var(--raised)' }}>
                <button
                  type="button"
                  onClick={() => setTabIcones('emojis')}
                  className={`px-2.5 py-1 rounded-md font-bold transition-all ${
                    tabIcones === 'emojis' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Emojis (Boi, Trator...)
                </button>
                <button
                  type="button"
                  onClick={() => setTabIcones('ilustrados')}
                  className={`px-2.5 py-1 rounded-md font-bold transition-all ${
                    tabIcones === 'ilustrados' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Ilustrados
                </button>
              </div>
            </div>

            {tabIcones === 'emojis' ? (
              <div className="space-y-3">
                {/* Campo para digitar qualquer emoji */}
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    className="input text-sm py-2"
                    placeholder="Cole ou digite qualquer emoji (ex: 🐂, 🐎, 🚜)"
                    value={customEmoji}
                    onChange={e => handleCustomEmojiChange(e.target.value)}
                  />
                </div>

                {/* Grid de Emojis do campo e do dia a dia */}
                <div className="grid grid-cols-6 sm:grid-cols-8 gap-2 p-3 rounded-2xl border border-slate-700/40 max-h-44 overflow-y-auto" style={{ backgroundColor: 'var(--raised)' }}>
                  {EMOJIS_SUGERIDOS.map(({ emoji, label }) => {
                    const isSelected = form.icone === `emoji:${emoji}` || form.icone === emoji;
                    return (
                      <button
                        key={emoji}
                        type="button"
                        title={label}
                        onClick={() => handleSelectEmoji(emoji)}
                        className={`flex flex-col items-center justify-center p-2 rounded-xl transition-all ${
                          isSelected
                            ? 'bg-blue-600/30 border-2 border-blue-500 scale-105 shadow'
                            : 'hover:bg-slate-700/40 border border-transparent'
                        }`}
                      >
                        <span className="text-2xl leading-none">{emoji}</span>
                        <span className="text-[9px] text-slate-400 truncate max-w-[42px] mt-1">{label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-5 gap-2 p-3 rounded-2xl border border-slate-700/40" style={{ backgroundColor: 'var(--raised)' }}>
                {ICONES.map(({ key, Comp, label }) => (
                  <button
                    key={key}
                    type="button"
                    title={label}
                    onClick={() => setForm({ ...form, icone: key })}
                    className={`flex flex-col items-center gap-1.5 p-2 rounded-xl border-2 transition-all ${
                      form.icone === key
                        ? 'border-blue-500 bg-blue-600/20 shadow-md'
                        : 'border-transparent hover:border-slate-600'
                    }`}
                  >
                    <Comp size={36} />
                    <span className="text-[10px] text-slate-300 leading-tight text-center font-medium">{label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="label text-ink font-semibold">Cor de Destaque</label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                className="w-12 h-10 rounded-xl cursor-pointer border border-slate-600 bg-transparent"
                value={form.cor}
                onChange={e => setForm({ ...form, cor: e.target.value })}
              />
              <span className="text-xs text-slate-400 font-mono uppercase">{form.cor}</span>
            </div>
          </div>

          <div className="flex gap-2 justify-end pt-3 border-t border-slate-800">
            <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
            <button type="submit" disabled={submitting} className="btn-primary">
              {submitting ? 'Salvando...' : 'Salvar Módulo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CardModulo({ modulo, mes, ano, onRefresh }) {
  const [expanded, setExpanded] = useState(false);
  const [gastos, setGastos] = useState(null);
  const [loadingGastos, setLoadingGastos] = useState(false);

  const IconeSVG = getModuleIcon(modulo.icone, modulo.nome);

  const carregarGastos = async () => {
    setLoadingGastos(true);
    try {
      const res = await modulosApi.gastos(modulo.id, mes, ano);
      setGastos(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingGastos(false);
    }
  };

  const handleToggle = () => {
    if (!expanded) carregarGastos();
    setExpanded(!expanded);
  };

  useEffect(() => {
    if (expanded) carregarGastos();
  }, [mes, ano]);

  async function arquivar() {
    if (!window.confirm(`Remover o módulo “${modulo.nome}” da lista ativa?`)) return;
    try {
      await modulosApi.deletar(modulo.id);
      onRefresh();
    } catch (erro) {
      alert(erro.response?.data?.detail || 'Não foi possível remover o módulo.');
    }
  }

  return (
    <div className="card p-0 overflow-hidden shadow-sm hover:shadow-md transition-shadow">
      <button
        type="button"
        aria-expanded={expanded}
        className="w-full text-left p-5 flex flex-wrap items-center justify-between gap-4 hover-surface transition-colors"
        onClick={handleToggle}
      >
        <div className="flex items-center gap-4">
          <div className="module-icon" style={{ '--module-color': modulo.cor }}>
            <IconeSVG size={40} />
          </div>
          <div>
            <h3 className="font-extrabold text-ink text-lg">{modulo.nome}</h3>
          </div>
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-5">
          <div className="text-right">
            <span className="text-xs text-slate-400 font-medium block">Total no Período</span>
            <span className="text-lg font-black text-ink">
              {fmt(modulo.total_mes_atual)}
            </span>
          </div>
          <div className="p-2 text-slate-400 hover:text-ink">
            {expanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-700/50 p-4" style={{ backgroundColor: 'var(--raised)' }}>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h4 className="text-xs font-bold text-slate-300">Lançamentos de {mes}/{ano}</h4>
            <button type="button" onClick={arquivar} className="btn-secondary text-xs">
              <Archive size={15} /> Remover módulo
            </button>
          </div>

          {loadingGastos ? (
            <div className="p-6 text-center text-slate-400 text-xs">Carregando gastos...</div>
          ) : gastos && gastos.lancamentos.length > 0 ? (
            <div className="space-y-1.5">
              {gastos.lancamentos.map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-3 rounded-xl border border-slate-700/50 text-xs"
                  style={{ backgroundColor: 'var(--surface)' }}
                >
                  <div>
                    <span className="font-bold text-ink">{item.descricao}</span>
                    <p className="text-slate-400 text-[11px] mt-0.5">
                      {new Date(item.data_lancamento + 'T00:00:00').toLocaleDateString('pt-BR')} • {item.pessoa} • {item.cartao || item.conta || 'Cartão/Conta'} • {item.parcela}
                    </p>
                  </div>
                  <span className="font-black text-ink text-sm">{fmt(item.valor)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400 text-center py-4">Nenhum gasto registrado neste módulo para o mês selecionado.</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function Modulos() {
  const hoje = new Date();
  const [mes, setMes] = useState(hoje.getMonth() + 1);
  const [ano, setAno] = useState(hoje.getFullYear());
  const [lista, setLista] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalNovo, setModalNovo] = useState(false);

  const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

  const carregar = async () => {
    setLoading(true);
    try {
      const res = await modulosApi.listar({ mes, ano });
      setLista(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregar();
  }, [mes, ano]);

  return (
    <div className="space-y-6">
      <div className="page-heading">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-ink tracking-tight">Módulos Personalizados</h1>
          <p className="text-slate-400 text-sm mt-0.5">Organize seus gastos em categorias próprias (Gado, Roça, Reforma...)</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 p-1 rounded-xl border border-slate-700/60" style={{ backgroundColor: 'var(--surface)' }}>
            <select
              className="text-xs font-semibold bg-transparent px-2 py-1 outline-none cursor-pointer text-ink"
              value={mes}
              onChange={e => setMes(Number(e.target.value))}
            >
              {meses.map((m, i) => <option key={i} value={i+1} className="bg-slate-900 text-white">{m}</option>)}
            </select>
            <select
              className="text-xs font-semibold bg-transparent px-2 py-1 outline-none cursor-pointer text-ink"
              value={ano}
              onChange={e => setAno(Number(e.target.value))}
            >
              {Array.from({ length: 6 }, (_, i) => hoje.getFullYear() - 2 + i).map(a => <option key={a} value={a} className="bg-slate-900 text-white">{a}</option>)}
            </select>
          </div>
          <button onClick={() => setModalNovo(true)} className="btn-primary text-sm shadow-md shadow-blue-600/20">
            <Plus size={18} /> Novo Módulo
          </button>
        </div>
      </div>

      {loading && lista.length === 0 ? (
        <div className="flex items-center justify-center h-64 text-slate-400 text-sm">Carregando módulos...</div>
      ) : lista.length === 0 ? (
        <div className="card text-center py-16">
          <div className="w-14 h-14 bg-amber-500/10 text-amber-500 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <Grid3X3 size={28} />
          </div>
          <h3 className="font-bold text-ink text-lg">Nenhum módulo cadastrado</h3>
          <p className="text-slate-400 text-sm max-w-sm mx-auto mt-1 mb-5">
            Crie um módulo para agrupar seus lançamentos por finalidade (ex: 🐂 Gado / Boi, 🚜 Fazenda, Casa).
          </p>
          <button onClick={() => setModalNovo(true)} className="btn-primary text-sm">
            Cadastrar Primeiro Módulo
          </button>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2 items-start">
          {lista.map(m => (
            <CardModulo key={m.id} modulo={m} mes={mes} ano={ano} onRefresh={carregar} />
          ))}
        </div>
      )}

      {modalNovo && (
        <ModalNovoModulo onClose={() => setModalNovo(false)} onSaved={carregar} />
      )}
    </div>
  );
}
