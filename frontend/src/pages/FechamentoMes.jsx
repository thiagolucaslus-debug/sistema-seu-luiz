import { useState, useEffect } from 'react';
import { relatorios, pessoas as pessoasApi, whatsapp as whatsappApi, mediaUrl } from '../api/client';
import Avatar from '../components/Avatar';
import CardArtwork from '../components/CardArtwork';
import {
  CalendarCheck, CreditCard, Building2, Users, Send, CheckCircle2,
  AlertCircle, ArrowUpRight, ArrowDownLeft, Download, RefreshCw, X
} from 'lucide-react';

function fmt(val) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);
}

export default function FechamentoMes() {
  const hoje = new Date();
  const [mes, setMes] = useState(hoje.getMonth() + 1);
  const [ano, setAno] = useState(hoje.getFullYear());
  const [dados, setDados] = useState(null);
  const [loading, setLoading] = useState(true);
  const [abaAtiva, setAbaAtiva] = useState('pessoas'); // 'pessoas' | 'cartoes' | 'contas'

  // Modais de ação rápida
  const [modalPagamento, setModalPagamento] = useState(null); // pessoa selecionada
  const [pagamentoForm, setPagamentoForm] = useState({
    valor: '',
    forma: 'pix',
    observacao: ''
  });
  const [salvandoPagamento, setSalvandoPagamento] = useState(false);

  // Modal WhatsApp
  const [modalWhatsApp, setModalWhatsApp] = useState(null); // pessoa selecionada
  const [enviandoWhats, setEnviandoWhats] = useState(false);
  const [whatsStatus, setWhatsStatus] = useState(null);

  const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

  const carregarDados = async () => {
    setLoading(true);
    try {
      const res = await relatorios.fechamentoMes(mes, ano);
      setDados(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregarDados();
  }, [mes, ano]);

  const abrirModalPagamento = (pessoa) => {
    setModalPagamento(pessoa);
    setPagamentoForm({
      valor: pessoa.saldo_devedor > 0 ? pessoa.saldo_devedor.toString() : '',
      forma: 'pix',
      observacao: `Fechamento do mês ${mes}/${ano}`
    });
  };

  const handleSalvarPagamento = async (e) => {
    e.preventDefault();
    if (!modalPagamento) return;
    setSalvandoPagamento(true);
    try {
      await pessoasApi.registrarPagamento(modalPagamento.id, {
        valor: parseFloat(pagamentoForm.valor),
        data: new Date().toISOString().split('T')[0],
        forma: pagamentoForm.forma,
        observacao: pagamentoForm.observacao
      });
      setModalPagamento(null);
      carregarDados();
    } catch (err) {
      alert('Erro ao registrar pagamento: ' + (err.response?.data?.detail || err.message));
    } finally {
      setSalvandoPagamento(false);
    }
  };

  const abrirModalWhatsApp = async (pessoa) => {
    setModalWhatsApp(pessoa);
    try {
      const st = await whatsappApi.getStatus();
      setWhatsStatus(st.data);
    } catch (e) {
      setWhatsStatus({ connected: false });
    }
  };

  const extrairErro = (err) => {
    const detail = err.response?.data?.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) {
      return detail.map(d => d.msg || JSON.stringify(d)).join(', ');
    }
    if (detail && typeof detail === 'object') {
      return detail.message || detail.error || JSON.stringify(detail);
    }
    return err.message || 'Erro de comunicação';
  };

  const gerarTextoFechamento = (p) => {
    if (!p) return '';
    const nomeMes = meses[mes - 1];
    const gastosMes = p.gastos_mes ?? p.total_compras_cartao ?? 0;
    const saldoAnt = p.saldo_anterior ?? 0;
    const comprasMim = p.compras_para_mim ?? p.total_compras_para_mim ?? 0;
    const pags = p.total_pagamentos ?? 0;
    const saldoDev = p.saldo_devedor ?? 0;
    const creditoFav = p.credito_a_favor ?? 0;

    let txt = `Olá, *${p.nome}*! 👋\n\n`;
    txt += `Segue o seu *Fechamento Financeiro de ${nomeMes}/${ano}*:\n\n`;
    txt += `📊 *Resumo dos Valores:*\n`;
    if (saldoAnt > 0) {
      txt += `• Saldo Pendente do Mês Anterior: *${fmt(saldoAnt)}*\n`;
    }
    txt += `• Compras / Parcelas deste mês: *${fmt(gastosMes)}*\n`;
    if (comprasMim > 0) {
      txt += `• Compras que você fez pra mim (abatimento): *- ${fmt(comprasMim)}*\n`;
    }
    if (pags > 0) {
      txt += `• Pagamentos já recebidos: *- ${fmt(pags)}*\n`;
    }
    txt += `━━━━━━━━━━━━━━━━━━━━━\n`;
    if (saldoDev > 0) {
      txt += `👉 *TOTAL A PAGAR: ${fmt(saldoDev)}*\n\n`;
    } else if (creditoFav > 0) {
      txt += `👉 *CRÉDITO A SEU FAVOR (eu te pago): ${fmt(creditoFav)}*\n\n`;
    } else {
      txt += `👉 *SITUAÇÃO: TOTALMENTE QUITADO (R$ 0,00)* 🎉\n\n`;
    }

    // Detalhamento das compras deste mês
    if (p.compras && p.compras.length > 0) {
      txt += `🛍️ *Compras e Parcelas de ${nomeMes}:*\n`;
      p.compras.slice(0, 8).forEach(c => {
        const cartaoInfo = c.cartao ? ` (${c.cartao})` : '';
        txt += `• ${c.descricao} [${c.parcela}${cartaoInfo}]: *${fmt(c.valor)}*\n`;
      });
      if (p.compras.length > 8) {
        txt += `• ... e mais ${p.compras.length - 8} compras no PDF anexo\n`;
      }
      txt += `\n`;
    } else {
      txt += `🛍️ *Compras deste mês:* Nenhuma nova compra no período.\n\n`;
    }

    // Parcelas Futuras (se houver)
    if (p.parcelas_futuras && p.parcelas_futuras.length > 0) {
      const totalFut = p.parcelas_futuras.reduce((acc, pf) => acc + (pf.valor || 0), 0);
      txt += `⏳ *Próximas Parcelas (a vencer nos próximos meses):*\n`;
      p.parcelas_futuras.slice(0, 5).forEach(pf => {
        const mesPf = meses[pf.mes - 1] || pf.mes;
        txt += `• ${mesPf}/${pf.ano}: ${pf.descricao} [${pf.parcela}]: *${fmt(pf.valor)}*\n`;
      });
      if (p.parcelas_futuras.length > 5) {
        txt += `• ... e mais ${p.parcelas_futuras.length - 5} parcelas futuras\n`;
      }
      txt += `👉 *Total restante futuro: ${fmt(totalFut)}*\n\n`;
    }

    // Link público para download do PDF
    if (p.token_acesso) {
      const linkPdf = `${window.location.origin}/public/fechamento/${p.token_acesso}/${mes}/${ano}/pdf`;
      txt += `📄 *BAIXAR EXTRATO COMPLETO EM PDF:*\n${linkPdf}\n\n`;
    }

    txt += `Qualquer dúvida só me avisar! Abraço, Seu Luiz.`;
    return txt;
  };

  const handleBaixarPdfModal = async () => {
    if (!modalWhatsApp) return;
    try {
      const url = pessoasApi.gerarPDFUrl(modalWhatsApp.id, mes, ano);
      const token = localStorage.getItem('token');
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) throw new Error('Falha ao obter PDF do servidor.');
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      const mesStr = String(mes).padStart(2, '0');
      a.download = `fechamento_${modalWhatsApp.nome}_${mesStr}_${ano}.pdf`;
      a.click();
    } catch (e) {
      alert('Erro ao baixar PDF: ' + e.message);
    }
  };

  const handleAbrirWhatsAppDireto = () => {
    if (!modalWhatsApp) return;
    const numLimpo = (modalWhatsApp.telefone || '').replace(/\D/g, '');
    const telFinal = numLimpo.startsWith('55') ? numLimpo : `55${numLimpo}`;
    const texto = gerarTextoFechamento(modalWhatsApp);
    if (!numLimpo) {
      alert('Esta pessoa não tem telefone cadastrado. Atualize no cadastro de Pessoas.');
      return;
    }
    window.open(`https://wa.me/${telFinal}?text=${encodeURIComponent(texto)}`, '_blank');
  };

  const handleEnviarFechamentoWhatsApp = async () => {
    if (!modalWhatsApp) return;
    setEnviandoWhats(true);
    const numLimpo = (modalWhatsApp.telefone || '').replace(/\D/g, '');
    const telFinal = numLimpo.startsWith('55') ? numLimpo : `55${numLimpo}`;
    const textoMensagem = gerarTextoFechamento(modalWhatsApp);

    try {
      // 1. Gera PDF e obtém o path absoluto no servidor
      const pdfRes = await pessoasApi.obterPdfPath(modalWhatsApp.id, mes, ano);
      const pdfPath = pdfRes.data?.pdf_path;
      const telefone = modalWhatsApp.telefone;

      if (!telefone) {
        alert('Esta pessoa não tem telefone cadastrado. Atualize no cadastro de Pessoas.');
        setEnviandoWhats(false);
        return;
      }

      // 2. Envia PDF pelo serviço WhatsApp com legenda formatada
      await whatsappApi.sendPdf({
        telefone: telefone,
        pdf_path: pdfPath,
        pdfPath: pdfPath,
        mensagem: textoMensagem,
        nome_pessoa: modalWhatsApp.nome,
        mes_ano: `${meses[mes - 1]}/${ano}`
      });

      alert(`Fechamento e PDF enviados com sucesso para ${modalWhatsApp.nome}!`);
      setModalWhatsApp(null);
    } catch (err) {
      const msgErro = extrairErro(err);
      if (numLimpo) {
        if (window.confirm(`O envio automático pelo servidor retornou: "${msgErro}".\n\nDeseja abrir a conversa diretamente no WhatsApp com a mensagem pronta agora?`)) {
          window.open(`https://wa.me/${telFinal}?text=${encodeURIComponent(textoMensagem)}`, '_blank');
        }
      } else {
        alert('Erro ao enviar por WhatsApp: ' + msgErro);
      }
    } finally {
      setEnviandoWhats(false);
    }
  };

  const r = dados?.resumo || {
    total_faturas_cartao: 0,
    total_saidas_contas: 0,
    total_gastos_consolidado: 0,
    total_a_receber_pessoas: 0,
    total_a_pagar_pessoas: 0,
    total_recebido_mes: 0
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="page-heading">
        <div>
          <div className="flex items-center gap-2">
            <CalendarCheck className="text-blue-500" size={28} />
            <h1 className="text-2xl sm:text-3xl font-extrabold text-ink tracking-tight">Fechamento do Mês</h1>
          </div>
          <p className="text-slate-400 text-sm mt-0.5">
            Visão consolidada de faturas, saídas em bancos e liquidação de dívidas de cada pessoa
          </p>
        </div>

        {/* Seletor de Período */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 p-1 rounded-xl border border-slate-700/60" style={{ backgroundColor: 'var(--surface)' }}>
            <select
              className="text-xs font-semibold bg-transparent px-2.5 py-1.5 outline-none cursor-pointer text-ink"
              value={mes}
              onChange={e => setMes(Number(e.target.value))}
            >
              {meses.map((m, i) => (
                <option key={i} value={i + 1} className="bg-slate-900 text-white">{m}</option>
              ))}
            </select>
            <span className="text-slate-500 text-xs">/</span>
            <select
              className="text-xs font-semibold bg-transparent px-2 py-1.5 outline-none cursor-pointer text-ink"
              value={ano}
              onChange={e => setAno(Number(e.target.value))}
            >
              {[2024, 2025, 2026, 2027].map(a => (
                <option key={a} value={a} className="bg-slate-900 text-white">{a}</option>
              ))}
            </select>
          </div>

          <button
            onClick={carregarDados}
            className="p-2.5 rounded-xl border border-slate-700/60 text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
            title="Atualizar dados"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Cards de Métricas Consolidadas do Mês */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Faturas de Cartão */}
        <div className="card p-5 border-l-4 border-l-blue-500 relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-400 text-xs font-bold uppercase tracking-wider mb-2">
            <span>Faturas de Cartões</span>
            <CreditCard size={18} className="text-blue-400" />
          </div>
          <p className="text-2xl font-black text-ink">{fmt(r.total_faturas_cartao)}</p>
          <p className="text-xs text-slate-400 mt-1">Total a pagar das faturas do mês</p>
        </div>

        {/* Card 2: Saídas em Banco */}
        <div className="card p-5 border-l-4 border-l-indigo-500 relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-400 text-xs font-bold uppercase tracking-wider mb-2">
            <span>Saídas em Contas</span>
            <Building2 size={18} className="text-indigo-400" />
          </div>
          <p className="text-2xl font-black text-ink">{fmt(r.total_saidas_contas)}</p>
          <p className="text-xs text-slate-400 mt-1">Despesas e débitos diretos em conta</p>
        </div>

        {/* Card 3: A Receber de Pessoas */}
        <div className="card p-5 border-l-4 border-l-emerald-500 relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-400 text-xs font-bold uppercase tracking-wider mb-2">
            <span>A Receber de Pessoas</span>
            <ArrowDownLeft size={18} className="text-emerald-400" />
          </div>
          <p className="text-2xl font-black text-emerald-400">{fmt(r.total_a_receber_pessoas)}</p>
          <p className="text-xs text-slate-400 mt-1">Soma das dívidas pendentes de terceiros</p>
        </div>

        {/* Card 4: Já Recebido no Mês */}
        <div className="card p-5 border-l-4 border-l-amber-500 relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-400 text-xs font-bold uppercase tracking-wider mb-2">
            <span>Já Recebido no Mês</span>
            <CheckCircle2 size={18} className="text-amber-400" />
          </div>
          <p className="text-2xl font-black text-ink">{fmt(r.total_recebido_mes)}</p>
          <p className="text-xs text-slate-400 mt-1">Pagamentos liquidados em {meses[mes - 1]}</p>
        </div>
      </div>

      {/* Navegação por Abas: Pessoas, Cartões, Contas */}
      <div className="flex items-center gap-2 border-b border-slate-700/60 pb-3">
        <button
          onClick={() => setAbaAtiva('pessoas')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${
            abaAtiva === 'pessoas'
              ? 'bg-blue-600 text-white shadow'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
          }`}
        >
          <Users size={17} />
          <span>Fechamento por Pessoa ({dados?.pessoas?.length || 0})</span>
        </button>

        <button
          onClick={() => setAbaAtiva('cartoes')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${
            abaAtiva === 'cartoes'
              ? 'bg-blue-600 text-white shadow'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
          }`}
        >
          <CreditCard size={17} />
          <span>Faturas de Cartões ({dados?.cartoes?.length || 0})</span>
        </button>

        <button
          onClick={() => setAbaAtiva('contas')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${
            abaAtiva === 'contas'
              ? 'bg-blue-600 text-white shadow'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
          }`}
        >
          <Building2 size={17} />
          <span>Contas Bancárias ({dados?.contas?.length || 0})</span>
        </button>
      </div>

      {/* Conteúdo da Aba 1: PESSOAS (Fechamento e Liquidação) */}
      {abaAtiva === 'pessoas' && (
        <div className="space-y-4">
          {loading ? (
            <div className="card text-center py-16 text-slate-400 text-sm">Carregando fechamento das pessoas...</div>
          ) : !dados?.pessoas || dados.pessoas.length === 0 ? (
            <div className="card text-center py-12 text-slate-400">Nenhuma pessoa ativa cadastrada.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {dados.pessoas.map((p) => {
                const isQuitado = p.saldo_devedor <= 0 && p.credito_a_favor <= 0;
                const isCredor = p.credito_a_favor > 0;

                return (
                  <div
                    key={p.id}
                    className="card p-5 flex flex-col justify-between border border-slate-700/50 hover:border-slate-600 transition-all shadow-sm"
                  >
                    <div>
                      {/* Topo do Card da Pessoa */}
                      <div className="flex items-center justify-between gap-3 mb-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <Avatar nome={p.nome} foto={mediaUrl(p.foto_path)} className="w-12 h-12 rounded-2xl shrink-0" />
                          <div className="min-w-0">
                            <h3 className="font-extrabold text-ink text-base truncate">{p.nome}</h3>
                            <p className="text-xs text-slate-400 truncate">{p.telefone || 'Sem telefone'}</p>
                          </div>
                        </div>

                        {/* Badge de Situação */}
                        {isQuitado ? (
                          <span className="px-2.5 py-1 text-xs font-bold rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            Quitado
                          </span>
                        ) : isCredor ? (
                          <span className="px-2.5 py-1 text-xs font-bold rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20">
                            Você deve
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 text-xs font-bold rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20">
                            Pendente
                          </span>
                        )}
                      </div>

                      {/* Discriminação dos Valores */}
                      <div className="space-y-2 p-3 rounded-xl mb-4 text-xs" style={{ backgroundColor: 'var(--raised)' }}>
                        <div className="flex justify-between items-center text-slate-300">
                          <span>Gastos no Cartão:</span>
                          <span className="font-bold text-ink">{fmt(p.total_compras_cartao)}</span>
                        </div>

                        {p.total_compras_para_mim > 0 && (
                          <div className="flex justify-between items-center text-purple-400">
                            <span>Comprou pra você (abate):</span>
                            <span className="font-bold">- {fmt(p.total_compras_para_mim)}</span>
                          </div>
                        )}

                        {p.total_pagamentos > 0 && (
                          <div className="flex justify-between items-center text-emerald-400">
                            <span>Pagamentos recebidos:</span>
                            <span className="font-bold">- {fmt(p.total_pagamentos)}</span>
                          </div>
                        )}

                        <div className="border-t border-slate-700/60 pt-2 flex justify-between items-center text-sm font-extrabold">
                          <span className="text-ink">Saldo a Pagar:</span>
                          <span className={isCredor ? 'text-purple-400' : isQuitado ? 'text-emerald-400' : 'text-rose-400'}>
                            {isCredor ? `Crédito ${fmt(p.credito_a_favor)}` : fmt(p.saldo_devedor)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Botões de Ação Rápida */}
                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-700/40">
                      <button
                        onClick={() => abrirModalPagamento(p)}
                        className="btn-secondary text-xs py-2 flex items-center justify-center gap-1.5"
                      >
                        <CheckCircle2 size={14} className="text-emerald-400" />
                        <span>Dar Baixa</span>
                      </button>

                      <button
                        onClick={() => abrirModalWhatsApp(p)}
                        className="btn-primary text-xs py-2 flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white"
                      >
                        <Send size={14} />
                        <span>WhatsApp</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Conteúdo da Aba 2: CARTÕES DE CRÉDITO */}
      {abaAtiva === 'cartoes' && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {dados?.cartoes?.map((c) => (
            <div key={c.id} className="card p-5 border border-slate-700/50 flex flex-col justify-between">
              <div>
                <div className="h-40 rounded-2xl mb-4 overflow-hidden shadow-lg">
                  <CardArtwork
                    brand={c.bandeira}
                    bank={c.nome}
                    holder="FRANCISCO LUIZ"
                    className="w-full h-full"
                  />
                </div>
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h3 className="font-extrabold text-ink text-lg">{c.nome}</h3>
                    <p className="text-xs text-slate-400">Fecha dia {c.dia_fechamento} • Vence dia {c.dia_vencimento}</p>
                  </div>
                  <span className={`px-2.5 py-1 text-xs font-bold rounded-lg ${
                    c.fatura_paga ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'
                  }`}>
                    {c.fatura_paga ? 'Fatura Paga' : 'Em Aberto'}
                  </span>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-700/50 flex justify-between items-center">
                <span className="text-xs text-slate-400">Fatura {meses[mes - 1]}:</span>
                <span className="text-xl font-black text-ink">{fmt(c.total_fatura)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Conteúdo da Aba 3: CONTAS BANCÁRIAS */}
      {abaAtiva === 'contas' && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {dados?.contas?.map((cb) => (
            <div key={cb.id} className="card p-5 border border-slate-700/50">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-bold">
                  <Building2 size={24} />
                </div>
                <div>
                  <h3 className="font-extrabold text-ink text-base">{cb.nome}</h3>
                  <p className="text-xs text-slate-400">{cb.banco || 'Conta Bancária'}</p>
                </div>
              </div>

              <div className="space-y-2 p-3 rounded-xl text-xs mb-3" style={{ backgroundColor: 'var(--raised)' }}>
                <div className="flex justify-between text-slate-300">
                  <span>Saídas no mês:</span>
                  <span className="font-bold text-rose-400">{fmt(cb.total_saidas)}</span>
                </div>
                <div className="flex justify-between text-slate-300">
                  <span>Entradas no mês:</span>
                  <span className="font-bold text-emerald-400">{fmt(cb.total_entradas)}</span>
                </div>
                <div className="border-t border-slate-700/60 pt-2 flex justify-between font-extrabold text-sm">
                  <span className="text-ink">Saldo Atual:</span>
                  <span className="text-ink">{fmt(cb.saldo_atual)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal de Registro Rápido de Pagamento / Baixa */}
      {modalPagamento && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="card rounded-3xl shadow-2xl w-full max-w-md p-6 border border-slate-700/60">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={20} className="text-emerald-400" />
                <h3 className="font-bold text-ink text-lg">Dar Baixa — {modalPagamento.nome}</h3>
              </div>
              <button onClick={() => setModalPagamento(null)} className="p-1 text-slate-400 hover:text-ink">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSalvarPagamento} className="space-y-4">
              <div>
                <label className="label text-ink font-semibold">Valor Recebido (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  className="input font-bold text-lg"
                  value={pagamentoForm.valor}
                  onChange={e => setPagamentoForm({ ...pagamentoForm, valor: e.target.value })}
                />
              </div>

              <div>
                <label className="label text-ink font-semibold">Forma de Pagamento</label>
                <select
                  className="input"
                  value={pagamentoForm.forma}
                  onChange={e => setPagamentoForm({ ...pagamentoForm, forma: e.target.value })}
                >
                  <option value="pix" className="bg-slate-900 text-white">Pix</option>
                  <option value="dinheiro" className="bg-slate-900 text-white">Dinheiro em mãos</option>
                  <option value="transferencia" className="bg-slate-900 text-white">Transferência bancária</option>
                  <option value="abatimento" className="bg-slate-900 text-white">Abatimento / Compensação</option>
                </select>
              </div>

              <div>
                <label className="label text-ink font-semibold">Observação</label>
                <input
                  type="text"
                  className="input text-sm"
                  placeholder="Ex: Pago via Pix Nubank"
                  value={pagamentoForm.observacao}
                  onChange={e => setPagamentoForm({ ...pagamentoForm, observacao: e.target.value })}
                />
              </div>

              <div className="flex gap-2 justify-end pt-3 border-t border-slate-700/50">
                <button type="button" onClick={() => setModalPagamento(null)} className="btn-secondary">Cancelar</button>
                <button type="submit" disabled={salvandoPagamento} className="btn-primary">
                  {salvandoPagamento ? 'Salvando...' : 'Confirmar Baixa'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal WhatsApp de Envio de Fechamento com PDF */}
      {modalWhatsApp && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="card rounded-3xl shadow-2xl w-full max-w-md p-6 border border-slate-700/60">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Send size={20} className="text-emerald-400" />
                <h3 className="font-bold text-ink text-lg">Enviar por WhatsApp</h3>
              </div>
              <button onClick={() => setModalWhatsApp(null)} className="p-1 text-slate-400 hover:text-ink">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4 text-sm">
              <div className="p-4 rounded-2xl border border-slate-700/40" style={{ backgroundColor: 'var(--raised)' }}>
                <p className="font-extrabold text-ink text-base">{modalWhatsApp.nome}</p>
                <p className="text-xs text-slate-400 mt-0.5">Telefone: {modalWhatsApp.telefone || 'Não cadastrado'}</p>
                <p className="text-xs text-blue-400 mt-2 font-semibold">
                  Mês de referência: {meses[mes - 1]}/{ano}
                </p>
                <p className="text-sm font-black text-ink mt-1">
                  Saldo: {modalWhatsApp.credito_a_favor > 0 ? `Crédito ${fmt(modalWhatsApp.credito_a_favor)}` : fmt(modalWhatsApp.saldo_devedor)}
                </p>
              </div>

              {/* Prévia da Mensagem */}
              <div className="p-3 rounded-xl border border-slate-700/50 text-xs font-mono whitespace-pre-wrap max-h-36 overflow-y-auto" style={{ backgroundColor: 'var(--raised)' }}>
                {gerarTextoFechamento(modalWhatsApp)}
              </div>

              {/* Botões de Ação */}
              <div className="space-y-2 pt-2">
                <button
                  type="button"
                  onClick={handleAbrirWhatsAppDireto}
                  disabled={!modalWhatsApp.telefone}
                  className="w-full btn-primary bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 flex items-center justify-center gap-2 shadow-lg"
                >
                  <Send size={16} />
                  <span>Abrir Conversa no WhatsApp (Recomendado)</span>
                </button>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleBaixarPdfModal}
                    className="btn-secondary text-xs py-2 flex items-center justify-center gap-1.5"
                  >
                    <Download size={14} />
                    <span>Baixar PDF</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleEnviarFechamentoWhatsApp}
                    disabled={enviandoWhats || !modalWhatsApp.telefone}
                    className="btn-secondary text-xs py-2 flex items-center justify-center gap-1.5 text-blue-400 hover:text-blue-300"
                    title="Envia via Bot do Servidor (requer WhatsApp Web conectado)"
                  >
                    <Send size={14} />
                    <span>{enviandoWhats ? 'Enviando...' : 'Bot com PDF'}</span>
                  </button>
                </div>
              </div>

              <div className="flex justify-end pt-2 border-t border-slate-700/50">
                <button type="button" onClick={() => setModalWhatsApp(null)} className="btn-secondary text-xs">Fechar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
