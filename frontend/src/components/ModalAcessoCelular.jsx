import { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { pessoas as pessoasApi } from '../api/client';
import { Smartphone, Copy, Check, ExternalLink, X, Send, ShieldCheck, QrCode } from 'lucide-react';

export default function ModalAcessoCelular({ isOpen, onClose }) {
  const [copied, setCopied] = useState(false);
  const [copiedPessoaId, setCopiedPessoaId] = useState(null);
  const [linkTipo, setLinkTipo] = useState('nuvem'); // 'nuvem' | 'tunel'
  const [pessoas, setPessoas] = useState([]);

  const urlNuvem = 'https://sistema-seu-luiz.onrender.com';
  const urlTunel = 'https://producer-cancellation-connections-airline.trycloudflare.com';
  const urlAtual = linkTipo === 'nuvem' ? urlNuvem : urlTunel;

  useEffect(() => {
    if (isOpen) {
      pessoasApi.listar()
        .then(res => setPessoas(res.data || []))
        .catch(() => setPessoas([]));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCopy = (texto, pessoaId = null) => {
    navigator.clipboard.writeText(texto);
    if (pessoaId) {
      setCopiedPessoaId(pessoaId);
      setTimeout(() => setCopiedPessoaId(null), 2000);
    } else {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleEnviarWhatsPessoa = (p) => {
    const linkPessoa = `${urlAtual}/lancar/${p.token_acesso}`;
    const numLimpo = (p.telefone || '').replace(/\D/g, '');
    const telFinal = numLimpo.startsWith('55') ? numLimpo : `55${numLimpo}`;
    const msg = `Olá, *${p.nome}*! 👋\n\nAqui está o seu link exclusivo para lançar compras e notas com foto direto do seu celular:\n\n👉 ${linkPessoa}\n\nVocê pode salvar esse link na tela inicial do seu celular como um app!`;
    if (numLimpo) {
      window.open(`https://wa.me/${telFinal}?text=${encodeURIComponent(msg)}`, '_blank');
    } else {
      window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="card rounded-3xl shadow-2xl w-full max-w-xl p-5 sm:p-7 border border-slate-700/60 my-auto">
        {/* Cabeçalho */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-700/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-600/20 text-blue-400 flex items-center justify-center">
              <Smartphone size={22} />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-black text-ink tracking-tight">Acesso no Celular</h2>
              <p className="text-xs text-slate-400">Escaneie o QR Code ou copie os links para usar no smartphone</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-ink rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-5 pt-4">
          {/* Seletor de Servidor */}
          <div className="flex gap-2 p-1 rounded-xl bg-slate-900 border border-slate-800">
            <button
              onClick={() => setLinkTipo('nuvem')}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all ${
                linkTipo === 'nuvem'
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              ☁️ Nuvem 24/7 (Recomendado)
            </button>
            <button
              onClick={() => setLinkTipo('tunel')}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all ${
                linkTipo === 'tunel'
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              💻 Conexão Direta PC
            </button>
          </div>

          {/* Área do QR Code e Link Principal */}
          <div className="p-5 rounded-2xl border border-slate-700/50 flex flex-col sm:flex-row items-center gap-5" style={{ backgroundColor: 'var(--raised)' }}>
            <div className="bg-white p-3 rounded-2xl shadow-lg shrink-0 flex items-center justify-center">
              <QRCodeSVG
                value={urlAtual}
                size={140}
                level="M"
                includeMargin={false}
              />
            </div>

            <div className="flex-1 space-y-3 text-center sm:text-left">
              <div>
                <span className="text-[11px] font-bold text-blue-400 uppercase tracking-wider block">
                  Link do Sistema Completo ({linkTipo === 'nuvem' ? 'Nuvem 24h' : 'PC Local'})
                </span>
                <p className="text-xs font-mono text-ink break-all mt-1 bg-black/40 p-2 rounded-lg border border-slate-700/40">
                  {urlAtual}
                </p>
              </div>

              <div className="flex flex-wrap gap-2 justify-center sm:justify-start">
                <button
                  onClick={() => handleCopy(urlAtual)}
                  className="btn-primary text-xs py-2 px-3.5 flex items-center gap-1.5 shadow"
                >
                  {copied ? <Check size={14} className="text-emerald-300" /> : <Copy size={14} />}
                  <span>{copied ? 'Link Copiado!' : 'Copiar Link'}</span>
                </button>

                <a
                  href={urlAtual}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-secondary text-xs py-2 px-3 flex items-center gap-1"
                >
                  <ExternalLink size={14} />
                  <span>Abrir</span>
                </a>
              </div>
            </div>
          </div>

          {/* Links Individuais para Lançamento de Compras */}
          {pessoas.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-extrabold text-ink uppercase tracking-wider">
                  Links das Meninas (Lançar Compras com Foto)
                </span>
                <span className="text-[11px] text-slate-400">Não veem suas finanças</span>
              </div>

              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {pessoas.map(p => {
                  if (!p.token_acesso) return null;
                  const linkP = `${urlAtual}/lancar/${p.token_acesso}`;
                  const isCopied = copiedPessoaId === p.id;
                  return (
                    <div
                      key={p.id}
                      className="p-2.5 rounded-xl border border-slate-700/40 flex items-center justify-between gap-2 text-xs"
                      style={{ backgroundColor: 'var(--surface)' }}
                    >
                      <div className="min-w-0">
                        <span className="font-bold text-ink block truncate">{p.nome}</span>
                        <span className="text-[10px] text-slate-400 font-mono truncate block">/lancar/{p.token_acesso}</span>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => handleCopy(linkP, p.id)}
                          className="p-1.5 rounded-lg border border-slate-700/60 text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                          title="Copiar link desta pessoa"
                        >
                          {isCopied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                        </button>
                        <button
                          onClick={() => handleEnviarWhatsPessoa(p)}
                          className="p-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
                          title="Enviar link pelo WhatsApp"
                        >
                          <Send size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Dica de Instalação como App no Celular */}
          <div className="p-3.5 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-xs space-y-1.5 text-slate-300">
            <div className="flex items-center gap-2 font-bold text-blue-400">
              <ShieldCheck size={16} />
              <span>Como salvar como Aplicativo no Celular:</span>
            </div>
            <p className="text-[11px] leading-relaxed">
              • <strong>No Android (Chrome):</strong> Abra o link, clique nos 3 pontinhos do navegador e escolha <strong>"Instalar aplicativo"</strong> ou <strong>"Adicionar à tela inicial"</strong>.
            </p>
            <p className="text-[11px] leading-relaxed">
              • <strong>No iPhone (Safari):</strong> Abra o link, toque no botão de Compartilhar (quadrado com seta pra cima) e selecione <strong>"Adicionar à Tela de Início"</strong>.
            </p>
          </div>
        </div>

        <div className="pt-4 mt-4 border-t border-slate-700/50 flex justify-end">
          <button onClick={onClose} className="btn-secondary text-xs px-4 py-2">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
