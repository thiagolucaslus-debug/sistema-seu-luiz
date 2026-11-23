import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { relatorios } from '../api/client';
import {
  TrendingUp, Users, Wallet, CalendarClock,
  ChevronRight, ArrowUpRight, Trophy, Flame, Target
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, CartesianGrid
} from 'recharts';
import Avatar from '../components/Avatar';
import CardArtwork from '../components/CardArtwork';
import { getCardBrand } from '../components/cardBrand';

function fmt(val) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);
}

function MesSelector({ mes, ano, onChange }) {
  const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  return (
    <div className="flex items-center gap-2 bg-[var(--surface)] p-1.5 rounded-xl border border-[var(--line)] shadow-sm">
      <select
        className="text-sm font-semibold text-[var(--ink)] bg-[var(--surface)] px-2 py-1 outline-none cursor-pointer rounded-lg border border-transparent focus:border-[var(--accent)]"
        value={mes}
        onChange={e => onChange(Number(e.target.value), ano)}
      >
        {meses.map((m, i) => (
          <option key={i} value={i+1} className="bg-[var(--surface)] text-[var(--ink)]">
            {m}
          </option>
        ))}
      </select>
      <span className="text-[var(--muted)]">/</span>
      <select
        className="text-sm font-semibold text-[var(--ink)] bg-[var(--surface)] px-2 py-1 outline-none cursor-pointer rounded-lg border border-transparent focus:border-[var(--accent)]"
        value={ano}
        onChange={e => onChange(mes, Number(e.target.value))}
      >
        {[2024, 2025, 2026, 2027, 2028].map(a => (
          <option key={a} value={a} className="bg-[var(--surface)] text-[var(--ink)]">
            {a}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function Dashboard() {
  const hoje = new Date();
  const [mes, setMes] = useState(hoje.getMonth() + 1);
  const [ano, setAno] = useState(hoje.getFullYear());
  const [dados, setDados] = useState(null);
  const [loading, setLoading] = useState(true);
  const [graficoTipo, setGraficoTipo] = useState('pessoas');
  const [rankingTipo, setRankingTipo] = useState('devedores'); // 'devedores', 'mais_usou', 'quitacao'

  const carregar = async () => {
    setLoading(true);
    try {
      const res = await relatorios.dashboard(mes, ano);
      setDados(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregar();
  }, [mes, ano]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-3">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-[var(--muted)] text-sm">Carregando painel financeiro...</p>
      </div>
    );
  }

  if (!dados) {
    return (
      <div className="card text-center py-12 space-y-3">
        <p className="text-[var(--muted)]">Não foi possível carregar as métricas do painel.</p>
        <button onClick={carregar} className="btn-secondary">Tentar novamente</button>
      </div>
    );
  }

  const dadosGrafico = graficoTipo === 'pessoas'
    ? dados.pessoas.map(p => ({ nome: p.nome, valor: p.gastos_mes, cor: p.cor, foto_path: p.foto_path }))
    : graficoTipo === 'cartoes'
      ? dados.cartoes.map(c => ({ nome: c.nome, valor: c.total, cor: getCardBrand(c.nome, c.cor).color, bandeira: c.bandeira }))
      : dados.modulos.map(m => ({ nome: m.nome, valor: m.total, cor: m.cor, icone: m.icone, foto_path: m.foto_path }));
  const gastosComValor = dadosGrafico.filter(d => d.valor > 0);

  // Rankings Ordenados
  const listaRanking = rankingTipo === 'devedores'
    ? (dados.quem_mais_deve || dados.pessoas.filter(p => p.saldo_devedor > 0).sort((a,b) => b.saldo_devedor - a.saldo_devedor))
    : rankingTipo === 'mais_usou'
      ? (dados.quem_mais_usou || dados.pessoas.filter(p => p.gastos_mes > 0).sort((a,b) => b.gastos_mes - a.gastos_mes))
      : (dados.perto_da_quitacao || dados.pessoas.filter(p => p.saldo_devedor > 0).sort((a,b) => a.saldo_devedor - b.saldo_devedor));

  return (
    <div className="space-y-6">
      {/* Header com Boas-vindas e Seletor de Período */}
      <div className="page-heading">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--ink)] tracking-tight">Visão Geral</h1>
          <p className="text-[var(--muted)] text-sm mt-0.5">Resumo financeiro e acompanhamento de gastos</p>
        </div>
        <MesSelector mes={mes} ano={ano} onChange={(m, a) => { setMes(m); setAno(a); }} />
      </div>

      {/* 4 Cards de Resumo Principal (TODOS CLICÁVEIS) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* Card 1: Gastos do Mês -> Leva para Cartões */}
        <Link
          to="/cartoes"
          className="card metric-card hover:scale-[1.02] hover:shadow-xl transition-all duration-200 cursor-pointer block border border-[var(--line)] group"
          style={{ '--metric': '#2563eb' }}
          title="Clique para ver os cartões e faturas detalhadas"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">Gastos do Mês</span>
            <div className="metric-icon group-hover:scale-110 transition-transform">
              <TrendingUp size={20} />
            </div>
          </div>
          <div className="text-2xl font-black text-[var(--ink)] tracking-tight">{fmt(dados.total_gastos_mes)}</div>
          <p className="text-xs text-[var(--muted)] mt-1 flex items-center justify-between">
            <span>Faturas somadas</span>
            <span className="text-blue-500 font-bold group-hover:translate-x-1 transition-transform inline-flex items-center">
              Ver faturas <ArrowUpRight size={13} />
            </span>
          </p>
        </Link>

        {/* Card 2: Valores a Receber -> Leva para Pessoas */}
        <Link
          to="/pessoas"
          className="card metric-card hover:scale-[1.02] hover:shadow-xl transition-all duration-200 cursor-pointer block border border-[var(--line)] group"
          style={{ '--metric': '#0891b2' }}
          title="Clique para ver quem deve e os fechamentos de pessoas"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">Valores a Receber</span>
            <div className="metric-icon group-hover:scale-110 transition-transform">
              <Users size={20} />
            </div>
          </div>
          <div className={`text-2xl font-black tracking-tight ${dados.total_a_receber > 0 ? 'text-emerald-500' : 'text-[var(--ink)]'}`}>
            {fmt(dados.total_a_receber)}
          </div>
          <p className="text-xs text-[var(--muted)] mt-1 flex items-center justify-between">
            <span>Pendente de pessoas</span>
            <span className="text-emerald-500 font-bold group-hover:translate-x-1 transition-transform inline-flex items-center">
              Ver pessoas <ArrowUpRight size={13} />
            </span>
          </p>
        </Link>

        {/* Card 3: Saldo em Contas -> Leva para Contas Bancárias */}
        <Link
          to="/contas"
          className="card metric-card hover:scale-[1.02] hover:shadow-xl transition-all duration-200 cursor-pointer block border border-[var(--line)] group"
          style={{ '--metric': '#6366f1' }}
          title="Clique para ver extrato e saldo das contas bancárias"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">Saldo em Contas</span>
            <div className="metric-icon group-hover:scale-110 transition-transform">
              <Wallet size={20} />
            </div>
          </div>
          <div className={`text-2xl font-black tracking-tight ${dados.saldo_total_contas >= 0 ? 'text-[var(--ink)]' : 'text-rose-500'}`}>
            {fmt(dados.saldo_total_contas)}
          </div>
          <p className="text-xs text-[var(--muted)] mt-1 flex items-center justify-between">
            <span>Contas e carteiras</span>
            <span className="text-indigo-500 font-bold group-hover:translate-x-1 transition-transform inline-flex items-center">
              Ver contas <ArrowUpRight size={13} />
            </span>
          </p>
          {((dados.total_receitas_mes || 0) > 0 || (dados.total_despesas_contas_mes || 0) > 0) && (
            <p className="text-[11px] mt-1.5 flex items-center gap-2 font-semibold">
              <span className="text-emerald-500">+{fmt(dados.total_receitas_mes || 0)}</span>
              <span className="text-[var(--muted)]">·</span>
              <span className="text-rose-500">-{fmt(dados.total_despesas_contas_mes || 0)}</span>
            </p>
          )}
        </Link>

        {/* Card 4: Próximo Mês -> Leva para Relatórios & Planejamento */}
        <Link
          to="/relatorios"
          className="card metric-card hover:scale-[1.02] hover:shadow-xl transition-all duration-200 cursor-pointer block border border-[var(--line)] group"
          style={{ '--metric': '#d97706' }}
          title="Clique para ver o calendário de parcelas futuras"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">Próximo Mês</span>
            <div className="metric-icon group-hover:scale-110 transition-transform">
              <CalendarClock size={20} />
            </div>
          </div>
          <div className="text-2xl font-black text-amber-500 tracking-tight">
            {fmt(dados.proximas_parcelas?.[0]?.total || 0)}
          </div>
          <p className="text-xs text-[var(--muted)] mt-1 flex items-center justify-between">
            <span>Parcelas já contratadas</span>
            <span className="text-amber-500 font-bold group-hover:translate-x-1 transition-transform inline-flex items-center">
              Planejamento <ArrowUpRight size={13} />
            </span>
          </p>
        </Link>
      </div>

      {/* Gráficos Interativos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Evolução Mensal */}
        <div className="card border border-[var(--line)]">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-[var(--ink)] text-base">Evolução Mensal de Gastos</h3>
              <p className="text-xs text-[var(--muted)]">Últimos 6 meses de movimentação</p>
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dados.evolucao_mensal} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                <XAxis dataKey="nome" tick={{ fontSize: '0.7rem', fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                <YAxis width={78} tick={{ fontSize: '0.7rem', fill: 'var(--muted)' }} axisLine={false} tickLine={false}
                  tickFormatter={v => `R$ ${v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`} />
                <Tooltip
                  formatter={v => [fmt(v), 'Total']}
                  contentStyle={{ backgroundColor: '#1a202b', border: '1px solid #343e4d', borderRadius: '12px', color: '#fff', fontSize: '12px' }}
                />
                <Bar dataKey="total" fill="var(--accent)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Distribuição por Categoria com Legenda Customizada */}
        <div className="card border border-[var(--line)] flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div>
                <h3 className="font-bold text-[var(--ink)] text-base">Distribuição de Gastos</h3>
                <p className="text-xs text-[var(--muted)]">Proporção no mês selecionado</p>
              </div>
              <div className="flex bg-[var(--canvas)] p-1 rounded-lg border border-[var(--line)]">
                {['pessoas', 'cartoes', 'modulos'].map(tipo => (
                  <button
                    key={tipo}
                    onClick={() => setGraficoTipo(tipo)}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${
                      graficoTipo === tipo
                        ? 'bg-[var(--surface)] text-blue-500 shadow-sm'
                        : 'text-[var(--muted)] hover:text-[var(--ink)]'
                    }`}
                  >
                    {tipo === 'pessoas' ? 'Pessoas' : tipo === 'cartoes' ? 'Cartões' : 'Módulos'}
                  </button>
                ))}
              </div>
            </div>

            <div className="h-56 flex items-center justify-center">
              {gastosComValor.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={gastosComValor}
                      dataKey="valor"
                      nameKey="nome"
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={3}
                    >
                      {gastosComValor.map((entry, index) => (
                        <Cell key={index} fill={entry.cor || `hsl(${index * 55}, 70%, 50%)`} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={v => [fmt(v), 'Gasto']}
                      contentStyle={{ backgroundColor: '#1a202b', border: '1px solid #343e4d', borderRadius: '12px', color: '#fff', fontSize: '12px' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-center text-[var(--muted)] text-sm">
                  Nenhum gasto registrado nesta categoria para {mes}/{ano}.
                </div>
              )}
            </div>
          </div>

          {/* Legenda Customizada: Nome em BRANCO + Foto/Avatar/Logo */}
          {gastosComValor.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-2 pt-3 border-t border-[var(--line)]">
              {gastosComValor.map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--raised)] border border-[var(--line)] shadow-sm"
                >
                  {graficoTipo === 'pessoas' ? (
                    <Avatar nome={item.nome} foto={item.foto_path} cor={item.cor} className="w-4 h-4 text-[9px] shrink-0" />
                  ) : (
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.cor }} />
                  )}
                  <span className="text-xs font-semibold text-[var(--ink)]">{item.nome}</span>
                  <span className="text-[11px] text-[var(--muted)] font-medium">({fmt(item.valor)})</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* RANKINGS ORDENADOS DA VISÃO GERAL */}
      <div className="card border border-[var(--line)] p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="font-bold text-[var(--ink)] text-base flex items-center gap-2">
              <Trophy size={18} className="text-amber-500" /> Rankings e Indicadores do Mês
            </h3>
            <p className="text-xs text-[var(--muted)]">Visão ordenada por comportamento financeiro</p>
          </div>

          {/* Seletor de Ranking */}
          <div className="flex flex-wrap bg-[var(--canvas)] p-1 rounded-xl border border-[var(--line)] gap-1 text-xs">
            <button
              onClick={() => setRankingTipo('devedores')}
              className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition-all ${
                rankingTipo === 'devedores'
                  ? 'bg-rose-500 text-white shadow-sm'
                  : 'text-[var(--muted)] hover:text-[var(--ink)]'
              }`}
            >
              <Flame size={14} /> Quem Mais Deve
            </button>
            <button
              onClick={() => setRankingTipo('mais_usou')}
              className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition-all ${
                rankingTipo === 'mais_usou'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-[var(--muted)] hover:text-[var(--ink)]'
              }`}
            >
              💳 Quem Mais Usou no Mês
            </button>
            <button
              onClick={() => setRankingTipo('quitacao')}
              className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition-all ${
                rankingTipo === 'quitacao'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-[var(--muted)] hover:text-[var(--ink)]'
              }`}
            >
              <Target size={14} /> Perto da Quitação
            </button>
          </div>
        </div>

        {/* Lista Ordenada */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {listaRanking.length === 0 ? (
            <p className="text-sm text-[var(--muted)] text-center py-6 col-span-3">
              Nenhuma pessoa se enquadra neste ranking no momento.
            </p>
          ) : (
            listaRanking.map((p, idx) => {
              const valorExibido = rankingTipo === 'mais_usou' ? p.gastos_mes : p.saldo_devedor;
              const subtexto = rankingTipo === 'mais_usou'
                ? `Compras neste mês: ${fmt(p.gastos_mes)}`
                : rankingTipo === 'quitacao'
                  ? `Falta apenas ${fmt(p.saldo_devedor)} para quitar!`
                  : `Dívida pendente total: ${fmt(p.saldo_devedor)}`;

              return (
                <Link
                  key={p.id}
                  to="/pessoas"
                  className="flex items-center justify-between p-3.5 rounded-2xl bg-[var(--surface)] border border-[var(--line)] hover-surface hover:scale-[1.01] transition-all group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black shrink-0 ${
                      idx === 0 ? 'bg-amber-500 text-black' : idx === 1 ? 'bg-slate-300 text-black' : idx === 2 ? 'bg-amber-700 text-white' : 'bg-[var(--canvas)] text-[var(--muted)]'
                    }`}>
                      {idx + 1}º
                    </span>

                    <Avatar nome={p.nome} foto={p.foto_path} cor={p.cor} className="w-9 h-9 text-xs shrink-0" />

                    <div className="min-w-0">
                      <p className="font-extrabold text-[var(--ink)] text-sm truncate">{p.nome}</p>
                      <p className="text-[11px] text-[var(--muted)] truncate">{subtexto}</p>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <span className={`text-sm font-black block ${
                      rankingTipo === 'quitacao' ? 'text-emerald-500' : rankingTipo === 'mais_usou' ? 'text-blue-500' : 'text-rose-500'
                    }`}>
                      {fmt(valorExibido)}
                    </span>
                    <span className="text-[10px] text-[var(--muted)] group-hover:text-blue-500 transition-colors">
                      Ver fechamento →
                    </span>
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </div>

      {/* Pessoas Devedoras & Faturas dos Cartões */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Painel de Pessoas */}
        <div className="card border border-[var(--line)]">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-[var(--ink)] text-base">Quem Deve Quanto (Pessoas)</h3>
              <p className="text-xs text-[var(--muted)]">Controle individual de saldos</p>
            </div>
            <Link to="/pessoas" className="text-xs font-bold text-blue-500 hover:underline flex items-center gap-1">
              Ver Todos <ChevronRight size={14} />
            </Link>
          </div>

          <div className="space-y-2.5">
            {dados.pessoas.length === 0 ? (
              <p className="text-sm text-[var(--muted)] text-center py-6">Nenhuma pessoa cadastrada ainda.</p>
            ) : (
              dados.pessoas.map(p => (
                <Link
                  key={p.id}
                  to="/pessoas"
                  className="flex items-center justify-between p-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] hover-surface transition-all"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar nome={p.nome} foto={p.foto_path} cor={p.cor} className="w-8 h-8 text-xs shrink-0" />
                    <div className="min-w-0">
                      <p className="font-semibold text-[var(--ink)] text-sm truncate">{p.nome}</p>
                      <p className="text-xs text-[var(--muted)]">Gastou {fmt(p.gastos_mes)} neste mês</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    {p.saldo_devedor > 0 ? (
                      <span className="badge-red text-xs">Deve {fmt(p.saldo_devedor)}</span>
                    ) : p.credito_a_favor > 0 ? (
                      <span className="badge-blue text-xs">Crédito {fmt(p.credito_a_favor)}</span>
                    ) : (
                      <span className="badge-green text-xs">Quitado ✓</span>
                    )}
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>

        {/* Faturas dos Cartões */}
        <div className="card border border-[var(--line)]">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-[var(--ink)] text-base">Faturas dos Cartões</h3>
              <p className="text-xs text-[var(--muted)]">Total a pagar em {mes}/{ano}</p>
            </div>
            <Link to="/cartoes" className="text-xs font-bold text-blue-500 hover:underline flex items-center gap-1">
              Ver Cartões <ChevronRight size={14} />
            </Link>
          </div>

          <div className="space-y-2.5">
            {dados.cartoes.length === 0 ? (
              <p className="text-sm text-[var(--muted)] text-center py-6">Nenhum cartão cadastrado ainda.</p>
            ) : (
              dados.cartoes.map(c => (
                <Link
                  key={c.id}
                  to="/cartoes"
                  className="flex items-center justify-between p-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] hover-surface transition-all block"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-12 h-8 shrink-0 rounded-lg overflow-hidden shadow-sm">
                      <CardArtwork cartao={c} compact />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-[var(--ink)] text-sm truncate flex items-center gap-1.5">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: getCardBrand(c.nome, c.cor).color }}
                        />
                        <span className="truncate">{c.nome}</span>
                      </p>
                      <p className="text-xs text-[var(--muted)]">Fatura de {mes}/{ano}</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className={`font-bold text-sm ${c.total > 0 ? 'text-[var(--ink)]' : 'text-[var(--muted)]'}`}>
                      {fmt(c.total)}
                    </span>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
