import { useState, useEffect, useMemo } from 'react';
import {
  dividas as dividasApi,
  contas as contasApi,
  modulos as modulosApi,
} from '../api/client';
import {
  formatBRL as fmt,
  describeSituacaoVencimento,
  calcularEstimativaAntecipacao,
} from '../components/dividasFormat';
import {
  Target,
  Plus,
  AlertTriangle,
  Clock,
  CalendarClock,
  CheckCircle2,
  TrendingDown,
  Zap,
  Snowflake,
  Flame,
  Calculator,
  RotateCcw,
  FastForward,
  Edit3,
  Trash2,
  X,
  ChevronDown,
  ChevronUp,
  Wallet,
  Repeat,
  Layers,
  SlidersHorizontal,
  Sparkles,
  Archive,
} from 'lucide-react';

const MESES_NOMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const CATEGORIAS_SUGERIDAS = [
  'Veículo',
  'Moradia / Condomínio',
  'Financiamento',
  'Empréstimo',
  'Consórcio',
  'Conta Fixa / Serviço',
  'Imposto / Taxa',
  'Outros',
];

const PRESETS_RAPIDOS = [
  {
    label: '🚗 Financiamento Carro',
    nome: 'Carro',
    categoria: 'Veículo',
    tipo_compromisso: 'parcelada',
    total_parcelas: '18',
    dia_vencimento: '20',
    cor: '#2563EB',
  },
  {
    label: '🏍️ Moto (Parcela ou Fixa)',
    nome: 'Moto',
    categoria: 'Veículo',
    tipo_compromisso: 'parcelada',
    total_parcelas: '24',
    dia_vencimento: '30',
    cor: '#0891B2',
  },
  {
    label: '🏢 Condomínio Mensal',
    nome: 'Condomínio',
    categoria: 'Moradia / Condomínio',
    tipo_compromisso: 'fixa',
    total_parcelas: '',
    dia_vencimento: '15',
    cor: '#6366F1',
  },
  {
    label: '🏦 Empréstimo / Carnê',
    nome: 'Empréstimo',
    categoria: 'Empréstimo',
    tipo_compromisso: 'parcelada',
    total_parcelas: '12',
    dia_vencimento: '10',
    cor: '#D97706',
  },
];

function hojeISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function MesSelector({ mes, ano, onChange }) {
  const anoAtual = new Date().getFullYear();
  const anos = [];
  for (let a = anoAtual - 2; a <= anoAtual + 5; a += 1) anos.push(a);

  return (
    <div className="flex items-center gap-2 bg-[var(--surface)] p-1.5 rounded-xl border border-[var(--line)] shadow-sm">
      <select
        className="text-sm font-semibold text-[var(--ink)] bg-[var(--surface)] px-2 py-1 outline-none cursor-pointer rounded-lg border border-transparent focus:border-[var(--accent)]"
        value={mes}
        onChange={(e) => onChange(Number(e.target.value), ano)}
        aria-label="Selecionar mês"
      >
        {MESES_NOMES.map((m, i) => (
          <option key={m} value={i + 1}>
            {m}
          </option>
        ))}
      </select>
      <span className="text-[var(--muted)]">/</span>
      <select
        className="text-sm font-semibold text-[var(--ink)] bg-[var(--surface)] px-2 py-1 outline-none cursor-pointer rounded-lg border border-transparent focus:border-[var(--accent)]"
        value={ano}
        onChange={(e) => onChange(mes, Number(e.target.value))}
        aria-label="Selecionar ano"
      >
        {anos.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>
    </div>
  );
}

function ModalFormDivida({ dividaEdit, contas, modulos, mesAtual, anoAtual, onClose, onSaved }) {
  const isEdit = Boolean(dividaEdit);
  const [form, setForm] = useState({
    nome: dividaEdit?.nome || '',
    credor: dividaEdit?.credor || '',
    categoria: dividaEdit?.categoria || 'Financiamento',
    tipo_compromisso: dividaEdit?.tipo_compromisso || 'parcelada',
    valor_parcela: dividaEdit?.valor_parcela ?? '',
    dia_vencimento: String(dividaEdit?.dia_vencimento ?? 20),
    total_parcelas: dividaEdit?.total_parcelas ? String(dividaEdit.total_parcelas) : '18',
    parcelas_pagas_anteriores: String(dividaEdit?.parcelas_pagas_anteriores ?? 0),
    mes_inicio: String(dividaEdit?.mes_inicio ?? mesAtual),
    ano_inicio: String(dividaEdit?.ano_inicio ?? anoAtual),
    taxa_juros_mensal: String(dividaEdit?.taxa_juros_mensal ?? '0'),
    desconto_antecipacao_pct: String(dividaEdit?.desconto_antecipacao_pct ?? '0'),
    conta_padrao_id:
      dividaEdit?.conta_padrao_id && contas.some((c) => c.id === dividaEdit.conta_padrao_id)
        ? String(dividaEdit.conta_padrao_id)
        : '',
    modulo_id:
      dividaEdit?.modulo_id && modulos.some((m) => m.id === dividaEdit.modulo_id)
        ? String(dividaEdit.modulo_id)
        : '',
    cor: dividaEdit?.cor || '#2563EB',
    observacoes: dividaEdit?.observacoes || '',
  });
  const [submitting, setSubmitting] = useState(false);

  const aplicarPreset = (p) => {
    setForm((prev) => ({
      ...prev,
      nome: p.nome,
      categoria: p.categoria,
      tipo_compromisso: p.tipo_compromisso,
      total_parcelas: p.total_parcelas || prev.total_parcelas,
      dia_vencimento: p.dia_vencimento,
      cor: p.cor,
    }));
  };

  const pagasAntesNum = Math.max(0, parseInt(form.parcelas_pagas_anteriores || '0', 10) || 0);
  const totalParcNum = Math.max(1, parseInt(form.total_parcelas || '1', 10) || 1);
  const diaNum = Math.max(1, Math.min(31, parseInt(form.dia_vencimento || '10', 10) || 10));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const valorNum = parseFloat(form.valor_parcela);
      if (!valorNum || valorNum <= 0) {
        alert('Informe um valor mensal válido maior que zero.');
        setSubmitting(false);
        return;
      }

      if (isEdit) {
        await dividasApi.atualizar(dividaEdit.id, {
          nome: form.nome.trim(),
          credor: form.credor.trim(),
          categoria: form.categoria,
          valor_parcela: valorNum,
          dia_vencimento: diaNum,
          taxa_juros_mensal: parseFloat(form.taxa_juros_mensal) || 0,
          desconto_antecipacao_pct: parseFloat(form.desconto_antecipacao_pct) || 0,
          conta_padrao_id: form.conta_padrao_id ? Number(form.conta_padrao_id) : null,
          limpar_conta_padrao: !form.conta_padrao_id,
          modulo_id: form.modulo_id ? Number(form.modulo_id) : null,
          limpar_modulo: !form.modulo_id,
          cor: form.cor,
          observacoes: form.observacoes,
        });
      } else {
        const isParc = form.tipo_compromisso === 'parcelada';
        await dividasApi.criar({
          nome: form.nome.trim(),
          credor: form.credor.trim() || null,
          categoria: form.categoria,
          tipo_compromisso: form.tipo_compromisso,
          valor_parcela: valorNum,
          dia_vencimento: diaNum,
          total_parcelas: isParc ? totalParcNum : null,
          parcelas_pagas_anteriores: isParc ? pagasAntesNum : 0,
          mes_inicio: Number(form.mes_inicio),
          ano_inicio: Number(form.ano_inicio),
          taxa_juros_mensal: parseFloat(form.taxa_juros_mensal) || 0,
          desconto_antecipacao_pct: parseFloat(form.desconto_antecipacao_pct) || 0,
          conta_padrao_id: form.conta_padrao_id ? Number(form.conta_padrao_id) : null,
          modulo_id: form.modulo_id ? Number(form.modulo_id) : null,
          cor: form.cor,
          observacoes: form.observacoes.trim() || null,
        });
      }
      onSaved();
      onClose();
    } catch (err) {
      alert('Erro ao salvar: ' + (err.response?.data?.detail || err.message));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl p-6 border border-gray-100 my-8 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-extrabold text-gray-900">
              {isEdit ? `Editar: ${dividaEdit.nome}` : 'Nova Dívida ou Compromisso Mensal'}
            </h2>
            <p className="text-xs text-gray-500">
              Cadastre financiamentos parcelados (ex.: Carro 18x dia 20) ou contas fixas (ex.: Condomínio dia 15)
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg">
            <X size={20} />
          </button>
        </div>

        {!isEdit && (
          <div className="mb-4">
            <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500 block mb-2">
              Atalhos Rápidos de Cadastro
            </span>
            <div className="flex flex-wrap gap-2">
              {PRESETS_RAPIDOS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => aplicarPreset(p)}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold border border-[var(--line)] bg-[var(--raised)] text-[var(--ink)] hover:border-blue-500 transition-all"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isEdit && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 p-1.5 rounded-2xl bg-[var(--raised)] border border-[var(--line)]">
              <button
                type="button"
                onClick={() => setForm({ ...form, tipo_compromisso: 'parcelada' })}
                className={`p-3 rounded-xl text-left transition-all flex items-start gap-2.5 ${
                  form.tipo_compromisso === 'parcelada'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-[var(--ink)] hover:bg-[var(--surface)]'
                }`}
              >
                <Layers size={18} className="shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-xs">Dívida Parcelada / Financiamento</p>
                  <p className={`text-[11px] ${form.tipo_compromisso === 'parcelada' ? 'text-blue-100' : 'text-[var(--muted)]'}`}>
                    Ex.: Carro 18x de R$ 1.500 todo dia 20
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setForm({ ...form, tipo_compromisso: 'fixa' })}
                className={`p-3 rounded-xl text-left transition-all flex items-start gap-2.5 ${
                  form.tipo_compromisso === 'fixa'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-[var(--ink)] hover:bg-[var(--surface)]'
                }`}
              >
                <Repeat size={18} className="shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-xs">Conta Fixa / Recorrente Mensal</p>
                  <p className={`text-[11px] ${form.tipo_compromisso === 'fixa' ? 'text-blue-100' : 'text-[var(--muted)]'}`}>
                    Ex.: Condomínio dia 15, Moto / Seguro dia 30
                  </p>
                </div>
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="label">Nome da Dívida / Compromisso *</label>
              <input
                type="text"
                className="input font-semibold"
                placeholder="Ex: Carro, Moto, Condomínio, Empréstimo..."
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="label">Categoria</label>
              <select
                className="input"
                value={form.categoria}
                onChange={(e) => setForm({ ...form, categoria: e.target.value })}
              >
                {CATEGORIAS_SUGERIDAS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="label">
                {form.tipo_compromisso === 'parcelada' ? 'Valor da Parcela (R$) *' : 'Valor Mensal Base (R$) *'}
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                className="input font-bold"
                placeholder="1500.00"
                value={form.valor_parcela}
                onChange={(e) => setForm({ ...form, valor_parcela: e.target.value })}
                required
              />
            </div>

            <div>
              <label className="label">Todo Dia (Vencimento) *</label>
              <input
                type="number"
                min="1"
                max="31"
                className="input font-bold"
                value={form.dia_vencimento}
                onChange={(e) => setForm({ ...form, dia_vencimento: e.target.value })}
                required
              />
              {diaNum >= 29 && (
                <p className="text-[10px] text-blue-600 mt-1 font-medium">
                  Em meses curtos (ex.: fev), ajusta p/ dia 28/29 automaticamente.
                </p>
              )}
            </div>

            <div>
              <label className="label">Credor / Instituição (opcional)</label>
              <input
                type="text"
                className="input"
                placeholder="Ex: Banco BV, Itaú, Adm..."
                value={form.credor}
                onChange={(e) => setForm({ ...form, credor: e.target.value })}
              />
            </div>
          </div>

          {!isEdit && form.tipo_compromisso === 'parcelada' && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 rounded-2xl bg-[var(--raised)] border border-[var(--line)]">
              <div>
                <label className="label">Total de Parcelas *</label>
                <input
                  type="number"
                  min="1"
                  max="480"
                  className="input font-bold"
                  value={form.total_parcelas}
                  onChange={(e) => setForm({ ...form, total_parcelas: e.target.value })}
                  required
                />
              </div>

              <div>
                <label className="label">Já Pagas Antes do Cadastro</label>
                <input
                  type="number"
                  min="0"
                  max={totalParcNum}
                  className="input"
                  value={form.parcelas_pagas_anteriores}
                  onChange={(e) => setForm({ ...form, parcelas_pagas_anteriores: e.target.value })}
                />
                <p className="text-[10px] text-[var(--muted)] mt-1">
                  Se já está em andamento, informe quantas já quitou.
                </p>
              </div>

              <div>
                <label className="label">
                  {pagasAntesNum > 0 && pagasAntesNum < totalParcNum
                    ? `Mês da Parcela #${pagasAntesNum + 1}`
                    : 'Mês da 1ª Parcela'}
                </label>
                <div className="flex gap-1.5">
                  <select
                    className="input px-2"
                    value={form.mes_inicio}
                    onChange={(e) => setForm({ ...form, mes_inicio: e.target.value })}
                  >
                    {MESES_NOMES.map((m, idx) => (
                      <option key={m} value={idx + 1}>
                        {m.slice(0, 3)}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="2000"
                    max="2100"
                    className="input px-2 w-24"
                    value={form.ano_inicio}
                    onChange={(e) => setForm({ ...form, ano_inicio: e.target.value })}
                  />
                </div>
              </div>
            </div>
          )}

          {!isEdit && form.tipo_compromisso === 'fixa' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-2xl bg-[var(--raised)] border border-[var(--line)]">
              <div>
                <label className="label">Acompanhar a partir de</label>
                <div className="flex gap-2">
                  <select
                    className="input"
                    value={form.mes_inicio}
                    onChange={(e) => setForm({ ...form, mes_inicio: e.target.value })}
                  >
                    {MESES_NOMES.map((m, idx) => (
                      <option key={m} value={idx + 1}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="2000"
                    max="2100"
                    className="input w-28"
                    value={form.ano_inicio}
                    onChange={(e) => setForm({ ...form, ano_inicio: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex items-center text-xs text-[var(--muted)]">
                Você poderá ajustar o valor de qualquer mês específico caso a conta varie (ex.: rateio extra no condomínio).
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Conta Bancária Preferencial (opcional)</label>
              <select
                className="input"
                value={form.conta_padrao_id}
                onChange={(e) => setForm({ ...form, conta_padrao_id: e.target.value })}
              >
                <option value="">Escolher na hora de dar baixa</option>
                {contas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome} ({c.banco}) — Saldo: {fmt(c.saldo_atual)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">Módulo / Centro de Custo (opcional)</label>
              <select
                className="input"
                value={form.modulo_id}
                onChange={(e) => setForm({ ...form, modulo_id: e.target.value })}
              >
                <option value="">Sem vínculo de módulo</option>
                {modulos.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nome}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {form.tipo_compromisso === 'parcelada' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Juros Mensal % a.m. (opcional p/ Estratégia)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="50"
                  className="input"
                  placeholder="0.00"
                  value={form.taxa_juros_mensal}
                  onChange={(e) => setForm({ ...form, taxa_juros_mensal: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Desconto Médio p/ Antecipar % (opcional)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="95"
                  className="input"
                  placeholder="0.00"
                  value={form.desconto_antecipacao_pct}
                  onChange={(e) => setForm({ ...form, desconto_antecipacao_pct: e.target.value })}
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
            <div>
              <label className="label">Cor de Destaque</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  className="w-11 h-10 rounded-lg cursor-pointer border border-gray-300"
                  value={form.cor}
                  onChange={(e) => setForm({ ...form, cor: e.target.value })}
                />
                <span className="text-xs font-mono text-[var(--muted)] uppercase">{form.cor}</span>
              </div>
            </div>
            <div className="sm:col-span-3">
              <label className="label">Observações (opcional)</label>
              <input
                type="text"
                className="input"
                placeholder="Ex: Débito automático Itaú, boleto no app, contrato nº..."
                value={form.observacoes}
                onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-[var(--line)]">
            <button type="button" onClick={onClose} className="btn-secondary">
              Cancelar
            </button>
            <button type="submit" disabled={submitting} className="btn-primary">
              {submitting ? 'Salvando...' : isEdit ? 'Salvar Alterações' : 'Cadastrar Dívida'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ModalBaixaPagamento({ item, contas, onClose, onSaved }) {
  const [contaId, setContaId] = useState(
    item.conta_padrao_id && contas.some((c) => c.id === item.conta_padrao_id)
      ? String(item.conta_padrao_id)
      : ''
  );
  const [valorPago, setValorPago] = useState(String(item.valor_atual ?? ''));
  const [dataPagamento, setDataPagamento] = useState(hojeISO());
  const [formaPagamento, setFormaPagamento] = useState('Pix / Boleto');
  const [observacao, setObservacao] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const valorOriginal = Number(item.valor_atual || 0);
  const valorDigitado = parseFloat(valorPago) || 0;
  const diferenca = Number((valorDigitado - valorOriginal).toFixed(2));

  const handleConfirmar = async (e) => {
    e.preventDefault();
    if (!valorDigitado || valorDigitado <= 0) {
      alert('Informe um valor pago válido.');
      return;
    }
    setSubmitting(true);
    try {
      await dividasApi.pagar(item.divida_id, {
        parcela_id: item.parcela_id || null,
        numero: item.tipo_compromisso === 'parcelada' ? item.numero : null,
        mes: item.mes,
        ano: item.ano,
        valor_pago: valorDigitado,
        data_pagamento: dataPagamento,
        conta_id: contaId ? Number(contaId) : null,
        forma_pagamento: formaPagamento,
        observacao: observacao.trim() || null,
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
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6 border border-gray-100">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-extrabold text-gray-900">Dar Baixa em Vencimento</h2>
            <p className="text-xs text-gray-500">
              {item.divida_nome} • {item.rotulo_parcela} (Venc.:{' '}
              {new Date(`${item.vencimento}T00:00:00`).toLocaleDateString('pt-BR')})
            </p>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700 rounded-lg">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleConfirmar} className="space-y-4">
          <div>
            <label className="label">Debitar de qual Conta Bancária?</label>
            <select
              className="input font-semibold"
              value={contaId}
              onChange={(e) => setContaId(e.target.value)}
            >
              <option value="">Não debitar de conta (pago por fora / dinheiro)</option>
              {contas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome} ({c.banco}) — Saldo: {fmt(c.saldo_atual)}
                </option>
              ))}
            </select>
            <div className={`mt-2 p-2.5 rounded-xl text-xs font-medium flex items-center gap-2 ${
              contaId
                ? 'bg-blue-50 text-blue-700 border border-blue-100'
                : 'bg-[var(--raised)] text-[var(--muted)] border border-[var(--line)]'
            }`}>
              <Wallet size={15} className="shrink-0" />
              {contaId
                ? 'Saída registrada automaticamente no extrato e saldo da conta escolhida.'
                : 'Apenas marca como quitada no painel de dívidas, sem movimentar contas.'}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Valor Pago (R$) *</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                className="input font-black"
                value={valorPago}
                onChange={(e) => setValorPago(e.target.value)}
                required
              />
              {diferenca < 0 && (
                <p className="text-[11px] text-emerald-600 font-bold mt-1">
                  Desconto de {fmt(Math.abs(diferenca))}
                </p>
              )}
              {diferenca > 0 && (
                <p className="text-[11px] text-amber-600 font-bold mt-1">
                  Juros/acréscimo de {fmt(diferenca)}
                </p>
              )}
            </div>

            <div>
              <label className="label">Data do Pagamento *</label>
              <input
                type="date"
                className="input"
                value={dataPagamento}
                onChange={(e) => setDataPagamento(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Forma de Pagamento</label>
              <select
                className="input"
                value={formaPagamento}
                onChange={(e) => setFormaPagamento(e.target.value)}
              >
                <option value="Pix / Boleto">Pix / Boleto</option>
                <option value="Débito em Conta">Débito em Conta</option>
                <option value="Transferência / TED">Transferência / TED</option>
                <option value="Dinheiro em Mãos">Dinheiro em Mãos</option>
              </select>
            </div>
            <div>
              <label className="label">Observação (opcional)</label>
              <input
                type="text"
                className="input"
                placeholder="Ex: Pago c/ desconto"
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-[var(--line)]">
            <button type="button" onClick={onClose} className="btn-secondary">
              Cancelar
            </button>
            <button type="submit" disabled={submitting} className="btn-success">
              {submitting ? 'Confirmando...' : `Confirmar Baixa (${fmt(valorDigitado)})`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ModalAnteciparParcelas({ divida, contas, qtdInicial = 1, onClose, onSaved }) {
  const pendentes = useMemo(
    () => (divida.parcelas || []).filter((p) => p.status === 'pendente'),
    [divida]
  );
  const maxQtd = Math.max(1, pendentes.length);

  const [qtd, setQtd] = useState(Math.min(maxQtd, Math.max(1, Number(qtdInicial) || 1)));
  const [ordem, setOrdem] = useState('ultimas');
  const [modoValor, setModoValor] = useState('percentual'); // 'percentual' | 'valor_fechado'
  const [descontoPct, setDescontoPct] = useState(() => {
    const pctCad = Number(divida.desconto_antecipacao_pct || 0);
    if (pctCad > 0) return String(pctCad);
    if (Number(divida.taxa_juros_mensal || 0) > 0) return '';
    return '0';
  });
  const [valorFechado, setValorFechado] = useState('');
  const [contaId, setContaId] = useState(
    divida.conta_padrao_id && contas.some((c) => c.id === divida.conta_padrao_id)
      ? String(divida.conta_padrao_id)
      : ''
  );
  const [dataPagamento, setDataPagamento] = useState(hojeISO());
  const [observacao, setObservacao] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const selecionadas = useMemo(() => {
    const n = Math.min(maxQtd, Math.max(1, Number(qtd) || 1));
    return ordem === 'ultimas' ? pendentes.slice(-n) : pendentes.slice(0, n);
  }, [pendentes, qtd, ordem, maxQtd]);

  const estimativa = useMemo(
    () =>
      calcularEstimativaAntecipacao(selecionadas, {
        modoValor,
        valorFechado,
        descontoPct,
        taxaJurosMensal: divida.taxa_juros_mensal,
        dataPagamentoISO: dataPagamento,
      }),
    [selecionadas, modoValor, valorFechado, descontoPct, divida.taxa_juros_mensal, dataPagamento]
  );
  const somaNominal = estimativa.somaNominal;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload = {
        quantidade_parcelas: Math.min(maxQtd, Math.max(1, Number(qtd) || 1)),
        ordem,
        data_pagamento: dataPagamento,
        conta_id: contaId ? Number(contaId) : null,
        observacao: observacao.trim() || null,
      };
      if (modoValor === 'valor_fechado') {
        const vf = parseFloat(valorFechado);
        if (!vf || vf <= 0) {
          alert('Informe o valor total negociado no boleto de antecipação.');
          setSubmitting(false);
          return;
        }
        payload.valor_total_pago = vf;
      } else if (String(descontoPct ?? '').trim() === '') {
        payload.desconto_pct = null;
      } else {
        payload.desconto_pct = Math.max(0, parseFloat(descontoPct) || 0);
      }

      await dividasApi.antecipar(divida.id, payload);
      onSaved();
      onClose();
    } catch (err) {
      alert('Erro ao antecipar parcelas: ' + (err.response?.data?.detail || err.message));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg p-6 border border-gray-100">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-extrabold text-gray-900">
              Antecipar Parcelas — {divida.nome}
            </h2>
            <p className="text-xs text-gray-500">
              {pendentes.length} parcela(s) restante(s) • Saldo nominal: {fmt(divida.saldo_restante)}
            </p>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700 rounded-lg">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Quantas parcelas abater? *</label>
              <input
                type="number"
                min="1"
                max={maxQtd}
                className="input font-black"
                value={qtd}
                onChange={(e) => setQtd(Math.min(maxQtd, Math.max(1, Number(e.target.value) || 1)))}
                required
              />
            </div>
            <div>
              <label className="label">Ordem de Abatimento</label>
              <select
                className="input font-semibold"
                value={ordem}
                onChange={(e) => setOrdem(e.target.value)}
              >
                <option value="ultimas">Últimas (de trás p/ frente)</option>
                <option value="proximas">Próximas (meses seguintes)</option>
              </select>
            </div>
          </div>

          <div className="p-3 rounded-2xl bg-[var(--raised)] border border-[var(--line)] space-y-3">
            <div className="flex gap-2 text-xs">
              <button
                type="button"
                onClick={() => setModoValor('percentual')}
                className={`flex-1 py-1.5 px-2.5 rounded-lg font-bold transition-all ${
                  modoValor === 'percentual'
                    ? 'bg-blue-600 text-white'
                    : 'bg-[var(--surface)] text-[var(--muted)]'
                }`}
              >
                Desconto em %
              </button>
              <button
                type="button"
                onClick={() => {
                  setModoValor('valor_fechado');
                  if (!valorFechado) setValorFechado(somaNominal.toFixed(2));
                }}
                className={`flex-1 py-1.5 px-2.5 rounded-lg font-bold transition-all ${
                  modoValor === 'valor_fechado'
                    ? 'bg-blue-600 text-white'
                    : 'bg-[var(--surface)] text-[var(--muted)]'
                }`}
              >
                Valor Total do Boleto (R$)
              </button>
            </div>

            {modoValor === 'percentual' ? (
              <div>
                <label className="label">Desconto obtido na antecipação (%)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="95"
                  className="input font-bold"
                  placeholder={
                    Number(divida.taxa_juros_mensal || 0) > 0
                      ? `Automático CDC (${divida.taxa_juros_mensal}% a.m.) ou digite 0`
                      : '0.00'
                  }
                  value={descontoPct}
                  onChange={(e) => setDescontoPct(e.target.value)}
                />
                {estimativa.usaCdcAutomatico && (
                  <p className="text-[11px] text-blue-600 font-medium mt-1">
                    Calculado pelo valor presente CDC ({divida.taxa_juros_mensal}% a.m.). Digite 0 caso não haja desconto.
                  </p>
                )}
              </div>
            ) : (
              <div>
                <label className="label">Valor Total Efetivamente Pago (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  className="input font-bold"
                  value={valorFechado}
                  onChange={(e) => setValorFechado(e.target.value)}
                />
              </div>
            )}

            <div className="flex items-center justify-between text-xs pt-2 border-t border-[var(--line)]">
              <span className="text-[var(--muted)]">
                Nominal abatido: <strong className="text-[var(--ink)]">{fmt(somaNominal)}</strong>
              </span>
              <span className="text-emerald-600 font-extrabold">
                Economia: {fmt(estimativa.economia)}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Conta Bancária (Saída Integrada)</label>
              <select
                className="input"
                value={contaId}
                onChange={(e) => setContaId(e.target.value)}
              >
                <option value="">Pago por fora (sem debitar conta)</option>
                {contas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome} — {fmt(c.saldo_atual)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Data do Pagamento</label>
              <input
                type="date"
                className="input"
                value={dataPagamento}
                onChange={(e) => setDataPagamento(e.target.value)}
                required
              />
            </div>
          </div>

          <div>
            <label className="label">Observação (opcional)</label>
            <input
              type="text"
              className="input"
              placeholder="Ex: Amortização com 13º salário"
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-[var(--line)]">
            <button type="button" onClick={onClose} className="btn-secondary">
              Cancelar
            </button>
            <button type="submit" disabled={submitting} className="btn-primary">
              {submitting
                ? 'Processando...'
                : `Antecipar ${qtd}x por ${fmt(estimativa.totalPagar)}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ModalAjustarMes({ item, onClose, onSaved }) {
  const [novoValor, setNovoValor] = useState(String(item.valor_atual ?? ''));
  const [observacao, setObservacao] = useState(item.observacao || '');
  const [submitting, setSubmitting] = useState(false);

  const handleSalvar = async (e) => {
    e.preventDefault();
    const v = parseFloat(novoValor);
    if (!v || v <= 0) {
      alert('Informe um valor válido.');
      return;
    }
    setSubmitting(true);
    try {
      await dividasApi.ajustarMes(item.divida_id, {
        mes: item.mes,
        ano: item.ano,
        novo_valor: v,
        observacao: observacao.trim() || null,
      });
      onSaved();
      onClose();
    } catch (err) {
      alert('Erro ao ajustar competência: ' + (err.response?.data?.detail || err.message));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 border border-gray-100">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-extrabold text-gray-900">Ajustar Valor no Mês</h2>
            <p className="text-xs text-gray-500">
              {item.divida_nome} • {item.nome_mes}
            </p>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700 rounded-lg">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSalvar} className="space-y-3.5">
          <div>
            <label className="label">Valor desta Competência (R$)</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              className="input font-bold"
              value={novoValor}
              onChange={(e) => setNovoValor(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label">Motivo / Observação (opcional)</label>
            <input
              type="text"
              className="input"
              placeholder="Ex: Taxa extra condomínio / reajuste"
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-[var(--line)]">
            <button type="button" onClick={onClose} className="btn-secondary text-xs">
              Cancelar
            </button>
            <button type="submit" disabled={submitting} className="btn-primary text-xs">
              {submitting ? 'Salvando...' : 'Salvar Valor'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Dividas() {
  const hoje = new Date();
  const [mes, setMes] = useState(hoje.getMonth() + 1);
  const [ano, setAno] = useState(hoje.getFullYear());
  const [abaAtiva, setAbaAtiva] = useState('radar'); // 'radar' | 'estrategia' | 'carteira'
  const [modoEstrategia, setModoEstrategia] = useState('avalanche'); // 'avalanche' | 'bola_de_neve'

  const [painel, setPainel] = useState(null);
  const [contas, setContas] = useState([]);
  const [modulos, setModulos] = useState([]);
  const [loading, setLoading] = useState(true);

  const [modalForm, setModalForm] = useState(null); // null | 'novo' | dividaObj
  const [modalBaixa, setModalBaixa] = useState(null);
  const [modalAntecipar, setModalAntecipar] = useState(null); // { divida, qtdInicial }
  const [modalAjuste, setModalAjuste] = useState(null);
  const [expandedDividaId, setExpandedDividaId] = useState(null);

  // Estado do Simulador de Antecipação & Aporte Extra
  const [simForm, setSimForm] = useState({
    aporte_unico: '',
    aporte_mensal_extra: '300',
    estrategia: 'avalanche',
    divida_alvo_id: '',
    reinvestir_alivio: true,
  });
  const [simResultado, setSimResultado] = useState(null);
  const [simulando, setSimulando] = useState(false);

  const carregarTudo = async () => {
    setLoading(true);
    try {
      const [resPainel, resContas, resModulos] = await Promise.all([
        dividasApi.painel({ mes, ano, janela_dias: 15 }),
        contasApi.listar(),
        modulosApi.listar({ mes, ano }),
      ]);
      setPainel(resPainel.data);
      setContas(resContas.data || []);
      setModulos(resModulos.data || []);
    } catch (err) {
      console.error('Erro ao carregar módulo de dívidas:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregarTudo();
  }, [mes, ano]);

  const executarSimulacao = async (customParams = null) => {
    const params = customParams || simForm;
    setSimulando(true);
    try {
      const res = await dividasApi.simular({
        aporte_unico: parseFloat(params.aporte_unico) || 0,
        aporte_mensal_extra: parseFloat(params.aporte_mensal_extra) || 0,
        estrategia: params.estrategia,
        divida_alvo_id: params.divida_alvo_id ? Number(params.divida_alvo_id) : null,
        reinvestir_alivio: Boolean(params.reinvestir_alivio),
      });
      setSimResultado(res.data);
    } catch (err) {
      console.error('Erro ao simular quitação:', err);
    } finally {
      setSimulando(false);
    }
  };

  const selecionarModoEstrategia = (novoModo) => {
    setModoEstrategia(novoModo);
    const nextSim = { ...simForm, estrategia: novoModo };
    setSimForm(nextSim);
    if (abaAtiva === 'estrategia' && painel?.dividas?.some((d) => d.tipo_compromisso === 'parcelada')) {
      executarSimulacao(nextSim);
    }
  };

  useEffect(() => {
    if (abaAtiva === 'estrategia' && painel?.dividas?.some((d) => d.tipo_compromisso === 'parcelada')) {
      executarSimulacao();
    }
  }, [abaAtiva, painel]);

  const handleEstornar = async (item) => {
    const msgConta = item.conta
      ? `\n\nO lançamento vinculado na conta "${item.conta.nome}" também será removido automaticamente.`
      : '';
    if (!window.confirm(`Deseja desfazer/estornar o pagamento de "${item.divida_nome} (${item.rotulo_parcela})"?${msgConta}`)) {
      return;
    }
    try {
      await dividasApi.estornar(item.divida_id, {
        parcela_id: item.parcela_id || null,
        numero: item.tipo_compromisso === 'parcelada' ? item.numero : null,
        mes: item.mes,
        ano: item.ano,
      });
      await carregarTudo();
    } catch (err) {
      alert('Erro ao estornar: ' + (err.response?.data?.detail || err.message));
    }
  };

  const handleExcluirDivida = async (divida) => {
    if (
      !window.confirm(
        `Tem certeza que deseja excluir "${divida.nome}"?\n\nEventuais lançamentos bancários gerados automaticamente por baixas desta dívida serão revertidos para manter seus saldos exatos.`
      )
    ) {
      return;
    }
    try {
      await dividasApi.deletar(divida.id);
      await carregarTudo();
    } catch (err) {
      alert('Erro ao excluir dívida: ' + (err.response?.data?.detail || err.message));
    }
  };

  const handleEncerrarRecorrencia = async (divida) => {
    if (
      !window.confirm(
        `Deseja encerrar as próximas cobranças mensais de "${divida.nome}" mantendo todo o histórico já pago nos meses anteriores?`
      )
    ) {
      return;
    }
    try {
      await dividasApi.atualizar(divida.id, { ativa: false });
      await carregarTudo();
    } catch (err) {
      alert('Erro ao encerrar recorrência: ' + (err.response?.data?.detail || err.message));
    }
  };

  if (loading && !painel) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-3">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-[var(--muted)] text-sm">Carregando radar de dívidas e estratégia...</p>
      </div>
    );
  }

  const resumo = painel?.resumo || {};
  const radar = painel?.radar || { atrasadas: [], vencendo_hoje: [], proximos_vencimentos: [], quitadas_mes: [] };
  const agendaMes = painel?.agenda_mes || [];
  const estrategia = painel?.estrategia || { bola_de_neve: [], avalanche: [], compromissos_fixos: [] };
  const listaDividas = painel?.dividas || [];
  const parceladasAtivas = listaDividas.filter(
    (d) => d.ativa && d.tipo_compromisso === 'parcelada' && (d.parcelas_restantes || 0) > 0
  );

  const listaRankingEstrategia =
    modoEstrategia === 'bola_de_neve' ? estrategia.bola_de_neve : estrategia.avalanche;

  return (
    <div className="space-y-6">
      {/* Cabeçalho Principal */}
      <div className="page-heading">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--ink)] tracking-tight">
            Dívidas & Estratégia
          </h1>
          <p className="text-[var(--muted)] text-sm mt-0.5">
            Radar de vencimentos por dia, baixa integrada com contas bancárias e simulador inteligente de quitação
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <MesSelector
            mes={mes}
            ano={ano}
            onChange={(novoMes, novoAno) => {
              setMes(novoMes);
              setAno(novoAno);
            }}
          />
          <button
            type="button"
            onClick={() => setModalForm('novo')}
            className="btn-primary text-sm shadow-md shadow-blue-600/20"
          >
            <Plus size={18} /> Nova Dívida / Conta Fixa
          </button>
        </div>
      </div>

      {/* 4 Indicadores Principais */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="card metric-card border border-[var(--line)]" style={{ '--metric': '#2563eb' }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">
              Comprometido no Mês
            </span>
            <div className="metric-icon">
              <CalendarClock size={19} />
            </div>
          </div>
          <div className="text-2xl font-black text-[var(--ink)]">{fmt(resumo.total_comprometido_mes)}</div>
          <p className="text-xs text-[var(--muted)] mt-1">
            Parcelas: {fmt(resumo.comprometimento_parceladas_mes)} • Fixas: {fmt(resumo.comprometimento_fixas_mes)}
          </p>
        </div>

        <div className="card metric-card border border-[var(--line)]" style={{ '--metric': '#d97706' }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">
              Falta Pagar ({MESES_NOMES[mes - 1].slice(0, 3)})
            </span>
            <div className="metric-icon">
              <Clock size={19} />
            </div>
          </div>
          <div className="text-2xl font-black text-amber-500">{fmt(resumo.falta_pagar_mes)}</div>
          <p className="text-xs text-[var(--muted)] mt-1">
            Já pago no mês: <strong className="text-emerald-500">{fmt(resumo.total_pago_mes)}</strong> ({resumo.qtd_quitadas_mes || 0})
          </p>
        </div>

        <div className="card metric-card border border-[var(--line)]" style={{ '--metric': '#6366f1' }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">
              Saldo Devedor Total
            </span>
            <div className="metric-icon">
              <TrendingDown size={19} />
            </div>
          </div>
          <div className="text-2xl font-black text-[var(--ink)]">{fmt(resumo.saldo_devedor_total)}</div>
          <p className="text-xs text-[var(--muted)] mt-1">
            Soma restante de todos os financiamentos ativos
          </p>
        </div>

        <div className="card metric-card border border-[var(--line)]" style={{ '--metric': '#0891b2' }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">
              Alívio Mensal Potencial
            </span>
            <div className="metric-icon">
              <Zap size={19} />
            </div>
          </div>
          <div className="text-2xl font-black text-emerald-500">
            +{fmt(resumo.alivio_potencial_mensal)}
            <span className="text-xs font-bold text-[var(--muted)]">/mês</span>
          </div>
          <p className="text-xs text-[var(--muted)] mt-1">
            Fôlego liberado no orçamento ao quitar parceladas
          </p>
        </div>
      </div>

      {/* Navegação Interna em Abas */}
      <div className="flex flex-wrap gap-2 bg-[var(--surface)] p-1.5 rounded-2xl border border-[var(--line)] shadow-sm">
        <button
          type="button"
          onClick={() => setAbaAtiva('radar')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all ${
            abaAtiva === 'radar'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--raised)]'
          }`}
        >
          <Clock size={16} />
          <span>Radar & Agenda do Mês</span>
          {(resumo.qtd_atrasadas > 0 || resumo.qtd_vencendo_hoje > 0) && (
            <span className="px-2 py-0.5 rounded-full text-[11px] bg-rose-500 text-white font-black">
              {(resumo.qtd_atrasadas || 0) + (resumo.qtd_vencendo_hoje || 0)}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setAbaAtiva('estrategia')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all ${
            abaAtiva === 'estrategia'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--raised)]'
          }`}
        >
          <Sparkles size={16} />
          <span>Estratégia & Simulador</span>
        </button>

        <button
          type="button"
          onClick={() => setAbaAtiva('carteira')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all ${
            abaAtiva === 'carteira'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--raised)]'
          }`}
        >
          <Layers size={16} />
          <span>Todas as Dívidas & Contas Fixas ({listaDividas.length})</span>
        </button>
      </div>

      {/* ESTADO VAZIO INICIAL */}
      {listaDividas.length === 0 && agendaMes.length === 0 ? (
        <div className="card text-center py-14 space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-blue-600/10 text-blue-500 flex items-center justify-center mx-auto">
            <Target size={32} />
          </div>
          <div className="max-w-lg mx-auto space-y-1.5">
            <h3 className="text-lg font-extrabold text-[var(--ink)]">
              Nenhuma dívida ou conta fixa cadastrada ainda
            </h3>
            <p className="text-sm text-[var(--muted)]">
              Cadastre seus financiamentos (ex.: <strong>Carro 18x de R$ 1.500 todo dia 20</strong>) e compromissos mensais
              (ex.: <strong>Condomínio dia 15</strong>, <strong>Moto dia 30</strong>) para ativar o Radar de Vencimentos e o Plano Inteligente de Quitação.
            </p>
          </div>
          <div>
            <button onClick={() => setModalForm('novo')} className="btn-primary text-sm">
              <Plus size={18} /> Cadastrar Primeira Dívida ou Conta Fixa
            </button>
          </div>
        </div>
      ) : null}

      {/* =====================================================================
          ABA 1: RADAR DE VENCIMENTOS & RÉGUA CRONOLÓGICA DO MÊS
         ===================================================================== */}
      {abaAtiva === 'radar' && (listaDividas.length > 0 || agendaMes.length > 0) && (
        <div className="space-y-6">
          {/* 4 Blocos Visuais do Radar */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {/* Atrasadas */}
            <div className="card p-4 border border-[var(--line)] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold uppercase tracking-wider text-rose-500 flex items-center gap-1.5">
                  <AlertTriangle size={15} /> Atrasadas
                </span>
                <span className="badge-red">{radar.atrasadas.length}</span>
              </div>
              {radar.atrasadas.length === 0 ? (
                <p className="text-xs text-[var(--muted)] py-3">Nenhuma conta em atraso. Excelente!</p>
              ) : (
                <div className="space-y-2">
                  {radar.atrasadas.map((it, idx) => (
                    <div key={idx} className="p-2.5 rounded-xl bg-[var(--raised)] border border-[var(--line)] space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-xs text-[var(--ink)] truncate">{it.divida_nome}</span>
                        <span className="font-black text-xs text-rose-500">{fmt(it.valor_atual)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-rose-500 font-semibold">{it.rotulo_vencimento}</span>
                        <button
                          type="button"
                          onClick={() => setModalBaixa(it)}
                          className="px-2 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold"
                        >
                          Dar Baixa
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Vencendo Hoje */}
            <div className="card p-4 border border-[var(--line)] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold uppercase tracking-wider text-amber-500 flex items-center gap-1.5">
                  <Clock size={15} /> Vencendo Hoje
                </span>
                <span className="badge-yellow">{radar.vencendo_hoje.length}</span>
              </div>
              {radar.vencendo_hoje.length === 0 ? (
                <p className="text-xs text-[var(--muted)] py-3">Nenhum compromisso vence hoje.</p>
              ) : (
                <div className="space-y-2">
                  {radar.vencendo_hoje.map((it, idx) => (
                    <div key={idx} className="p-2.5 rounded-xl bg-[var(--raised)] border border-[var(--line)] space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-xs text-[var(--ink)] truncate">{it.divida_nome}</span>
                        <span className="font-black text-xs text-amber-500">{fmt(it.valor_atual)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-amber-500 font-semibold">{it.rotulo_parcela}</span>
                        <button
                          type="button"
                          onClick={() => setModalBaixa(it)}
                          className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 text-[11px] font-extrabold"
                        >
                          Pagar Hoje
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Próximos 15 Dias */}
            <div className="card p-4 border border-[var(--line)] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold uppercase tracking-wider text-blue-500 flex items-center gap-1.5">
                  <CalendarClock size={15} /> Próximos 15 Dias
                </span>
                <span className="badge-blue">{radar.proximos_vencimentos.length}</span>
              </div>
              {radar.proximos_vencimentos.length === 0 ? (
                <p className="text-xs text-[var(--muted)] py-3">Nenhum vencimento nos próximos 15 dias.</p>
              ) : (
                <div className="space-y-2">
                  {radar.proximos_vencimentos.map((it, idx) => (
                    <div key={idx} className="p-2.5 rounded-xl bg-[var(--raised)] border border-[var(--line)] space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-xs text-[var(--ink)] truncate">{it.divida_nome}</span>
                        <span className="font-black text-xs text-[var(--ink)]">{fmt(it.valor_atual)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-blue-500 font-semibold">{it.rotulo_vencimento}</span>
                        <button
                          type="button"
                          onClick={() => setModalBaixa(it)}
                          className="px-2 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold"
                        >
                          Baixar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Quitadas no Mês */}
            <div className="card p-4 border border-[var(--line)] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold uppercase tracking-wider text-emerald-500 flex items-center gap-1.5">
                  <CheckCircle2 size={15} /> Quitadas no Mês
                </span>
                <span className="badge-green">{radar.quitadas_mes.length}</span>
              </div>
              {radar.quitadas_mes.length === 0 ? (
                <p className="text-xs text-[var(--muted)] py-3">Nenhum pagamento baixado em {MESES_NOMES[mes - 1]}.</p>
              ) : (
                <div className="space-y-2">
                  {radar.quitadas_mes.slice(0, 5).map((it, idx) => (
                    <div key={idx} className="p-2.5 rounded-xl bg-[var(--raised)] border border-[var(--line)] flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-bold text-xs text-[var(--ink)] truncate">{it.divida_nome}</p>
                        <p className="text-[10px] text-[var(--muted)] truncate">
                          {it.conta ? `Conta: ${it.conta.nome}` : it.forma_pagamento || 'Pago'}
                        </p>
                      </div>
                      <span className="font-black text-xs text-emerald-500 shrink-0">{fmt(it.valor_efetivo)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Régua / Agenda Mensal Ordenada por Dia de Vencimento */}
          <div className="card border border-[var(--line)] p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-extrabold text-[var(--ink)] text-base">
                  Régua de Vencimentos de {MESES_NOMES[mes - 1]} / {ano}
                </h3>
                <p className="text-xs text-[var(--muted)]">
                  Ordenada cronologicamente pelo dia do mês (ex.: Dia 15 → Dia 20 → Dia 30)
                </p>
              </div>
              <div className="text-xs font-semibold text-[var(--muted)]">
                Total do mês: <strong className="text-[var(--ink)]">{fmt(resumo.total_comprometido_mes)}</strong>
              </div>
            </div>

            {agendaMes.length === 0 ? (
              <p className="text-sm text-[var(--muted)] text-center py-8">
                Nenhum vencimento programado para {MESES_NOMES[mes - 1]}/{ano}.
              </p>
            ) : (
              <div className="space-y-2.5">
                {agendaMes.map((item, idx) => {
                  const badge = describeSituacaoVencimento(item.situacao);
                  return (
                    <div
                      key={`${item.divida_id}_${item.ano}_${item.mes}_${idx}`}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] hover-surface transition-all"
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        <div
                          className="w-12 h-12 rounded-2xl flex flex-col items-center justify-center shrink-0 text-white font-black shadow-sm"
                          style={{ backgroundColor: item.cor || '#2563eb' }}
                        >
                          <span className="text-[9px] uppercase opacity-85 leading-none">Dia</span>
                          <span className="text-base leading-tight">{String(item.dia_vencimento_mes).padStart(2, '0')}</span>
                        </div>

                        <div className="min-w-0 space-y-0.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-extrabold text-[var(--ink)] text-sm sm:text-base">
                              {item.divida_nome}
                            </span>
                            <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-[var(--raised)] text-[var(--muted)] border border-[var(--line)]">
                              {item.rotulo_parcela}
                            </span>
                            <span className={badge.badgeClass}>{badge.label}</span>
                          </div>
                          <p className="text-xs text-[var(--muted)] flex flex-wrap items-center gap-2">
                            <span>{item.rotulo_vencimento}</span>
                            {item.credor && <span>• {item.credor}</span>}
                            {item.status === 'pago' && item.conta && (
                              <span className="text-emerald-600 font-semibold">
                                • Debitado de {item.conta.nome}
                              </span>
                            )}
                            {item.status === 'pago' && !item.conta && (
                              <span className="text-[var(--muted)]">
                                • {item.forma_pagamento || 'Pago externamente'}
                              </span>
                            )}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-[var(--line)]">
                        <div className="text-left sm:text-right">
                          <span className="text-base font-black text-[var(--ink)] block">
                            {fmt(item.valor_efetivo)}
                          </span>
                          {item.desconto > 0 && (
                            <span className="text-[11px] text-emerald-500 font-bold">
                              Economizou {fmt(item.desconto)}
                            </span>
                          )}
                        </div>

                        {item.status === 'pendente' ? (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setModalAjuste(item)}
                              className="btn-secondary text-xs py-2 px-2.5"
                              title="Ajustar valor desta competência no mês"
                            >
                              <SlidersHorizontal size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setModalBaixa(item)}
                              className="btn-success text-xs py-2 px-3.5"
                            >
                              <CheckCircle2 size={15} /> Dar Baixa
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleEstornar(item)}
                            className="btn-secondary text-xs py-2 px-3 text-red-600"
                            title="Desfazer pagamento e estornar lançamento bancário se houver"
                          >
                            <RotateCcw size={14} /> Estornar
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          ABA 2: ESTRATÉGIA DE QUITAÇÃO & SIMULADOR DE ANTECIPAÇÃO
         ===================================================================== */}
      {abaAtiva === 'estrategia' && (
        <div className="space-y-6">
          {/* Recomendação Inteligente */}
          {estrategia.recomendacao ? (
            <div className="summary-banner rounded-3xl p-6 shadow-lg space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="p-2 rounded-xl bg-blue-500/20 text-blue-300">
                    <Sparkles size={20} />
                  </span>
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-blue-300 block">
                      Plano de Ataque Recomendado
                    </span>
                    <h3 className="text-lg sm:text-xl font-extrabold text-white">
                      Qual dívida atacar primeiro?
                    </h3>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-xs text-slate-300 block">Alívio total ao zerar financiamentos</span>
                  <strong className="text-lg font-black text-emerald-400">
                    +{fmt(estrategia.alivio_total_parceladas)}/mês livres
                  </strong>
                </div>
              </div>
              <p className="text-sm text-slate-200 leading-relaxed">
                {estrategia.recomendacao.resumo}
              </p>
            </div>
          ) : (
            <div className="card border border-[var(--line)] p-6 text-center space-y-2">
              <p className="font-bold text-[var(--ink)]">
                Cadastre ao menos uma dívida parcelada para comparar estratégias de quitação
              </p>
              <p className="text-xs text-[var(--muted)]">
                Contas fixas contínuas aparecem no resumo de comprometimento fixo abaixo.
              </p>
            </div>
          )}

          {/* Comparativo Avalanche / Maior Alívio vs Bola de Neve */}
          {parceladasAtivas.length > 0 && (
            <div className="card border border-[var(--line)] p-6 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-extrabold text-[var(--ink)] text-base">
                    Ordem Prioritária de Quitação
                  </h3>
                  <p className="text-xs text-[var(--muted)]">
                    Compare qual dívida libera mais fôlego mensal vs qual você elimina mais rápido
                  </p>
                </div>

                <div className="flex bg-[var(--canvas)] p-1 rounded-xl border border-[var(--line)] gap-1 text-xs">
                  <button
                    type="button"
                    onClick={() => selecionarModoEstrategia('avalanche')}
                    className={`px-3 py-2 rounded-lg font-bold flex items-center gap-1.5 transition-all ${
                      modoEstrategia === 'avalanche'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-[var(--muted)] hover:text-[var(--ink)]'
                    }`}
                  >
                    <Flame size={14} /> Maior Alívio Mensal / Avalanche
                  </button>
                  <button
                    type="button"
                    onClick={() => selecionarModoEstrategia('bola_de_neve')}
                    className={`px-3 py-2 rounded-lg font-bold flex items-center gap-1.5 transition-all ${
                      modoEstrategia === 'bola_de_neve'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-[var(--muted)] hover:text-[var(--ink)]'
                    }`}
                  >
                    <Snowflake size={14} /> Bola de Neve (Menor Saldo)
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {listaRankingEstrategia.map((alvo) => {
                  const divObj = listaDividas.find((d) => d.id === alvo.divida_id);
                  return (
                    <div
                      key={alvo.divida_id}
                      className="p-4 rounded-2xl border border-[var(--line)] bg-[var(--raised)] flex flex-col justify-between gap-3"
                    >
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2.5">
                            <span
                              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black shrink-0 ${
                                alvo.ordem === 1
                                  ? 'bg-amber-500 text-slate-950'
                                  : 'bg-[var(--surface)] text-[var(--ink)] border border-[var(--line)]'
                              }`}
                            >
                              {alvo.ordem}º
                            </span>
                            <div>
                              <h4 className="font-extrabold text-[var(--ink)] text-base leading-tight">
                                {alvo.nome}
                              </h4>
                              <p className="text-[11px] text-[var(--muted)]">{alvo.motivo_prioridade}</p>
                            </div>
                          </div>

                          <span className="badge-green shrink-0">
                            Libera +{fmt(alvo.alivio_mensal)}/mês
                          </span>
                        </div>

                        <div className="w-full h-2 rounded-full bg-[var(--surface)] overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${Math.min(100, Math.max(4, alvo.progresso_pct || 0))}%`,
                              backgroundColor: alvo.cor || '#2563eb',
                            }}
                          />
                        </div>

                        <div className="grid grid-cols-3 gap-2 pt-1 text-xs">
                          <div>
                            <span className="text-[var(--muted)] block text-[11px]">Saldo Restante</span>
                            <strong className="text-[var(--ink)] font-black">{fmt(alvo.saldo_restante)}</strong>
                          </div>
                          <div>
                            <span className="text-[var(--muted)] block text-[11px]">Faltam</span>
                            <strong className="text-[var(--ink)] font-bold">
                              {alvo.parcelas_restantes}/{alvo.total_parcelas} parcelas
                            </strong>
                          </div>
                          <div>
                            <span className="text-[var(--muted)] block text-[11px]">Término Atual</span>
                            <strong className="text-[var(--ink)] font-bold">{alvo.previsao_termino}</strong>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-[var(--line)]">
                        <span className="text-[11px] font-semibold text-blue-500">
                          Alívio acumulado após quitar: +{fmt(alvo.alivio_acumulado_apos_quitar)}/mês
                        </span>
                        {divObj && (
                          <button
                            type="button"
                            onClick={() => setModalAntecipar({ divida: divObj, qtdInicial: 1 })}
                            className="btn-primary text-xs py-1.5 px-3"
                          >
                            <FastForward size={14} /> Antecipar Parcelas
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Simulador Interativo de Antecipação & Aporte Extra */}
          {parceladasAtivas.length > 0 && (
            <div className="card border border-[var(--line)] p-6 space-y-5">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-blue-600/10 text-blue-500 flex items-center justify-center">
                  <Calculator size={20} />
                </div>
                <div>
                  <h3 className="font-extrabold text-[var(--ink)] text-base">
                    Simulador de Antecipação & Aporte Extra
                  </h3>
                  <p className="text-xs text-[var(--muted)]">
                    Descubra quantas parcelas você elimina e quantos meses antes fica livre das dívidas
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 p-4 rounded-2xl bg-[var(--raised)] border border-[var(--line)]">
                <div>
                  <label className="label">Método da Estratégia</label>
                  <select
                    className="input font-semibold"
                    value={simForm.estrategia}
                    onChange={(e) => selecionarModoEstrategia(e.target.value)}
                  >
                    <option value="avalanche">Avalanche / Maior Alívio</option>
                    <option value="bola_de_neve">Bola de Neve (Menor Saldo)</option>
                  </select>
                </div>

                <div>
                  <label className="label">Aporte Pontual (Ex.: 13º / Reserva)</label>
                  <input
                    type="number"
                    step="50"
                    min="0"
                    className="input font-bold"
                    placeholder="R$ 0,00"
                    value={simForm.aporte_unico}
                    onChange={(e) => setSimForm({ ...simForm, aporte_unico: e.target.value })}
                  />
                </div>

                <div>
                  <label className="label">Extra por Mês p/ Abater (R$)</label>
                  <input
                    type="number"
                    step="50"
                    min="0"
                    className="input font-bold"
                    placeholder="R$ 300,00"
                    value={simForm.aporte_mensal_extra}
                    onChange={(e) => setSimForm({ ...simForm, aporte_mensal_extra: e.target.value })}
                  />
                </div>

                <div>
                  <label className="label">Simular Dívida Alvo</label>
                  <select
                    className="input"
                    value={simForm.divida_alvo_id}
                    onChange={(e) => setSimForm({ ...simForm, divida_alvo_id: e.target.value })}
                  >
                    <option value="">Automático (1ª da Estratégia)</option>
                    {parceladasAtivas.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.nome} ({d.parcelas_restantes}x de {fmt(d.valor_parcela)})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => executarSimulacao()}
                    disabled={simulando}
                    className="btn-primary w-full py-2.5 text-xs font-bold"
                  >
                    <Calculator size={15} /> {simulando ? 'Calculando...' : 'Simular Impacto'}
                  </button>
                </div>
              </div>

              <label className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--muted)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={simForm.reinvestir_alivio}
                  onChange={(e) => {
                    const next = { ...simForm, reinvestir_alivio: e.target.checked };
                    setSimForm(next);
                    executarSimulacao(next);
                  }}
                />
                <span>
                  Ativar Efeito Cascata (quando uma dívida acaba, usar o valor da parcela dela para acelerar a próxima)
                </span>
              </label>

              {simResultado?.possui_dividas_parceladas && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-2">
                  {/* Resultado Global */}
                  <div className="p-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] space-y-3">
                    <h4 className="font-extrabold text-sm text-[var(--ink)]">
                      Resultado do Plano Acelerado
                    </h4>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div className="p-3 rounded-xl bg-[var(--raised)]">
                        <span className="text-[var(--muted)] block">Prazo Normal</span>
                        <strong className="text-base font-black text-[var(--ink)]">
                          {simResultado.meses_cronograma_atual} meses
                        </strong>
                        <span className="block text-[11px] text-[var(--muted)]">
                          Até {simResultado.data_quitacao_atual}
                        </span>
                      </div>
                      <div className="p-3 rounded-xl bg-[var(--raised)] border border-emerald-500/30">
                        <span className="text-emerald-500 font-bold block">Com Estratégia</span>
                        <strong className="text-base font-black text-emerald-500">
                          {simResultado.meses_plano_acelerado} meses
                        </strong>
                        <span className="block text-[11px] text-[var(--muted)]">
                          Livre em {simResultado.data_quitacao_acelerada}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs pt-2 border-t border-[var(--line)]">
                      <span className="font-bold text-blue-500">
                        Tempo ganho: {simResultado.meses_economizados} mês(es) a menos!
                      </span>
                      {simResultado.economia_estimada > 0 && (
                        <span className="font-extrabold text-emerald-500">
                          Descontos estimados: {fmt(simResultado.economia_estimada)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Impacto Pontual na Dívida Escolhida */}
                  {simResultado.simulacao_alvo && (
                    <div className="p-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] flex flex-col justify-between gap-3">
                      <div className="space-y-2">
                        <h4 className="font-extrabold text-sm text-[var(--ink)]">
                          Antecipação Direta em: {simResultado.simulacao_alvo.divida_nome}
                        </h4>
                        <p className="text-xs text-[var(--muted)]">
                          Com <strong>{fmt(simResultado.simulacao_alvo.orcamento_usado_base)}</strong> hoje, você consegue quitar{' '}
                          <strong className="text-[var(--ink)]">
                            {simResultado.simulacao_alvo.parcelas_que_abate} parcela(s) final(is)
                          </strong>{' '}
                          de trás para frente (restarão {simResultado.simulacao_alvo.parcelas_restantes_apos}).
                        </p>
                        {simResultado.simulacao_alvo.economia_direta > 0 && (
                          <p className="text-xs font-bold text-emerald-500">
                            Economia direta estimada: {fmt(simResultado.simulacao_alvo.economia_direta)}
                          </p>
                        )}
                      </div>

                      {simResultado.simulacao_alvo.parcelas_que_abate > 0 && (
                        <div className="flex justify-end pt-2 border-t border-[var(--line)]">
                          <button
                            type="button"
                            onClick={() => {
                              const alvo = listaDividas.find(
                                (d) => d.id === simResultado.simulacao_alvo.divida_id
                              );
                              if (alvo) {
                                setModalAntecipar({
                                  divida: alvo,
                                  qtdInicial: simResultado.simulacao_alvo.parcelas_que_abate,
                                });
                              }
                            }}
                            className="btn-primary text-xs py-2 px-3.5"
                          >
                            <FastForward size={14} /> Executar Antecipação de{' '}
                            {simResultado.simulacao_alvo.parcelas_que_abate}x Agora
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Compromissos Fixos Recorrentes */}
          {estrategia.compromissos_fixos?.length > 0 && (
            <div className="card border border-[var(--line)] p-6 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-extrabold text-[var(--ink)] text-base">
                    Compromissos Fixos Mensais (Custo Recorrente)
                  </h3>
                  <p className="text-xs text-[var(--muted)]">
                    Contas contínuas que exigem reserva mensal fixa no orçamento
                  </p>
                </div>
                <strong className="text-sm font-black text-[var(--ink)]">
                  {fmt(estrategia.custo_fixo_mensal)}/mês
                </strong>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {estrategia.compromissos_fixos.map((f) => (
                  <div
                    key={f.divida_id}
                    className="p-3.5 rounded-xl border border-[var(--line)] bg-[var(--raised)] flex items-center justify-between"
                  >
                    <div>
                      <p className="font-bold text-sm text-[var(--ink)]">{f.nome}</p>
                      <p className="text-xs text-[var(--muted)]">Todo dia {String(f.dia_vencimento).padStart(2, '0')}</p>
                    </div>
                    <span className="font-black text-sm text-[var(--ink)]">{fmt(f.valor_mensal)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          ABA 3: CARTEIRA COMPLETA DE DÍVIDAS PARCELADAS & CONTAS FIXAS
         ===================================================================== */}
      {abaAtiva === 'carteira' && listaDividas.length > 0 && (
        <div className="space-y-4">
          {listaDividas.map((d) => {
            const isExpanded = expandedDividaId === d.id;
            const isParc = d.tipo_compromisso === 'parcelada';
            return (
              <div key={d.id} className="card p-0 overflow-hidden border border-[var(--line)]">
                <div className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div className="flex items-start sm:items-center gap-3.5 min-w-0">
                    <div
                      className="w-12 h-12 rounded-2xl flex flex-col items-center justify-center text-white font-black shrink-0 shadow-sm"
                      style={{ backgroundColor: d.cor || '#2563eb' }}
                    >
                      <span className="text-[9px] uppercase opacity-85 leading-none">Dia</span>
                      <span className="text-base leading-tight">{String(d.dia_vencimento).padStart(2, '0')}</span>
                    </div>

                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-extrabold text-[var(--ink)] text-base sm:text-lg">
                          {d.nome}
                        </h3>
                        <span className={isParc ? 'badge-blue' : 'badge-yellow'}>
                          {isParc ? `${d.total_parcelas}x Parcelada` : 'Fixa Mensal'}
                        </span>
                        {d.quitada_total && <span className="badge-green">100% Quitada ✓</span>}
                      </div>

                      <p className="text-xs text-[var(--muted)]">
                        {d.categoria}
                        {d.credor ? ` • ${d.credor}` : ''} • Parcela base: <strong>{fmt(d.valor_parcela)}</strong> • Todo dia{' '}
                        <strong>{d.dia_vencimento}</strong>
                        {isParc ? ` • Término: ${d.previsao_termino}` : ''}
                      </p>

                      {isParc && (
                        <div className="flex items-center gap-3 pt-1 max-w-md">
                          <div className="flex-1 h-2 rounded-full bg-[var(--raised)] overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.min(100, d.progresso_pct || 0)}%`,
                                backgroundColor: d.cor || '#2563eb',
                              }}
                            />
                          </div>
                          <span className="text-[11px] font-bold text-[var(--muted)] shrink-0">
                            {d.parcelas_pagas}/{d.total_parcelas} pagas ({d.progresso_pct}%)
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between lg:justify-end gap-3 pt-3 lg:pt-0 border-t lg:border-t-0 border-[var(--line)]">
                    {isParc && (
                      <div className="text-left lg:text-right mr-2">
                        <span className="text-[11px] text-[var(--muted)] block">Saldo Devedor</span>
                        <strong className="text-lg font-black text-[var(--ink)]">
                          {fmt(d.saldo_restante)}
                        </strong>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-1.5">
                      {isParc && !d.quitada_total && (
                        <button
                          type="button"
                          onClick={() => setModalAntecipar({ divida: d, qtdInicial: 1 })}
                          className="btn-primary text-xs py-2 px-3"
                        >
                          <FastForward size={14} /> Antecipar
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => setModalForm(d)}
                        className="btn-secondary text-xs py-2 px-2.5"
                        title="Editar cadastro"
                      >
                        <Edit3 size={14} />
                      </button>

                      {!isParc && d.ativa && (
                        <button
                          type="button"
                          onClick={() => handleEncerrarRecorrencia(d)}
                          className="btn-secondary text-xs py-2 px-2.5"
                          title="Encerrar próximas cobranças mensais preservando histórico"
                        >
                          <Archive size={14} />
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => handleExcluirDivida(d)}
                        className="btn-secondary text-xs py-2 px-2.5 text-red-600"
                        title="Excluir dívida"
                      >
                        <Trash2 size={14} />
                      </button>

                      <button
                        type="button"
                        onClick={() => setExpandedDividaId(isExpanded ? null : d.id)}
                        className="btn-secondary text-xs py-2 px-3"
                      >
                        {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                        <span>Parcelas</span>
                      </button>
                    </div>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-[var(--line)] bg-[var(--raised)] p-4 space-y-2 max-h-96 overflow-y-auto">
                    {(d.parcelas || []).map((p, idx) => (
                      <div
                        key={`${p.ano}_${p.mes}_${p.numero}_${idx}`}
                        className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-xs"
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="font-extrabold text-[var(--ink)]">{p.rotulo_parcela}</span>
                          <span className="text-[var(--muted)]">
                            Venc.: {new Date(`${p.vencimento}T00:00:00`).toLocaleDateString('pt-BR')}
                          </span>
                          <span className={describeSituacaoVencimento(p.situacao).badgeClass}>
                            {p.pago_anteriormente
                              ? 'Paga antes do cadastro'
                              : p.antecipada
                                ? 'Antecipada ✓'
                                : describeSituacaoVencimento(p.situacao).label}
                          </span>
                          {p.conta && (
                            <span className="text-emerald-600 font-semibold">• {p.conta.nome}</span>
                          )}
                        </div>

                        <div className="flex items-center gap-2.5">
                          <strong className="font-black text-sm text-[var(--ink)]">
                            {fmt(p.valor_efetivo)}
                          </strong>
                          {p.status === 'pendente' ? (
                            <button
                              type="button"
                              onClick={() => setModalBaixa(p)}
                              className="btn-success text-[11px] py-1 px-2.5"
                            >
                              Baixar
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleEstornar(p)}
                              className="btn-secondary text-[11px] py-1 px-2.5 text-red-600"
                            >
                              Estornar
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modais */}
      {modalForm && (
        <ModalFormDivida
          dividaEdit={modalForm === 'novo' ? null : modalForm}
          contas={contas}
          modulos={modulos}
          mesAtual={mes}
          anoAtual={ano}
          onClose={() => setModalForm(null)}
          onSaved={carregarTudo}
        />
      )}

      {modalBaixa && (
        <ModalBaixaPagamento
          item={modalBaixa}
          contas={contas}
          onClose={() => setModalBaixa(null)}
          onSaved={carregarTudo}
        />
      )}

      {modalAntecipar && (
        <ModalAnteciparParcelas
          divida={modalAntecipar.divida}
          qtdInicial={modalAntecipar.qtdInicial}
          contas={contas}
          onClose={() => setModalAntecipar(null)}
          onSaved={carregarTudo}
        />
      )}

      {modalAjuste && (
        <ModalAjustarMes
          item={modalAjuste}
          onClose={() => setModalAjuste(null)}
          onSaved={carregarTudo}
        />
      )}
    </div>
  );
}
