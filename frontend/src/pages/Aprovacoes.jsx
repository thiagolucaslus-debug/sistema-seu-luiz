import { useState, useEffect } from 'react';
import { solicitacoes, modulos as modulosApi, mediaUrl } from '../api/client';
import Avatar from '../components/Avatar';
import { getCardBrand } from '../components/cardBrand';
import {
  CheckSquare, Check, X, AlertCircle, ShoppingBag, HandCoins,
  Calendar, CreditCard, Image as ImageIcon, ExternalLink, RefreshCw
} from 'lucide-react';

function fmt(val) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);
}

function formatarDataHora(dataIso) {
  if (!dataIso) return '';
  try {
    const d = new Date(dataIso);
    if (isNaN(d.getTime())) return '';
    return `${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  } catch (e) {
    return '';
  }
}

export default function Aprovacoes() {
  const [filtroStatus, setFiltroStatus] = useState('pendente'); // 'pendente' | 'aprovada' | 'rejeitada'
  const [lista, setLista] = useState([]);
  const [modulos, setModulos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processandoId, setProcessandoId] = useState(null);

  // Modal de Detalhe / Aprovação
  const [modalAprovar, setModalAprovar] = useState(null);
  const [moduloIdEscolhido, setModuloIdEscolhido] = useState('');
  const [modalFoto, setModalFoto] = useState(null);

  const carregar = async () => {
    setLoading(true);
    try {
      const [resSol, resMod] = await Promise.all([
        solicitacoes.listar(filtroStatus),
        modulosApi.listar()
      ]);
      setLista(resSol.data || []);
      setModulos(resMod.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregar();
  }, [filtroStatus]);

  const abrirModalAprovar = (sol) => {
    setModalAprovar(sol);
    setModuloIdEscolhido(modulos.length > 0 ? modulos[0].id.toString() : '');
  };

  const confirmarAprovacao = async () => {
    if (!modalAprovar) return;
    setProcessandoId(modalAprovar.id);
    try {
      await solicitacoes.aprovar(modalAprovar.id, {
        modulo_id: moduloIdEscolhido ? parseInt(moduloIdEscolhido) : null,
        cartao_id: modalAprovar.cartao_id || null,
        ajustar_fatura_inicial: true
      });
      setModalAprovar(null);
      carregar();
    } catch (err) {
      alert('Erro ao aprovar solicitação: ' + (err.response?.data?.detail || err.message));
    } finally {
      setProcessandoId(null);
    }
  };

  const handleRejeitar = async (sol) => {
    const motivo = window.prompt(`Motivo da recusa para ${sol.pessoa_nome}:`, 'Compra não reconhecida ou valor incorreto');
    if (motivo === null) return;
    setProcessandoId(sol.id);
    try {
      await solicitacoes.rejeitar(sol.id, motivo);
      carregar();
    } catch (err) {
      alert('Erro ao rejeitar: ' + (err.response?.data?.detail || err.message));
    } finally {
      setProcessandoId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="page-heading">
        <div>
          <div className="flex items-center gap-2">
            <CheckSquare className="text-blue-500" size={28} />
            <h1 className="text-2xl sm:text-3xl font-extrabold text-ink tracking-tight">Aprovações de Compras</h1>
          </div>
          <p className="text-slate-400 text-sm mt-0.5">
            Lançamentos enviados pelas pessoas autorizadas através do link de celular
          </p>
        </div>

        <button
          onClick={carregar}
          className="p-2.5 rounded-xl border border-slate-700/60 text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
          title="Recarregar lista"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Tabs de Filtro de Status */}
      <div className="flex items-center gap-2 border-b border-slate-700/60 pb-3">
        <button
          onClick={() => setFiltroStatus('pendente')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${
            filtroStatus === 'pendente'
              ? 'bg-amber-500 text-slate-950 shadow'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
          }`}
        >
          <span>Pendentes</span>
        </button>

        <button
          onClick={() => setFiltroStatus('aprovada')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${
            filtroStatus === 'aprovada'
              ? 'bg-emerald-600 text-white shadow'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
          }`}
        >
          <span>Aprovadas</span>
        </button>

        <button
          onClick={() => setFiltroStatus('rejeitada')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${
            filtroStatus === 'rejeitada'
              ? 'bg-rose-600 text-white shadow'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
          }`}
        >
          <span>Rejeitadas</span>
        </button>
      </div>

      {/* Lista de Solicitações */}
      {loading ? (
        <div className="card text-center py-16 text-slate-400 text-sm">Carregando solicitações...</div>
      ) : lista.length === 0 ? (
        <div className="card text-center py-16">
          <CheckSquare size={36} className="text-slate-500 mx-auto mb-3" />
          <h3 className="text-lg font-bold text-ink">Nenhuma solicitação {filtroStatus}</h3>
          <p className="text-xs text-slate-400 mt-1">
            {filtroStatus === 'pendente'
              ? 'Tudo em dia! Nenhuma compra pendente de aprovação.'
              : `Não há compras registradas com status "${filtroStatus}".`}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {lista.map((sol) => {
            const isCompraCartao = sol.tipo_solicitacao === 'compra_cartao';

            return (
              <div
                key={sol.id}
                className="card p-5 border border-slate-700/50 flex flex-col justify-between hover:border-slate-600 transition-all shadow-sm"
              >
                <div className="space-y-4">
                  {/* Topo do Card */}
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3.5 min-w-0">
                      <Avatar
                        nome={sol.pessoa_nome}
                        foto={mediaUrl(sol.pessoa_foto || sol.foto_path)}
                        cor={sol.pessoa_cor}
                        className="w-12 h-12 rounded-2xl shrink-0 shadow-sm"
                      />
                      <div className="min-w-0">
                        <h4 className="font-extrabold text-ink text-base truncate">{sol.pessoa_nome}</h4>
                        <span className="text-[11px] text-slate-400">
                          {formatarDataHora(sol.created_at || sol.criado_em) || 'Hoje'}
                        </span>
                      </div>
                    </div>

                    {/* Tag do Tipo */}
                    <span className={`px-2.5 py-1 text-xs font-bold rounded-lg border ${
                      isCompraCartao
                        ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                        : 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                    }`}>
                      {isCompraCartao ? 'Cartão' : 'Comprou pra você'}
                    </span>
                  </div>

                  {/* Informações da Compra */}
                  <div className="p-3.5 rounded-xl space-y-2 text-xs" style={{ backgroundColor: 'var(--raised)' }}>
                    <div className="flex justify-between items-start">
                      <span className="text-slate-400">Descrição:</span>
                      <strong className="text-ink text-sm text-right max-w-[200px] truncate">{sol.descricao}</strong>
                    </div>

                    <div className="flex justify-between items-center">
                      <span className="text-slate-400">Valor Total:</span>
                      <strong className="text-base font-black text-ink">{fmt(sol.valor)}</strong>
                    </div>

                    {isCompraCartao && (
                      <>
                        <div className="flex justify-between items-center text-slate-300">
                          <span className="text-slate-400">Cartão Usado:</span>
                          <span className="font-semibold text-ink inline-flex items-center gap-1.5">
                            {sol.cartao_nome && (
                              <span
                                className="w-2.5 h-2.5 rounded-full shrink-0"
                                style={{ backgroundColor: getCardBrand(sol.cartao_nome, sol.cartao_cor).color }}
                              />
                            )}
                            <span>{sol.cartao_nome || 'Não especificado'}</span>
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-slate-300">
                          <span className="text-slate-400">Parcelamento:</span>
                          <span className="font-semibold text-ink">
                            {sol.total_parcelas > 1 ? `${sol.total_parcelas}x parcelas` : 'À vista (1x)'}
                          </span>
                        </div>
                      </>
                    )}

                    {sol.data_compra && (
                      <div className="flex justify-between items-center text-slate-300">
                        <span className="text-slate-400">Data da Compra:</span>
                        <span>{new Date(sol.data_compra + 'T00:00:00').toLocaleDateString('pt-BR')}</span>
                      </div>
                    )}

                    {sol.observacoes && (
                      <div className="border-t border-slate-700/50 pt-2 text-[11px] text-slate-400 italic">
                        "{sol.observacoes}"
                      </div>
                    )}

                    {sol.comprovante_url && (
                      <div className="pt-1">
                        <button
                          type="button"
                          onClick={() => setModalFoto(mediaUrl(sol.comprovante_url))}
                          className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 font-bold"
                        >
                          <ImageIcon size={14} />
                          <span>Ver Comprovante Anexado</span>
                        </button>
                      </div>
                    )}

                    {sol.status === 'rejeitada' && sol.motivo_rejeicao && (
                      <div className="p-2 rounded-lg bg-rose-500/10 text-rose-400 text-xs">
                        <strong>Motivo da recusa:</strong> {sol.motivo_rejeicao}
                      </div>
                    )}
                  </div>
                </div>

                {/* Ações para Pendentes */}
                {filtroStatus === 'pendente' && (
                  <div className="grid grid-cols-2 gap-2 pt-4 border-t border-slate-700/40 mt-4">
                    <button
                      onClick={() => handleRejeitar(sol)}
                      disabled={processandoId === sol.id}
                      className="btn-secondary text-xs py-2 text-rose-400 hover:bg-rose-950/20 flex items-center justify-center gap-1.5"
                    >
                      <X size={15} />
                      <span>Recusar</span>
                    </button>

                    <button
                      onClick={() => abrirModalAprovar(sol)}
                      disabled={processandoId === sol.id}
                      className="btn-primary text-xs py-2 bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center gap-1.5 shadow-md shadow-emerald-600/20"
                    >
                      <Check size={15} />
                      <span>Aprovar</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de Confirmação de Aprovação (com seleção de Módulo / Categoria) */}
      {modalAprovar && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="card rounded-3xl shadow-2xl w-full max-w-md p-6 border border-slate-700/60">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Check className="text-emerald-400" size={22} />
                <h3 className="font-bold text-ink text-lg">Aprovar Lançamento</h3>
              </div>
              <button onClick={() => setModalAprovar(null)} className="p-1 text-slate-400 hover:text-ink">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4 text-sm">
              <div className="flex items-center gap-3.5 p-3.5 rounded-xl border border-slate-700/50" style={{ backgroundColor: 'var(--raised)' }}>
                <Avatar
                  nome={modalAprovar.pessoa_nome}
                  foto={mediaUrl(modalAprovar.pessoa_foto || modalAprovar.foto_path)}
                  cor={modalAprovar.pessoa_cor}
                  className="w-12 h-12 rounded-xl shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className="font-extrabold text-ink text-base">{modalAprovar.descricao}</p>
                  <p className="text-xs text-slate-400">Pessoa: <strong className="text-ink">{modalAprovar.pessoa_nome}</strong></p>
                  <p className="text-lg font-black text-emerald-400">{fmt(modalAprovar.valor)}</p>
                </div>
              </div>

              <div>
                <label className="label text-ink font-semibold">Classificar em qual Módulo?</label>
                <select
                  className="input text-white bg-slate-900"
                  value={moduloIdEscolhido}
                  onChange={e => setModuloIdEscolhido(e.target.value)}
                >
                  <option value="" className="bg-slate-900 text-white">Sem módulo específico</option>
                  {modulos.map(m => (
                    <option key={m.id} value={m.id} className="bg-slate-900 text-white">
                      {m.nome}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-400 mt-1">
                  Ao aprovar, o valor será computado automaticamente na fatura e no extrato da pessoa.
                </p>
              </div>

              <div className="flex gap-2 justify-end pt-3 border-t border-slate-700/50">
                <button type="button" onClick={() => setModalAprovar(null)} className="btn-secondary">Cancelar</button>
                <button
                  type="button"
                  onClick={confirmarAprovacao}
                  disabled={processandoId === modalAprovar.id}
                  className="btn-primary bg-emerald-600 hover:bg-emerald-500 text-white"
                >
                  {processandoId === modalAprovar.id ? 'Aprovando...' : 'Confirmar e Lançar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal para Visualizar Comprovante em Tamanho Real */}
      {modalFoto && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setModalFoto(null)}>
          <div className="max-w-2xl max-h-[85vh] p-2 bg-slate-900 rounded-2xl border border-slate-700 relative" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setModalFoto(null)}
              className="absolute top-4 right-4 p-2 rounded-full bg-black/60 text-white hover:bg-black"
            >
              <X size={20} />
            </button>
            <img src={modalFoto} alt="Comprovante" className="max-w-full max-h-[80vh] object-contain rounded-xl" />
          </div>
        </div>
      )}
    </div>
  );
}
