import { useState, useEffect } from 'react';
import { relatorios as relatoriosApi } from '../api/client';
import { Calendar, Printer } from 'lucide-react';
import CardArtwork from '../components/CardArtwork';

function fmt(val) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);
}

export default function Relatorios() {
  const [parcelasFuturas, setParcelasFuturas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mesesFrente, setMesesFrente] = useState(12);

  const carregar = async () => {
    setLoading(true);
    try {
      const res = await relatoriosApi.parcelasFuturas(mesesFrente);
      setParcelasFuturas(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregar();
  }, [mesesFrente]);

  const handleImprimir = () => {
    window.print();
  };

  const totalGeralFuturo = parcelasFuturas.reduce((acc, p) => acc + p.total, 0);
  const mesesComParcelas = parcelasFuturas.filter(bloco => bloco.itens.length > 0);
  const mesesSemParcelas = parcelasFuturas.filter(bloco => bloco.itens.length === 0);

  return (
    <div className="space-y-6">
      <div className="page-heading">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">Relatórios & Planejamento</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Cronograma de parcelas futuras contratadas nos cartões
          </p>
        </div>
        <div className="print-hidden flex flex-wrap items-center gap-2">
          <select
            className="input w-auto text-xs font-semibold"
            aria-label="Período do relatório"
            value={mesesFrente}
            onChange={e => setMesesFrente(Number(e.target.value))}
          >
            <option value={6}>Próximos 6 meses</option>
            <option value={12}>Próximos 12 meses</option>
            <option value={24}>Próximos 24 meses</option>
          </select>
          <button onClick={handleImprimir} className="btn-secondary text-sm">
            <Printer size={16} /> Imprimir Relatório
          </button>
        </div>
      </div>

      {/* Card de Resumo do Comprometimento Futuro */}
      <div className="card summary-banner p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <span className="text-xs font-semibold text-blue-300 uppercase tracking-wider block">
              Total Comprometido nos Próximos {mesesFrente} Meses
            </span>
            <div className="text-3xl sm:text-4xl font-black mt-1 tracking-tight">
              {fmt(totalGeralFuturo)}
            </div>
            <p className="text-sm text-blue-100 mt-1">
              {mesesComParcelas.length} de {mesesFrente} meses com parcelas previstas
            </p>
          </div>
          <div className="w-14 h-14 bg-white/10 rounded-2xl flex items-center justify-center text-2xl backdrop-blur-sm">
            <Calendar size={26} />
          </div>
        </div>
      </div>

      {/* Grid de Meses e Parcelas */}
      {loading ? (
        <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Carregando previsão de parcelas...</div>
      ) : mesesComParcelas.length === 0 ? (
        <div className="card text-center py-16">
          <p className="text-gray-400 text-sm">Nenhuma parcela futura registrada.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {mesesComParcelas.map(bloco => (
            <div key={bloco.nome_mes} className="card report-month p-5">
              <div>
                <div className="flex items-center justify-between mb-3 pb-3 border-b border-gray-100">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 font-bold flex items-center justify-center text-xs">
                      {bloco.mes}
                    </div>
                    <div>
                      <h4 className="font-extrabold text-gray-900 text-sm">{bloco.nome_mes}</h4>
                      <p className="text-[11px] text-gray-400">{bloco.itens.length} parcela{bloco.itens.length !== 1 ? 's' : ''}</p>
                    </div>
                  </div>
                  <span className={`text-base font-black ${bloco.total > 0 ? 'text-gray-900' : 'text-gray-400'}`}>
                    {fmt(bloco.total)}
                  </span>
                </div>

                {/* Itens do mês */}
                  <div className="space-y-1.5">
                    {bloco.itens.map((it, i) => (
                      <div key={i} className="flex items-center justify-between text-xs py-1 border-b border-gray-50 last:border-0">
                        <div className="flex min-w-0 items-center gap-2 mr-2">
                          {it.cartao && <CardArtwork cartao={{ nome: it.cartao }} compact />}
                          <div className="min-w-0">
                          <p className="font-medium text-gray-800 truncate">{it.descricao}</p>
                          <p className="text-[10px] text-gray-400">
                            {it.cartao && `${it.cartao} • `}{it.pessoa} • {it.parcela}
                          </p>
                          </div>
                        </div>
                        <span className="font-bold text-gray-900 whitespace-nowrap">{fmt(it.valor)}</span>
                      </div>
                    ))}
                  </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {!loading && mesesSemParcelas.length > 0 && (
        <section className="card p-5">
          <h2 className="font-bold text-sm mb-3">Meses sem parcelas</h2>
          <div className="flex flex-wrap gap-2">
            {mesesSemParcelas.map(bloco => <span key={bloco.nome_mes} className="badge-blue">{bloco.nome_mes}</span>)}
          </div>
        </section>
      )}
    </div>
  );
}
