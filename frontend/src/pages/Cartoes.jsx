import { useState, useEffect } from 'react';
import { cartoes as cartoesApi, contas as contasApi, lancamentos as lancamentosApi } from '../api/client';
import {
  CreditCard, Plus, CheckCircle, Check, Palette, Edit2, RotateCcw,
  Calendar, X, Trash2, ArrowLeft, ArrowUpRight, DollarSign, Eraser
} from 'lucide-react';
import CardArtwork from '../components/CardArtwork';
import {
  getCardBrand,
  CARD_COLOR_PALETTE,
  suggestIssuerColor,
  normalizeHexColor
} from '../components/cardBrand';
import Avatar from '../components/Avatar';

function fmt(val) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);
}

function SeletorPaletaCorCartao({ form, onChangeCor }) {
  const corAtual = normalizeHexColor(form.cor) || '#2563eb';
  const corEmissor = suggestIssuerColor(form.nome);

  return (
    <div className="space-y-3 p-3.5 rounded-2xl bg-[var(--raised)] border border-[var(--line)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="label mb-0 flex items-center gap-2">
          <Palette size={14} className="text-blue-500" />
          <span>Cor do Cartão e Indicador</span>
        </label>
        <div className="flex items-center gap-1.5">
          {corEmissor && corEmissor.toLowerCase() !== corAtual.toLowerCase() && (
            <button
              type="button"
              onClick={() => onChangeCor(corEmissor)}
              className="px-2 py-1 rounded-full text-[11px] font-semibold bg-[var(--surface)] border border-[var(--line)] text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
              title="Restaurar a cor oficial sugerida para este banco"
            >
              Cor do banco
            </button>
          )}
          <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-[var(--surface)] border border-[var(--line)] text-[var(--ink)]">
            <span
              className="w-3.5 h-3.5 rounded-full shrink-0 ring-2 ring-white/30 shadow-sm"
              style={{ backgroundColor: corAtual }}
            />
            {corAtual.toUpperCase()}
          </span>
        </div>
      </div>

      {/* Pré-visualização ao vivo do Cartão com a exata cor escolhida */}
      <div className="w-52 max-w-full mx-auto rounded-xl overflow-hidden shadow-lg transition-all">
        <CardArtwork
          cartao={{
            nome: form.nome || 'Meu Cartão',
            bandeira: form.bandeira || 'Visa',
            cor: corAtual,
          }}
        />
      </div>

      {/* Grade de cores rápidas da paleta */}
      <div>
        <span className="text-[11px] text-[var(--muted)] font-medium block mb-1.5">
          Toque em uma cor da paleta ou escolha livremente abaixo:
        </span>
        <div className="grid grid-cols-8 gap-2">
          {CARD_COLOR_PALETTE.map((swatch) => {
            const ativo = corAtual.toLowerCase() === swatch.hex.toLowerCase();
            return (
              <button
                key={swatch.hex}
                type="button"
                onClick={() => onChangeCor(swatch.hex)}
                title={`${swatch.label} (${swatch.hex.toUpperCase()})`}
                aria-label={`Escolher cor ${swatch.label}`}
                aria-pressed={ativo}
                className={`w-full aspect-square rounded-xl flex items-center justify-center transition-transform hover:scale-110 focus:outline-none ${
                  ativo ? 'ring-2 ring-offset-2 ring-blue-500 scale-105 shadow-md' : 'border border-white/20'
                }`}
                style={{ backgroundColor: swatch.hex }}
              >
                {ativo && <Check size={14} className="text-white drop-shadow" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Seletor livre (<input type="color">) sincronizado com o indicador e com o cartão */}
      <label className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-[var(--surface)] border border-[var(--line)] cursor-pointer hover-surface transition-colors">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className="w-7 h-7 rounded-lg shrink-0 border border-white/30 shadow-inner"
            style={{ backgroundColor: corAtual }}
          />
          <div className="min-w-0">
            <span className="text-xs font-bold text-[var(--ink)] block">Paleta de Cores Completa</span>
            <span className="text-[11px] text-[var(--muted)] block truncate">
              Clique aqui para ajustar qualquer tom personalizado
            </span>
          </div>
        </div>
        <input
          type="color"
          className="w-10 h-9 rounded-lg cursor-pointer border-0 bg-transparent shrink-0"
          value={corAtual}
          onChange={(e) => onChangeCor(e.target.value)}
        />
      </label>
    </div>
  );
}

function ModalCartaoForm({ cartaoInicial = null, onClose, onSaved }) {
  const isEdit = Boolean(cartaoInicial);
  const corInicial = cartaoInicial
    ? getCardBrand(cartaoInicial.nome, cartaoInicial.cor).color
    : '#2563eb';

  const [form, setForm] = useState({
    nome: cartaoInicial?.nome || '',
    bandeira: cartaoInicial?.bandeira || 'Visa',
    dia_fechamento: cartaoInicial?.dia_fechamento ?? 20,
    dia_vencimento: cartaoInicial?.dia_vencimento ?? 27,
    limite: cartaoInicial?.limite ? String(cartaoInicial.limite) : '',
    cor: corInicial,
  });
  const [corEscolhidaManualmente, setCorEscolhidaManualmente] = useState(isEdit);
  const [submitting, setSubmitting] = useState(false);

  const handleNomeChange = (novoNome) => {
    setForm((prev) => {
      let proximaCor = prev.cor;
      if (!corEscolhidaManualmente) {
        const sugerida = suggestIssuerColor(novoNome);
        if (sugerida) proximaCor = sugerida;
      }
      return { ...prev, nome: novoNome, cor: proximaCor };
    });
  };

  const handleCorChange = (novaCor) => {
    setCorEscolhidaManualmente(true);
    setForm((prev) => ({ ...prev, cor: novaCor }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload = {
        nome: form.nome,
        bandeira: form.bandeira,
        dia_fechamento: parseInt(form.dia_fechamento, 10),
        dia_vencimento: parseInt(form.dia_vencimento, 10),
        limite: parseFloat(form.limite) || 0.0,
        cor: normalizeHexColor(form.cor) || '#2563eb',
      };
      if (isEdit) {
        await cartoesApi.atualizar(cartaoInicial.id, payload);
      } else {
        await cartoesApi.criar(payload);
      }
      onSaved();
      onClose();
    } catch (err) {
      alert(
        `Erro ao ${isEdit ? 'atualizar' : 'cadastrar'} cartão: ` +
          (err.response?.data?.detail || err.message)
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[var(--surface)] text-[var(--ink)] rounded-3xl shadow-2xl w-full max-w-md max-h-[92dvh] overflow-y-auto p-6 border border-[var(--line)]">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-[var(--ink)]">
            {isEdit ? `Editar Cartão — ${cartaoInicial.nome}` : 'Cadastrar Novo Cartão'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-[var(--muted)] hover:text-[var(--ink)] rounded-lg"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Nome do Cartão</label>
            <input
              type="text"
              className="input"
              placeholder="Ex.: Itaú 7467, Atacadão, Nubank ou Coop"
              value={form.nome}
              onChange={(e) => handleNomeChange(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Bandeira</label>
              <select
                className="input font-medium"
                value={form.bandeira}
                onChange={(e) => setForm({ ...form, bandeira: e.target.value })}
              >
                <option value="Visa">Visa</option>
                <option value="Mastercard">Mastercard</option>
                <option value="Elo">Elo</option>
                <option value="American Express">Amex</option>
                <option value="Hipercard">Hipercard</option>
                <option value="Outro">Outro</option>
              </select>
            </div>
            <div>
              <label className="label">Limite Total (R$)</label>
              <input
                type="number"
                step="0.01"
                className="input"
                placeholder="0,00"
                value={form.limite}
                onChange={(e) => setForm({ ...form, limite: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Dia de Fechamento</label>
              <input
                type="number"
                min="1"
                max="31"
                className="input"
                value={form.dia_fechamento}
                onChange={(e) => setForm({ ...form, dia_fechamento: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="label">Dia de Vencimento</label>
              <input
                type="number"
                min="1"
                max="31"
                className="input"
                value={form.dia_vencimento}
                onChange={(e) => setForm({ ...form, dia_vencimento: e.target.value })}
                required
              />
            </div>
          </div>

          <SeletorPaletaCorCartao form={form} onChangeCor={handleCorChange} />

          <div className="flex gap-2 justify-end pt-3 border-t border-[var(--line)]">
            <button type="button" onClick={onClose} className="btn-secondary">
              Cancelar
            </button>
            <button type="submit" disabled={submitting} className="btn-primary">
              {submitting ? 'Salvando...' : isEdit ? 'Salvar Alterações' : 'Salvar Cartão'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ModalPagarFatura({ cartao, fatura, contas, onClose, onSaved }) {
  const [form, setForm] = useState({
    valor: fatura.total,
    data: new Date().toISOString().split('T')[0],
    conta_id: contas[0]?.id || ''
  });
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.conta_id) {
      alert('Por favor, selecione uma conta bancária para debitar o pagamento.');
      return;
    }
    setSubmitting(true);
    try {
      await cartoesApi.pagarFatura(cartao.id, {
        mes: fatura.mes,
        ano: fatura.ano,
        valor: parseFloat(form.valor),
        data: form.data,
        conta_id: parseInt(form.conta_id)
      });
      onSaved();
      onClose();
    } catch (err) {
      alert('Erro ao pagar fatura: ' + (err.response?.data?.detail || err.message));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[var(--surface)] text-[var(--ink)] rounded-3xl shadow-2xl w-full max-w-md p-6 border border-[var(--line)]">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-[var(--ink)]">Pagar Fatura do Cartão</h2>
          <button onClick={onClose} className="p-1 text-[var(--muted)] hover:text-[var(--ink)] rounded-lg"><X size={20} /></button>
        </div>

        <div className="bg-[var(--accent-tint)] p-4 rounded-2xl mb-4 border border-blue-500/20">
          <p className="text-xs text-[var(--muted)]">Cartão / Fatura</p>
          <p className="font-extrabold text-[var(--ink)] text-base">{cartao.nome} • {fatura.nome_mes}</p>
          <p className="text-2xl font-black text-blue-500 mt-1">{fmt(fatura.total)}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Valor Pago (R$)</label>
            <input
              type="number"
              step="0.01"
              className="input font-bold"
              value={form.valor}
              onChange={e => setForm({ ...form, valor: e.target.value })}
              required
            />
          </div>

          <div>
            <label className="label">Data do Pagamento</label>
            <input
              type="date"
              className="input"
              value={form.data}
              onChange={e => setForm({ ...form, data: e.target.value })}
              required
            />
          </div>

          <div>
            <label className="label">Debitar de qual Conta?</label>
            <select
              className="input font-medium"
              value={form.conta_id}
              onChange={e => setForm({ ...form, conta_id: e.target.value })}
              required
            >
              <option value="">Selecione a conta...</option>
              {contas.map(c => (
                <option key={c.id} value={c.id}>{c.nome} ({fmt(c.saldo_atual)})</option>
              ))}
            </select>
          </div>

          <div className="flex gap-2 justify-end pt-3 border-t border-[var(--line)]">
            <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
            <button type="submit" disabled={submitting} className="btn-success">
              {submitting ? 'Confirmando...' : 'Confirmar Pagamento'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ModalExcluirItemFatura({ item, nomeMes, onClose, onSaved }) {
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
          <h3 className="font-extrabold text-base text-[var(--ink)]">Excluir Lançamento da Fatura</h3>
          <button type="button" onClick={onClose} className="p-1 text-[var(--muted)] hover:text-[var(--ink)]">
            <X size={20} />
          </button>
        </div>

        <div className="p-3.5 rounded-2xl bg-[var(--raised)] border border-[var(--line)] text-xs space-y-1">
          <p className="font-bold text-sm text-[var(--ink)]">{item.descricao}</p>
          <p className="text-[var(--muted)]">
            Responsável: <strong>{item.pessoa || 'Você'}</strong> • Parcela: <strong>{item.parcela}</strong> • Valor em {nomeMes}: <strong>{fmt(item.valor)}</strong>
          </p>
        </div>

        <div className="space-y-2">
          {temMultiplasParcelas && item.numero && (
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
                  : 'Confirmar Exclusão desta Compra'}
            </span>
          </button>

          <button type="button" onClick={onClose} className="btn-secondary w-full py-2 text-xs">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// PÁGINA COMPLETA EXCLUSIVA DO CARTÃO
// ==========================================
function DetalheCartao({ cartao, contas, onVoltar, onEditar, onRefresh }) {
  const [faturasData, setFaturasData] = useState(null);
  const [loadingFaturas, setLoadingFaturas] = useState(true);
  const [faturaIdx, setFaturaIdx] = useState(0);
  const [modalPagar, setModalPagar] = useState(null);
  const [itemExcluindo, setItemExcluindo] = useState(null);
  const brand = getCardBrand(cartao.nome, cartao.cor);

  const carregarFaturas = async () => {
    setLoadingFaturas(true);
    try {
      const res = await cartoesApi.faturas(cartao.id, 6, 6);
      setFaturasData(res.data);
      const idxAtual = res.data.faturas.findIndex(f => f.is_atual);
      setFaturaIdx(idxAtual >= 0 ? idxAtual : res.data.faturas.length - 1);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingFaturas(false);
    }
  };

  useEffect(() => {
    carregarFaturas();
  }, [cartao.id]);

  const faturaSelecionada = faturasData?.faturas?.[faturaIdx];
  const itensFatura = faturaSelecionada?.lancamentos || faturaSelecionada?.itens || [];
  const limiteDisponivel = cartao.limite ? Math.max(0, cartao.limite - (cartao.fatura_mes_atual?.total || 0)) : null;
  const percUsado = cartao.limite > 0 ? Math.min(100, Math.round(((cartao.fatura_mes_atual?.total || 0) / cartao.limite) * 100)) : 0;

  return (
    <div className="space-y-6">
      {/* Botão Voltar e Ações */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          onClick={onVoltar}
          className="btn-secondary text-sm flex items-center gap-2"
        >
          <ArrowLeft size={16} /> Voltar para todos os cartões
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onEditar(cartao)}
            className="btn-secondary text-xs py-2 px-3 flex items-center gap-1.5"
          >
            <Palette size={15} style={{ color: brand.color }} />
            <span>Mudar Cor / Editar Cartão</span>
          </button>
          <span className="badge-blue text-xs py-1 px-3">
            {cartao.bandeira}
          </span>
        </div>
      </div>

      {/* Banner de Destaque do Cartão */}
      <div className="card p-6 bg-gradient-to-br from-[var(--surface)] to-[var(--raised)] border border-[var(--line)]">
        <div className="flex flex-col md:flex-row items-center gap-6">
          <div className="w-64 max-w-full shrink-0 shadow-2xl rounded-2xl overflow-hidden hover:scale-105 transition-transform duration-300">
            <CardArtwork cartao={cartao} />
          </div>

          <div className="flex-1 w-full space-y-4">
            <div>
              <div className="flex items-center gap-2.5">
                <span
                  className="w-4 h-4 rounded-full shrink-0 ring-2 ring-white/25 shadow"
                  style={{ backgroundColor: brand.color }}
                  title={`Cor do cartão: ${brand.color}`}
                />
                <h2 className="text-2xl sm:text-3xl font-black text-[var(--ink)] tracking-tight">{cartao.nome}</h2>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--muted)] mt-1">
                <span className="inline-flex items-center gap-1 font-medium">
                  <Calendar size={14} className="text-blue-500" /> Fecha todo dia <strong>{cartao.dia_fechamento}</strong>
                </span>
                <span>•</span>
                <span className="font-medium">Vence todo dia <strong>{cartao.dia_vencimento}</strong></span>
              </div>
            </div>

            {/* Métricas de Limite */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
              <div className="p-3 rounded-xl bg-[var(--surface)] border border-[var(--line)]">
                <span className="text-xs text-[var(--muted)] font-medium block">Fatura Atual</span>
                <span className="text-xl font-black text-rose-500">{fmt(cartao.fatura_mes_atual?.total)}</span>
              </div>

              {cartao.limite > 0 && (
                <>
                  <div className="p-3 rounded-xl bg-[var(--surface)] border border-[var(--line)]">
                    <span className="text-xs text-[var(--muted)] font-medium block">Limite Total</span>
                    <span className="text-xl font-black text-[var(--ink)]">{fmt(cartao.limite)}</span>
                  </div>
                  <div className="p-3 rounded-xl bg-[var(--surface)] border border-[var(--line)]">
                    <span className="text-xs text-[var(--muted)] font-medium block">Limite Disponível</span>
                    <span className="text-xl font-black text-emerald-500">{fmt(limiteDisponivel)}</span>
                  </div>
                </>
              )}
            </div>

            {cartao.limite > 0 && (
              <div>
                <div className="flex justify-between text-xs text-[var(--muted)] mb-1">
                  <span>Comprometimento do Limite</span>
                  <span className="font-bold text-[var(--ink)]">{percUsado}%</span>
                </div>
                <div className="w-full h-2.5 bg-[var(--line)] rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      percUsado > 85 ? 'bg-rose-500' : percUsado > 60 ? 'bg-amber-500' : 'bg-blue-500'
                    }`}
                    style={{ width: `${percUsado}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Histórico das Faturas em Abas Horizontais */}
      <div className="card p-6">
        <h3 className="text-lg font-bold text-[var(--ink)] mb-1">Histórico Completo de Faturas</h3>
        <p className="text-xs text-[var(--muted)] mb-4">Clique no mês para conferir o extrato detalhado de compras</p>

        {loadingFaturas ? (
          <div className="p-12 text-center text-[var(--muted)]">Carregando histórico do cartão...</div>
        ) : faturasData ? (
          <div className="space-y-6">
            {/* Seletor Horizontal de Meses */}
            <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-thin">
              {faturasData.faturas.map((fat, idx) => {
                const isSelected = idx === faturaIdx;
                return (
                  <button
                    key={idx}
                    onClick={() => setFaturaIdx(idx)}
                    className={`px-4 py-3 rounded-2xl border text-left shrink-0 transition-all ${
                      isSelected
                        ? 'border-blue-500 bg-[var(--accent-tint)] shadow-md ring-2 ring-blue-500/20'
                        : 'border-[var(--line)] bg-[var(--surface)] hover-surface'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="font-bold text-xs text-[var(--ink)]">{fat.nome_mes}</span>
                      {fat.is_atual && <span className="badge-blue text-[9px] px-1.5 py-0.5">Atual</span>}
                    </div>
                    <span className={`text-sm font-black block ${fat.total > 0 ? 'text-[var(--ink)]' : 'text-[var(--muted)]'}`}>
                      {fmt(fat.total)}
                    </span>
                    <span className="text-[10px] mt-0.5 block">
                      {fat.pago ? (
                        <span className="text-emerald-500 font-semibold flex items-center gap-0.5">
                          <CheckCircle size={10} /> Paga
                        </span>
                      ) : fat.total > 0 && fat.is_passado ? (
                        <span className="text-rose-500 font-semibold">Pendente</span>
                      ) : (
                        <span className="text-[var(--muted)]">Prevista</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Detalhe da Fatura Selecionada */}
            {faturaSelecionada && (
              <div className="bg-[var(--canvas)] rounded-2xl p-5 border border-[var(--line)] space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[var(--line)]">
                  <div>
                    <h4 className="text-base font-extrabold text-[var(--ink)]">
                      Fatura de {faturaSelecionada.nome_mes}
                    </h4>
                    <p className="text-xs text-[var(--muted)]">
                      {itensFatura.length} compras faturadas neste mês
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-2xl font-black text-[var(--ink)]">
                      {fmt(faturaSelecionada.total)}
                    </span>

                    {!faturaSelecionada.pago && faturaSelecionada.total > 0 && (
                      <button
                        onClick={() => setModalPagar(faturaSelecionada)}
                        className="btn-success text-xs py-2 px-3.5 shadow-md shadow-emerald-600/20"
                      >
                        <DollarSign size={15} /> Pagar Fatura
                      </button>
                    )}

                    {faturaSelecionada.pago && (
                      <span className="badge-green text-xs py-1.5 px-3 flex items-center gap-1.5">
                        <CheckCircle size={14} /> Fatura Paga em {new Date(faturaSelecionada.data_pagamento + 'T00:00:00').toLocaleDateString('pt-BR')}
                      </span>
                    )}
                  </div>
                </div>

                {/* Lista de Compras na Fatura */}
                {itensFatura.length === 0 ? (
                  <p className="text-sm text-[var(--muted)] text-center py-8 italic">
                    Nenhuma compra lançada nesta fatura.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {itensFatura.map((item, i) => {
                      const dataCompraStr = item.data_lancamento || item.data_compra;
                      return (
                        <div
                          key={i}
                          className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 p-3.5 rounded-xl bg-[var(--surface)] border border-[var(--line)] hover-surface transition-all"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <Avatar nome={item.pessoa || 'Você'} foto={item.pessoa_foto} cor={item.pessoa_cor} className="w-8 h-8 text-xs shrink-0" />
                            <div className="min-w-0">
                              <span className="font-bold text-[var(--ink)] text-sm block truncate">{item.descricao}</span>
                              <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)] mt-0.5">
                                <span className="font-semibold text-blue-500">Parcela {item.parcela}</span>
                                <span>•</span>
                                <span>{item.pessoa || 'Você'}</span>
                                {dataCompraStr && (
                                  <>
                                    <span>•</span>
                                    <span>{new Date(dataCompraStr + 'T00:00:00').toLocaleDateString('pt-BR')}</span>
                                  </>
                                )}
                                {item.modulo && <span>• 📁 {item.modulo}</span>}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2.5 shrink-0 ml-auto sm:ml-0">
                            <div className="text-right">
                              <span className="text-base font-black text-[var(--ink)] block">
                                {fmt(item.valor)}
                              </span>
                              <span className={`text-[10px] font-semibold uppercase ${item.status === 'pago' ? 'text-emerald-500' : 'text-[var(--muted)]'}`}>
                                {item.status === 'pago' ? 'Quitado' : 'A Vencer'}
                              </span>
                            </div>
                            {item.lancamento_id && (
                              <button
                                type="button"
                                onClick={() => setItemExcluindo({ item, nomeMes: faturaSelecionada.nome_mes })}
                                className="p-1.5 text-[var(--muted)] hover:text-rose-500 hover:bg-rose-500/10 rounded-lg transition-colors"
                                title="Excluir este lançamento ou parcela"
                              >
                                <Trash2 size={15} />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : null}
      </div>

      {modalPagar && (
        <ModalPagarFatura
          cartao={cartao}
          fatura={modalPagar}
          contas={contas}
          onClose={() => setModalPagar(null)}
          onSaved={() => { carregarFaturas(); onRefresh(); }}
        />
      )}

      {itemExcluindo && (
        <ModalExcluirItemFatura
          item={itemExcluindo.item}
          nomeMes={itemExcluindo.nomeMes}
          onClose={() => setItemExcluindo(null)}
          onSaved={() => { carregarFaturas(); onRefresh(); }}
        />
      )}
    </div>
  );
}

// ==========================================
// CARD COMPACTO NA LISTAGEM GERAL
// ==========================================
function CardCartao({ cartao, onClickCard, onEditar, onRemover, onRestaurar }) {
  const brand = getCardBrand(cartao.nome, cartao.cor);

  return (
    <article
      onClick={() => onClickCard(cartao)}
      className="card wallet-card p-0 cursor-pointer hover:scale-[1.02] hover:shadow-xl transition-all duration-300 border border-[var(--line)] group"
    >
      <div className="p-5 space-y-3">
        <div className="wallet-card__art group-hover:scale-[1.02] transition-transform">
          <CardArtwork cartao={cartao} />
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="w-3.5 h-3.5 rounded-full shrink-0 ring-2 ring-white/20 shadow-sm"
              style={{ backgroundColor: brand.color }}
              title={`Cor do cartão: ${brand.color}`}
            />
            <h3 className="font-bold text-lg text-[var(--ink)] truncate">{cartao.nome}</h3>
          </div>
          <span className="badge-blue shrink-0">{cartao.bandeira}</span>
        </div>

        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
          <span className="inline-flex items-center gap-1 font-medium">
            <Calendar size={14} className="text-blue-500" /> Fecha dia {cartao.dia_fechamento}
          </span>
          <span>Vence dia {cartao.dia_vencimento}</span>
        </div>

        <div className="wallet-card__amount pt-1 border-t border-[var(--line)]">
          <span className="text-xs text-[var(--muted)] block">Fatura atual</span>
          <strong className="text-xl font-black text-[var(--ink)]">{fmt(cartao.fatura_mes_atual?.total)}</strong>
          {cartao.limite > 0 && <span className="text-xs text-[var(--muted)] block mt-0.5">Limite: {fmt(cartao.limite)}</span>}
        </div>

        <div className="pt-2 flex items-center justify-between gap-2">
          <span className="text-xs font-bold text-blue-500 group-hover:translate-x-1 transition-transform inline-flex items-center gap-1">
            Ver Histórico e Faturas <ArrowUpRight size={14} />
          </span>

          <div className="flex items-center gap-1">
            <button
              type="button"
              className="p-1.5 text-[var(--muted)] hover:text-blue-500 hover:bg-blue-500/10 rounded-lg transition-colors inline-flex items-center gap-1 text-xs font-semibold"
              onClick={(e) => {
                e.stopPropagation();
                onEditar(cartao);
              }}
              title="Mudar Cor / Editar Cartão"
            >
              <Palette size={15} style={{ color: brand.color }} />
              <Edit2 size={13} />
            </button>

            {cartao.ativo !== false ? (
              <button
                type="button"
                className="p-1.5 text-[var(--muted)] hover:text-rose-500 hover:bg-rose-500/10 rounded-lg transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemover(cartao);
                }}
                title="Remover Cartão"
              >
                <Trash2 size={15} />
              </button>
            ) : (
              <button
                type="button"
                className="px-2 py-1 text-xs font-bold text-emerald-500 hover:bg-emerald-500/10 rounded-lg transition-colors inline-flex items-center gap-1"
                onClick={(e) => {
                  e.stopPropagation();
                  onRestaurar(cartao);
                }}
                title="Restaurar Cartão"
              >
                <RotateCcw size={13} /> Restaurar
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

// ==========================================
// TELA PRINCIPAL DE CARTÕES
// ==========================================
export default function Cartoes() {
  const [lista, setLista] = useState([]);
  const [contas, setContas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [modalNovo, setModalNovo] = useState(false);
  const [cartaoEditando, setCartaoEditando] = useState(null);
  const [arquivados, setArquivados] = useState(false);
  const [cartaoSelecionado, setCartaoSelecionado] = useState(null);

  const carregar = async () => {
    setLoading(true);
    setErro('');
    try {
      const [resC, resContas] = await Promise.all([
        cartoesApi.listar(arquivados),
        contasApi.listar()
      ]);
      setLista(resC.data);
      setContas(resContas.data);
      if (cartaoSelecionado) {
        const atualizado = resC.data.find(c => c.id === cartaoSelecionado.id);
        if (atualizado) setCartaoSelecionado(atualizado);
      }
    } catch (e) {
      console.error(e);
      setErro('Não foi possível carregar os cartões.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregar();
  }, [arquivados]);

  const handleRemover = async (c) => {
    if (!window.confirm(`Remover “${c.nome}” da lista de cartões ativos? Os lançamentos antigos serão mantidos.`)) return;
    try {
      await cartoesApi.deletar(c.id);
      carregar();
    } catch (error) {
      alert(error.response?.data?.detail || 'Erro ao remover cartão.');
    }
  };

  const handleRestaurar = async (c) => {
    try {
      await cartoesApi.atualizar(c.id, { ativo: true });
      carregar();
    } catch (error) {
      alert(error.response?.data?.detail || 'Erro ao restaurar cartão.');
    }
  };

  if (cartaoSelecionado) {
    return (
      <>
        <DetalheCartao
          cartao={cartaoSelecionado}
          contas={contas}
          onVoltar={() => setCartaoSelecionado(null)}
          onEditar={(c) => setCartaoEditando(c)}
          onRefresh={carregar}
        />
        {cartaoEditando && (
          <ModalCartaoForm
            cartaoInicial={cartaoEditando}
            onClose={() => setCartaoEditando(null)}
            onSaved={carregar}
          />
        )}
      </>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header com Ações */}
      <div className="page-heading">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--ink)] tracking-tight">Cartões de Crédito</h1>
          <p className="text-[var(--muted)] text-sm mt-0.5">
            Personalize a cor de cada cartão na paleta e acompanhe o histórico de faturas
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn-secondary text-sm"
            disabled={loading}
            aria-pressed={arquivados}
            onClick={() => {
              setLista([]);
              setArquivados(!arquivados);
            }}
          >
            {arquivados ? 'Ver cartões ativos' : 'Ver cartões removidos'}
          </button>
          <button onClick={() => setModalNovo(true)} className="btn-primary text-sm">
            <Plus size={18} /> Novo Cartão
          </button>
        </div>
      </div>

      {loading && lista.length === 0 ? (
        <div className="flex items-center justify-center h-64 text-[var(--muted)] text-sm">Carregando cartões...</div>
      ) : erro ? (
        <div className="card">
          <p role="alert" className="text-rose-500">{erro}</p>
          <button className="btn-secondary mt-3" onClick={() => carregar()}>Tentar novamente</button>
        </div>
      ) : lista.length === 0 ? (
        <div className="card text-center py-16">
          <div className="w-14 h-14 bg-purple-500/10 text-purple-500 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <CreditCard size={28} />
          </div>
          <h3 className="font-bold text-[var(--ink)] text-lg">{arquivados ? 'Nenhum cartão removido' : 'Nenhum cartão cadastrado'}</h3>
          {!arquivados && (
            <>
              <p className="text-[var(--muted)] text-sm max-w-sm mx-auto mt-1 mb-5">
                Cadastre seus cartões (Itaú, Nubank, Atacadão, Coop...) com cor personalizada, dia de fechamento e limite.
              </p>
              <button onClick={() => setModalNovo(true)} className="btn-primary text-sm">
                Cadastrar Primeiro Cartão
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {lista.map(c => (
            <CardCartao
              key={c.id}
              cartao={c}
              onClickCard={setCartaoSelecionado}
              onEditar={setCartaoEditando}
              onRemover={handleRemover}
              onRestaurar={handleRestaurar}
            />
          ))}
        </div>
      )}

      {modalNovo && (
        <ModalCartaoForm onClose={() => setModalNovo(false)} onSaved={carregar} />
      )}

      {cartaoEditando && (
        <ModalCartaoForm
          cartaoInicial={cartaoEditando}
          onClose={() => setCartaoEditando(null)}
          onSaved={carregar}
        />
      )}
    </div>
  );
}
