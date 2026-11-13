import { useState, useEffect, useRef } from 'react';
import Avatar from '../components/Avatar';
import {
  pessoas as pessoasApi,
  contas as contasApi,
  whatsapp as whatsappApi
} from '../api/client';
import {
  Users, Plus, ChevronDown, ChevronUp, Download,
  MessageCircle, DollarSign, X, CheckCircle, Trash2, Send,
  Camera, Edit2, User, Link2, Share2
} from 'lucide-react';

function fmt(val) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);
}

function ModalNovaPessoa({ onClose, onSaved }) {
  const [form, setForm] = useState({
    nome: '',
    telefone: '',
    cor: '#10B981'
  });
  const [fotoFile, setFotoFile] = useState(null);
  const [fotoPreview, setFotoPreview] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef(null);

  const handleFotoChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setFotoFile(file);
      setFotoPreview(URL.createObjectURL(file));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await pessoasApi.criar(form);
      const pessoaCriada = res.data;

      if (fotoFile && pessoaCriada.id) {
        const formData = new FormData();
        formData.append('file', fotoFile);
        await pessoasApi.uploadFoto(pessoaCriada.id, formData);
      }

      onSaved();
      onClose();
    } catch (err) {
      alert('Erro ao cadastrar pessoa: ' + (err.response?.data?.detail || err.message));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6 border border-gray-100">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900">Cadastrar Nova Pessoa</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700 rounded-lg"><X size={20} /></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Seletor de Foto */}
          <div className="flex flex-col items-center justify-center gap-2 pb-2">
            <div
              onClick={() => fileInputRef.current?.click()}
              className="relative w-20 h-20 rounded-full border-2 border-dashed border-gray-300 hover:border-blue-500 flex items-center justify-center cursor-pointer overflow-hidden group bg-slate-50 transition-all shadow-sm"
              style={{ borderColor: fotoPreview ? form.cor : undefined }}
            >
              {fotoPreview ? (
                <img src={fotoPreview} alt="Preview" className="w-full h-full object-cover" />
              ) : (
                <div className="flex flex-col items-center text-gray-400 group-hover:text-blue-500">
                  <Camera size={24} />
                  <span className="text-[10px] mt-1 font-medium">Foto</span>
                </div>
              )}
              <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity">
                <Camera size={20} />
              </div>
            </div>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFotoChange}
              accept="image/*"
              className="hidden"
            />
            <span className="text-xs text-gray-400">Toque para adicionar foto</span>
          </div>

          <div>
            <label className="label">Nome da Pessoa</label>
            <input
              type="text"
              className="input font-medium"
              placeholder="Ex: Thais, Luane, Alexandre..."
              value={form.nome}
              onChange={e => setForm({ ...form, nome: e.target.value })}
              required
            />
          </div>

          <div>
            <label className="label">WhatsApp / Telefone (com DDD)</label>
            <input
              type="text"
              className="input"
              placeholder="(11) 99999-9999"
              value={form.telefone}
              onChange={e => setForm({ ...form, telefone: e.target.value })}
            />
            <p className="text-xs text-gray-400 mt-1">Usado para encaminhar o fechamento em PDF diretamente.</p>
          </div>

          <div>
            <label className="label">Cor de Identificação</label>
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
              {submitting ? 'Salvando...' : 'Salvar Pessoa'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ModalEditarPessoa({ pessoa, onClose, onSaved }) {
  const [form, setForm] = useState({
    nome: pessoa.nome || '',
    telefone: pessoa.telefone || '',
    cor: pessoa.cor || '#10B981'
  });
  const [fotoFile, setFotoFile] = useState(null);
  const [fotoPreview, setFotoPreview] = useState(pessoa.foto_path || null);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef(null);

  const handleFotoChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setFotoFile(file);
      setFotoPreview(URL.createObjectURL(file));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await pessoasApi.atualizar(pessoa.id, form);

      if (fotoFile) {
        const formData = new FormData();
        formData.append('file', fotoFile);
        await pessoasApi.uploadFoto(pessoa.id, formData);
      }

      onSaved();
      onClose();
    } catch (err) {
      alert('Erro ao atualizar pessoa: ' + (err.response?.data?.detail || err.message));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6 border border-gray-100">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900">Editar Pessoa</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700 rounded-lg"><X size={20} /></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Seletor de Foto */}
          <div className="flex flex-col items-center justify-center gap-2 pb-2">
            <div
              onClick={() => fileInputRef.current?.click()}
              className="relative w-20 h-20 rounded-full border-2 border-dashed border-gray-300 hover:border-blue-500 flex items-center justify-center cursor-pointer overflow-hidden group bg-slate-50 transition-all shadow-sm"
              style={{ borderColor: form.cor }}
            >
              {fotoPreview ? (
                <img src={fotoPreview} alt="Preview" className="w-full h-full object-cover" />
              ) : (
                <div
                  className="w-full h-full flex items-center justify-center text-white text-2xl font-bold"
                  style={{ backgroundColor: form.cor }}
                >
                  {form.nome ? form.nome[0].toUpperCase() : <User size={28} />}
                </div>
              )}
              <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity">
                <Camera size={20} />
              </div>
            </div>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFotoChange}
              accept="image/*"
              className="hidden"
            />
            <span className="text-xs text-gray-400">Toque para alterar a foto</span>
          </div>

          <div>
            <label className="label">Nome da Pessoa</label>
            <input
              type="text"
              className="input font-medium"
              placeholder="Ex: Thais, Luane, Alexandre..."
              value={form.nome}
              onChange={e => setForm({ ...form, nome: e.target.value })}
              required
            />
          </div>

          <div>
            <label className="label">WhatsApp / Telefone (com DDD)</label>
            <input
              type="text"
              className="input"
              placeholder="(11) 99999-9999"
              value={form.telefone}
              onChange={e => setForm({ ...form, telefone: e.target.value })}
            />
          </div>

          <div>
            <label className="label">Cor de Identificação</label>
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
              {submitting ? 'Salvando...' : 'Salvar Alterações'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ModalRegistrarPagamento({ pessoa, contas, onClose, onSaved }) {
  const hoje = new Date().toISOString().split('T')[0];
  const [form, setForm] = useState({
    valor: '',
    data: hoje,
    observacao: '',
    forma: 'dinheiro',
    outra_forma: '',
    conta_id: ''
  });
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await pessoasApi.registrarPagamento(pessoa.id, {
        valor: parseFloat(form.valor),
        data: form.data,
        observacao: form.observacao,
        forma: form.forma,
        outra_forma: form.forma === 'outro' ? form.outra_forma : null,
        conta_id: form.conta_id ? parseInt(form.conta_id) : null
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
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md max-h-[90dvh] overflow-y-auto p-6 border border-gray-100">
        <h2 className="text-lg font-bold text-gray-900 mb-0.5">Registrar Pagamento Recebido</h2>
        <p className="text-xs text-gray-500 mb-4">Recebimento de: <strong className="text-gray-900">{pessoa.nome}</strong></p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Valor Pago (R$)</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              className="input text-base font-bold text-gray-900"
              placeholder="0,00"
              value={form.valor}
              onChange={e => setForm({ ...form, valor: e.target.value })}
              required
            />
          </div>

          <div>
            <label className="label">Data do Recebimento</label>
            <input
              type="date"
              className="input"
              value={form.data}
              onChange={e => setForm({ ...form, data: e.target.value })}
              required
            />
          </div>

          <label className="block">
            <span className="label">Forma de pagamento</span>
            <select className="input" value={form.forma}
              onChange={e => setForm({ ...form, forma: e.target.value, conta_id: '' })}>
              <option value="dinheiro">Dinheiro em mãos</option>
              <option value="pix">Pix</option>
              <option value="transferencia">Transferência bancária</option>
              <option value="abatimento">Abatimento de dívida</option>
              <option value="outro">Outro</option>
            </select>
          </label>
          {form.forma === 'outro' && (
            <label className="block"><span className="label">Qual foi a forma de pagamento?</span>
              <input className="input" value={form.outra_forma} maxLength={100} required
                onChange={e => setForm({ ...form, outra_forma: e.target.value })} />
            </label>
          )}
          {['pix', 'transferencia', 'outro'].includes(form.forma) && (
            <label className="block"><span className="label">Conta de destino</span>
              <select className="input" value={form.conta_id}
                onChange={e => setForm({ ...form, conta_id: e.target.value })}>
                <option value="">Sem vincular a uma conta</option>
                {contas.map(c => <option key={c.id} value={c.id}>{c.nome} ({c.banco})</option>)}
              </select>
            </label>
          )}
          {form.forma === 'abatimento' && <p className="text-sm text-gray-500">O valor será descontado do saldo da pessoa, sem entrada em conta.</p>}

          <div>
            <label className="label">Observação / Comprovante</label>
            <input
              type="text"
              className="input"
              placeholder="Ex: Pix recebido, pagamento parcial..."
              value={form.observacao}
              onChange={e => setForm({ ...form, observacao: e.target.value })}
            />
          </div>

          <div className="flex gap-2 justify-end pt-3 border-t">
            <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
            <button type="submit" disabled={submitting} className="btn-success">
              {submitting ? 'Registrando...' : 'Registrar Pagamento'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ModalLinkLancamento({ pessoa, onClose }) {
  const [copiado, setCopiado] = useState(false);
  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const link = `${window.location.origin}/lancar/${pessoa.token_acesso}`;

  const mensagemWhats = `Olá, *${pessoa.nome}*! 👋\n\nAqui está o seu link pessoal e exclusivo para lançar compras no cartão do Seu Luiz direto do seu celular:\n\n👉 ${link}\n\n💡 *Dica:* Salve este link nos seus favoritos ou adicione na tela inicial do seu celular para enviar compras e comprovantes sempre que usar o cartão!`;

  const copiar = () => {
    navigator.clipboard.writeText(link);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2500);
  };

  const enviarWhatsApp = () => {
    const numLimpo = String(pessoa.telefone || '').replace(/\D/g, '');
    const urlWa = numLimpo
      ? `https://wa.me/55${numLimpo}?text=${encodeURIComponent(mensagemWhats)}`
      : `https://web.whatsapp.com/send?text=${encodeURIComponent(mensagemWhats)}`;
    window.open(urlWa, '_blank');
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="card rounded-3xl shadow-2xl w-full max-w-md p-6 border border-slate-700/60 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link2 className="text-blue-500" size={22} />
            <h3 className="font-bold text-ink text-lg">Link de Celular — {pessoa.nome}</h3>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-ink">
            <X size={20} />
          </button>
        </div>

        <div className="flex items-center gap-3.5 p-3 rounded-2xl border border-slate-700/40" style={{ backgroundColor: 'var(--raised)' }}>
          <Avatar nome={pessoa.nome} foto={pessoa.foto_path} cor={pessoa.cor} className="w-12 h-12 rounded-2xl shrink-0" />
          <div className="min-w-0">
            <p className="font-extrabold text-ink text-base truncate">{pessoa.nome}</p>
            <p className="text-xs text-slate-400 truncate">{pessoa.telefone || 'Sem telefone cadastrado'}</p>
          </div>
        </div>

        <div>
          <label className="label text-ink font-semibold">Link Pessoal de Lançamento</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={link}
              className="input text-xs font-mono select-all text-slate-300"
            />
            <button
              type="button"
              onClick={copiar}
              className={`px-3.5 py-2.5 rounded-xl text-xs font-bold shrink-0 transition-all flex items-center gap-1.5 ${
                copiado
                  ? 'bg-emerald-600 text-white shadow'
                  : 'btn-secondary text-blue-400 hover:text-blue-300'
              }`}
            >
              {copiado ? <CheckCircle size={15} /> : <Share2 size={15} />}
              <span>{copiado ? 'Copiado!' : 'Copiar'}</span>
            </button>
          </div>
        </div>

        {isLocalhost && (
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300 space-y-1">
            <strong>⚠️ Atenção sobre o WhatsApp e Celular:</strong>
            <p>
              O link acima tem <code>localhost</code>, que só existe dentro deste computador. No celular da outra pessoa ou no 4G, ele não abre e o WhatsApp não deixa azul clicável.
            </p>
            <p className="font-semibold text-amber-200">
              👉 Para gerar o link de internet oficial (HTTPS) que funciona em qualquer celular 24h, execute o arquivo <code>conectar_celular.bat</code> na pasta do sistema!
            </p>
          </div>
        )}

        <div className="space-y-2 pt-2 border-t border-slate-700/50">
          <button
            type="button"
            onClick={enviarWhatsApp}
            className="btn-primary w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20"
          >
            <MessageCircle size={18} />
            <span>Enviar Mensagem Pronta pelo WhatsApp</span>
          </button>

          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className="btn-secondary w-full py-2.5 text-xs text-center block text-slate-300 hover:text-white"
          >
            Abrir e Testar Tela no Navegador
          </a>
        </div>
      </div>
    </div>
  );
}

function CardPessoa({ pessoa, contas, onRefresh }) {
  const [expanded, setExpanded] = useState(false);
  const [extrato, setExtrato] = useState(null);
  const [loadingExtrato, setLoadingExtrato] = useState(false);
  const [mesAberto, setMesAberto] = useState(0); // índice do mês expandido
  const [modalPagamento, setModalPagamento] = useState(false);
  const [modalEditar, setModalEditar] = useState(false);
  const [modalLink, setModalLink] = useState(false);
  const [enviandoWhats, setEnviandoWhats] = useState(false);
  const [gerandoPdf, setGerandoPdf] = useState(false);

  const carregarExtrato = async () => {
    if (extrato) return;
    setLoadingExtrato(true);
    try {
      const res = await pessoasApi.extrato(pessoa.id);
      setExtrato(res.data);
      setMesAberto(0);
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

  const handleDelete = async (e) => {
    e.stopPropagation();
    if (window.confirm(`Tem certeza que deseja remover ${pessoa.nome}?`)) {
      try {
        await pessoasApi.deletar(pessoa.id);
        onRefresh();
      } catch (err) {
        alert('Erro ao excluir pessoa: ' + (err.response?.data?.detail || err.message));
      }
    }
  };

  // Download direto do PDF no navegador
  const handleDownloadPDF = async (mes, ano) => {
    setGerandoPdf(true);
    try {
      const url = pessoasApi.gerarPDFUrl(pessoa.id, mes, ano);
      const token = localStorage.getItem('token');
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) throw new Error('Falha ao gerar PDF no backend.');
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      const mesStr = String(mes).padStart(2, '0');
      a.download = `fechamento_${pessoa.nome}_${mesStr}_${ano}.pdf`;
      a.click();
    } catch (err) {
      alert('Erro ao baixar PDF: ' + err.message);
    } finally {
      setGerandoPdf(false);
    }
  };

  // Envio via WhatsApp automático ou link Web direto
  const handleEnviarWhatsApp = async (mes, ano, nomeMes, h) => {
    setEnviandoWhats(true);
    const numLimpo = (pessoa.telefone || '').replace(/\D/g, '');
    const telefoneFinal = numLimpo.startsWith('55') ? numLimpo : `55${numLimpo}`;

    const saldoAnt = h?.saldo_anterior || 0;
    const gastosMes = h?.total_gastos || 0;
    const pagsMes = h?.total_pagamentos || 0;
    const saldoDev = h?.saldo_devedor || 0;

    let msgTexto = `Olá, *${pessoa.nome}*! 👋\n\n`;
    msgTexto += `Segue o seu *Fechamento Financeiro de ${nomeMes}*:\n\n`;
    msgTexto += `📊 *Resumo dos Valores:*\n`;
    if (saldoAnt > 0) {
      msgTexto += `• Saldo Pendente do Mês Anterior: *${fmt(saldoAnt)}*\n`;
    }
    msgTexto += `• Compras / Parcelas deste mês: *${fmt(gastosMes)}*\n`;
    if (pagsMes > 0) {
      msgTexto += `• Pagamentos já realizados: *- ${fmt(pagsMes)}*\n`;
    }
    msgTexto += `━━━━━━━━━━━━━━━━━━━━━\n`;
    if (saldoDev > 0) {
      msgTexto += `👉 *TOTAL A PAGAR: ${fmt(saldoDev)}*\n\n`;
    } else {
      msgTexto += `👉 *SITUAÇÃO: TOTALMENTE QUITADO (R$ 0,00)* 🎉\n\n`;
    }

    if (h?.lancamentos && h.lancamentos.length > 0) {
      msgTexto += `🛍️ *Compras e Parcelas de ${nomeMes}:*\n`;
      h.lancamentos.slice(0, 8).forEach(item => {
        const cartaoInfo = item.cartao ? ` (${item.cartao})` : '';
        msgTexto += `• ${item.descricao} [${item.parcela}${cartaoInfo}]: *${fmt(item.valor)}*\n`;
      });
      if (h.lancamentos.length > 8) {
        msgTexto += `• ... e mais ${h.lancamentos.length - 8} compras no PDF anexo\n`;
      }
      msgTexto += `\n`;
    } else {
      msgTexto += `🛍️ *Compras deste mês:* Nenhuma nova compra no período.\n\n`;
    }

    // Parcelas Futuras se tiver no histórico
    if (extrato?.historico) {
      const futuras = extrato.historico.filter(hist => {
        if (hist.ano > ano) return true;
        if (hist.ano === ano && hist.mes > mes) return true;
        return false;
      });
      if (futuras.length > 0) {
        msgTexto += `⏳ *Parcelas nos próximos meses:*\n`;
        futuras.slice(0, 4).forEach(fut => {
          if (fut.total_gastos > 0) {
            msgTexto += `• ${fut.nome_mes}: *${fmt(fut.total_gastos)}*\n`;
          }
        });
        const totalFut = futuras.reduce((acc, fut) => acc + (fut.total_gastos || 0), 0);
        if (totalFut > 0) {
          msgTexto += `👉 *Total restante futuro: ${fmt(totalFut)}*\n\n`;
        }
      }
    }

    if (pessoa.token_acesso) {
      const linkPdf = `${window.location.origin}/public/fechamento/${pessoa.token_acesso}/${mes}/${ano}/pdf`;
      msgTexto += `📄 *BAIXAR EXTRATO COMPLETO EM PDF:*\n${linkPdf}\n\n`;
    }

    msgTexto += `Qualquer dúvida só me avisar! Abraço, Seu Luiz.`;

    try {
      // 1. Obtém o caminho absoluto do PDF gerado no backend
      const resPath = await pessoasApi.obterPdfPath(pessoa.id, mes, ano);
      const { pdf_path, telefone } = resPath.data || {};

      // 2. Tenta enviar pelo serviço WhatsApp Web local
      try {
        const resEnvio = await whatsappApi.sendPdf({
          telefone: telefone || pessoa.telefone,
          pdf_path: pdf_path,
          pdfPath: pdf_path,
          nome_pessoa: pessoa.nome,
          mes_ano: nomeMes,
          mensagem: msgTexto
        });

        if (resEnvio.data?.success) {
          alert(`✅ PDF de ${pessoa.nome} (${nomeMes}) enviado com sucesso pelo WhatsApp!`);
          setEnviandoWhats(false);
          return;
        }
      } catch (whatsErr) {
        // Se o serviço automático não estiver conectado ou der erro, abre via wa.me com a mensagem completa
        if (numLimpo) {
          window.open(`https://wa.me/${telefoneFinal}?text=${encodeURIComponent(msgTexto)}`, '_blank');
        } else {
          window.open('https://web.whatsapp.com', '_blank');
        }
      }
    } catch (err) {
      if (numLimpo) {
        window.open(`https://wa.me/${telefoneFinal}?text=${encodeURIComponent(msgTexto)}`, '_blank');
      } else {
        alert('Erro ao processar envio: ' + (err.response?.data?.detail || err.message));
      }
    } finally {
      setEnviandoWhats(false);
    }
  };

  return (
    <div className="card p-0 overflow-hidden shadow-sm hover:shadow-md transition-shadow">
      {/* Cabeçalho da Pessoa */}
      <div
        className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 cursor-pointer hover-surface transition-colors"
        onClick={handleToggle}
      >
        <div className="flex items-center gap-4">
          <Avatar nome={pessoa.nome} foto={pessoa.foto_path} cor={pessoa.cor} className="avatar--person" />
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-extrabold text-[var(--ink)] text-lg">{pessoa.nome}</h3>
              {pessoa.telefone && (
                <span className="text-xs text-[var(--muted)] font-mono">📱 {pessoa.telefone}</span>
              )}
            </div>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              Gastos neste mês: {fmt(pessoa.total_gastos_mes)}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-3">
          <div className="text-right">
            <span className="text-xs text-[var(--muted)] font-medium block">Situação Atual</span>
            {pessoa.saldo_devedor > 0 ? (
              <span className="badge-red text-sm py-1 px-3">Deve {fmt(pessoa.saldo_devedor)}</span>
            ) : pessoa.credito_a_favor > 0 ? (
              <span className="badge-blue text-sm py-1 px-3">Crédito {fmt(pessoa.credito_a_favor)}</span>
            ) : (
              <span className="badge-green text-sm py-1 px-3">Quitado ✓</span>
            )}
          </div>

          {/* Botões de Ação: Link de Lançamento, Editar e Excluir */}
          <div className="flex items-center gap-1 border-l pl-3 ml-2 border-[var(--line)]">
            {pessoa.token_acesso && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setModalLink(true);
                }}
                className="p-2 text-blue-500 hover:text-blue-400 hover:bg-blue-500/10 rounded-xl transition-colors"
                title="Abrir Link e Opções de Envio WhatsApp para esta pessoa"
              >
                <Link2 size={16} />
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); setModalEditar(true); }}
              className="p-2 text-[var(--muted)] hover:text-blue-500 hover:bg-[var(--accent-tint)] rounded-xl transition-colors"
              title="Editar Pessoa"
            >
              <Edit2 size={16} />
            </button>
            <button
              onClick={handleDelete}
              className="p-2 text-[var(--muted)] hover:text-rose-500 hover:bg-rose-500/10 rounded-xl transition-colors"
              title="Excluir Pessoa"
            >
              <Trash2 size={16} />
            </button>
          </div>

          <div className="p-2 text-[var(--muted)] hover:text-[var(--ink)]">
            {expanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
          </div>
        </div>
      </div>

      {/* Extrato Detalhado */}
      {expanded && (
        <div className="border-t border-[var(--line)] bg-[var(--canvas)]">
          <div className="p-4 bg-[var(--surface)] border-b border-[var(--line)] flex items-center justify-between">
            <span className="text-xs font-bold text-[var(--muted)] uppercase tracking-wider">Histórico Mensal de Fechamentos</span>
            <button
              onClick={() => setModalPagamento(true)}
              className="btn-success text-xs py-1.5 px-3"
            >
              <DollarSign size={14} /> Registrar Pagamento
            </button>
          </div>

          {loadingExtrato ? (
            <div className="p-8 text-center text-[var(--muted)] text-sm">Carregando extrato de {pessoa.nome}...</div>
          ) : extrato ? (
            <div className="divide-y divide-[var(--line)]">
              {extrato.historico.map((h, idx) => {
                const isSelected = mesAberto === idx;
                return (
                  <div key={idx} className={`transition-all ${isSelected ? 'bg-blue-950/20 border-y border-blue-500/40 shadow-inner' : 'bg-[var(--surface)]'}`}>
                    {/* Linha do Mês */}
                    <div
                      className={`p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer transition-all border-l-4 ${
                        isSelected
                          ? 'border-l-blue-500 bg-blue-500/15 text-white'
                          : h.is_atual
                            ? 'border-l-blue-400/50 bg-[var(--accent-tint)] hover-surface'
                            : 'border-l-transparent hover-surface'
                      }`}
                      onClick={() => setMesAberto(isSelected ? null : idx)}
                    >
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className={`font-black text-sm tracking-tight transition-colors ${
                          isSelected ? 'text-blue-400 text-base scale-105 origin-left' : 'text-[var(--ink)]'
                        }`}>
                          {h.nome_mes}
                        </span>

                        {isSelected ? (
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-blue-600 text-white flex items-center gap-1.5 shadow-md ring-2 ring-blue-400/40">
                            <span className="w-2 h-2 rounded-full bg-white animate-pulse"></span>
                            Visualizando
                          </span>
                        ) : h.is_atual ? (
                          <span className="badge-blue text-[10px]">Mês Atual</span>
                        ) : h.is_passado ? (
                          <span className="text-[var(--muted)] text-[11px]">Histórico</span>
                        ) : null}
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-4">
                        <div className="text-right">
                          {h.saldo_devedor > 0 ? (
                            <span className="text-rose-500 font-black text-sm">Pendente: {fmt(h.saldo_devedor)}</span>
                          ) : (
                            <span className="text-emerald-500 font-extrabold text-xs">Quitado ✓</span>
                          )}
                        </div>

                        {/* Botões de PDF e WhatsApp */}
                        <div className="flex items-center gap-2">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDownloadPDF(h.mes, h.ano); }}
                            disabled={gerandoPdf}
                            className="btn-secondary text-xs py-1 px-2.5"
                            title="Baixar PDF de Fechamento"
                          >
                            <Download size={13} /> PDF
                          </button>

                          <button
                            onClick={(e) => { e.stopPropagation(); handleEnviarWhatsApp(h.mes, h.ano, h.nome_mes, h); }}
                            disabled={enviandoWhats}
                            className="btn-success text-xs py-1 px-2.5"
                            title="Enviar Fechamento pelo WhatsApp"
                          >
                            <MessageCircle size={13} /> {enviandoWhats ? 'Enviando...' : 'WhatsApp'}
                          </button>

                          <div className={`p-1 rounded-lg transition-transform ${isSelected ? 'text-blue-400 bg-blue-500/20' : 'text-slate-400'}`}>
                            {isSelected ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Detalhes do Fechamento do Mês */}
                    {isSelected && (
                      <div className="p-5 bg-[var(--canvas)] border-t border-blue-500/30 border-l-4 border-l-blue-500 space-y-4">
                        {/* Banner de Contexto de Mês Selecionado */}
                        <div className="p-3.5 rounded-2xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center font-black text-base shadow">
                              📅
                            </div>
                            <div>
                              <div className="flex items-center gap-2 text-xs">
                                <span className="font-extrabold uppercase text-blue-400 tracking-wider">Fechamento Aberto</span>
                                <span className="text-slate-500">•</span>
                                <span className="text-slate-400">Pessoa: <strong className="text-[var(--ink)]">{pessoa.nome}</strong></span>
                              </div>
                              <p className="text-base font-black text-[var(--ink)] tracking-tight">
                                Mês de Referência: <span className="text-blue-400 underline decoration-blue-500 underline-offset-4">{h.nome_mes}</span>
                              </p>
                            </div>
                          </div>
                          <span className="hidden md:inline-block text-[11px] font-semibold text-slate-400 bg-slate-800/80 px-3 py-1 rounded-xl border border-slate-700/60">
                            Clique na linha de {h.nome_mes} para fechar
                          </span>
                        </div>

                        {/* 4 Blocos de Resumo do Fechamento */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <div className="bg-[var(--surface)] p-3 rounded-xl border border-[var(--line)]">
                            <span className="text-[11px] text-[var(--muted)] font-semibold block">Dívida Mês Anterior</span>
                            <span className={`text-sm font-bold ${h.saldo_anterior > 0 ? 'text-rose-500' : 'text-[var(--muted)]'}`}>
                              {fmt(h.saldo_anterior)}
                            </span>
                          </div>
                          <div className="bg-[var(--surface)] p-3 rounded-xl border border-[var(--line)]">
                            <span className="text-[11px] text-[var(--muted)] font-semibold block">Compras / Parcelas</span>
                            <span className="text-sm font-bold text-[var(--ink)]">{fmt(h.total_gastos)}</span>
                          </div>
                          <div className="bg-[var(--surface)] p-3 rounded-xl border border-[var(--line)]">
                            <span className="text-[11px] text-[var(--muted)] font-semibold block">Total a Pagar</span>
                            <span className="text-sm font-black text-blue-500">{fmt(h.total_a_pagar)}</span>
                          </div>
                          <div className="bg-[var(--surface)] p-3 rounded-xl border border-[var(--line)]">
                            <span className="text-[11px] text-[var(--muted)] font-semibold block">Pagamentos Recebidos</span>
                            <span className="text-sm font-bold text-emerald-500">{fmt(h.total_pagamentos)}</span>
                          </div>
                        </div>

                        {/* Lista de Compras/Parcelas do Mês */}
                        <div>
                          <h5 className="text-[11px] font-black text-[var(--muted)] uppercase tracking-wider mb-2 flex items-center gap-1.5">
                            <span>Compras no Cartão & Empréstimos de</span>
                            <span className="text-blue-400 font-extrabold">{h.nome_mes}</span>
                          </h5>
                          {h.lancamentos.length === 0 ? (
                            <p className="text-xs text-[var(--muted)] italic">Nenhum gasto registrado neste mês.</p>
                          ) : (
                            <div className="space-y-1.5">
                              {h.lancamentos.map((item, i) => (
                                <div key={i} className="flex items-center justify-between p-2.5 rounded-xl bg-[var(--surface)] border border-[var(--line)] text-xs">
                                  <div>
                                    <span className="font-bold text-[var(--ink)]">{item.descricao}</span>
                                    <div className="flex items-center gap-2 mt-0.5 text-[var(--muted)] text-[11px]">
                                      <span>{item.cartao ? `💳 ${item.cartao}` : '🏦 Conta'}</span>
                                      <span>•</span>
                                      <span className="font-semibold text-blue-500">{item.parcela}</span>
                                      <span>•</span>
                                      <span>{new Date(item.data_lancamento + 'T00:00:00').toLocaleDateString('pt-BR')}</span>
                                    </div>
                                  </div>
                                  <span className="font-black text-[var(--ink)] text-sm">{fmt(item.valor)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Lista de Pagamentos Recebidos */}
                        {h.pagamentos.length > 0 && (
                          <div>
                            <h5 className="text-[11px] font-black text-emerald-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                              <span>Pagamentos Recebidos em</span>
                              <span className="text-emerald-300 font-extrabold">{h.nome_mes}</span>
                            </h5>
                            <div className="space-y-1.5">
                              {h.pagamentos.map((pag, i) => (
                                <div key={i} className="flex items-center justify-between p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs">
                                  <div>
                                    <span className="font-bold text-emerald-400">Pagamento recebido</span>
                                    <p className="text-emerald-300/80 text-[11px]">
                                      {new Date(pag.data + 'T00:00:00').toLocaleDateString('pt-BR')}
                                      {pag.forma_pagamento && ` • ${pag.forma_pagamento}`}
                                      {pag.observacao && ` • ${pag.observacao}`}
                                      {pag.conta && ` • Entrou em: ${pag.conta}`}
                                    </p>
                                  </div>
                                  <span className="font-black text-emerald-400 text-sm">+{fmt(pag.valor)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      )}

      {modalPagamento && (
        <ModalRegistrarPagamento
          pessoa={pessoa}
          contas={contas}
          onClose={() => setModalPagamento(false)}
          onSaved={() => { setExtrato(null); carregarExtrato(); onRefresh(); }}
        />
      )}

      {modalEditar && (
        <ModalEditarPessoa
          pessoa={pessoa}
          onClose={() => setModalEditar(false)}
          onSaved={() => { setExtrato(null); carregarExtrato(); onRefresh(); }}
        />
      )}

      {modalLink && (
        <ModalLinkLancamento
          pessoa={pessoa}
          onClose={() => setModalLink(false)}
        />
      )}
    </div>
  );
}

export default function Pessoas() {
  const [lista, setLista] = useState([]);
  const [contas, setContas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalNovo, setModalNovo] = useState(false);

  const carregar = async () => {
    setLoading(true);
    try {
      const [resP, resC] = await Promise.all([
        pessoasApi.listar(),
        contasApi.listar()
      ]);
      setLista(resP.data);
      setContas(resC.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregar();
  }, []);

  const totalPendente = lista.reduce((acc, p) => acc + p.saldo_devedor, 0);

  return (
    <div className="space-y-6">
      <div className="page-heading">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">Pessoas & Fechamentos</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Total a receber de todos: <strong className="text-rose-600">{fmt(totalPendente)}</strong>
          </p>
        </div>
        <button onClick={() => setModalNovo(true)} className="btn-primary text-sm shadow-md shadow-blue-600/20">
          <Plus size={18} /> Nova Pessoa
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Carregando pessoas...</div>
      ) : lista.length === 0 ? (
        <div className="card text-center py-16">
          <div className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <Users size={28} />
          </div>
          <h3 className="font-bold text-gray-900 text-lg">Nenhuma pessoa cadastrada</h3>
          <p className="text-gray-400 text-sm max-w-sm mx-auto mt-1 mb-5">
            Cadastre as pessoas que usam seus cartões (Thais, Luane, Alexandre...) para controlar saldos e gerar fechamentos em PDF.
          </p>
          <button onClick={() => setModalNovo(true)} className="btn-primary text-sm">
            Cadastrar Primeira Pessoa
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {lista.map(p => (
            <CardPessoa key={p.id} pessoa={p} contas={contas} onRefresh={carregar} />
          ))}
        </div>
      )}

      {modalNovo && (
        <ModalNovaPessoa onClose={() => setModalNovo(false)} onSaved={carregar} />
      )}
    </div>
  );
}
