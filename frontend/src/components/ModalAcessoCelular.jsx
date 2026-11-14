import { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { pessoas as pessoasApi, PUBLIC_CLOUD_URL } from '../api/client';
import { Smartphone, Copy, Check, ExternalLink, X, Send, ShieldCheck } from 'lucide-react';

export default function ModalAcessoCelular({ isOpen, onClose }) {
  const [copied, setCopied] = useState(false);
  const [copiedPessoaId, setCopiedPessoaId] = useState(null);
  const [pessoas, setPessoas] = useState([]);

  const urlAtual = PUBLIC_CLOUD_URL;

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
            <img
              src="/logo-oficial.png"
              alt="Administração Financeira"
              className="w-12 h-12 object-contain shrink-0 select-none drop-shadow"
              draggable={false}
            />
            <div>
              <h2 className="text-lg sm:text-xl font-black text-ink tracking-tight">Acesso no Celular 24/7</h2>
              <p className="text-xs text-slate-400">Entre no celular com o mesmo usuário e senha deste PC</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-ink rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-5 pt-4">
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
                  Link Oficial Nuvem 24/7 (Sincronizado PC ↔ Celular)
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
                  Links Individuais (Lançar Compras com Foto)
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
