import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { solicitacoes, mediaUrl } from '../api/client';
import Avatar from '../components/Avatar';
import {
  CreditCard, Upload, CheckCircle2, AlertCircle, ShoppingBag,
  HandCoins, Calendar, Camera, ArrowRight, ShieldCheck
} from 'lucide-react';

export default function LancarCompra() {
  const { token } = useParams();
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [dados, setDados] = useState(null);

  // Form state
  const [tipo, setTipo] = useState('compra_cartao'); // 'compra_cartao' | 'compra_para_mim'
  const [cartaoId, setCartaoId] = useState('');
  const [descricao, setDescricao] = useState('');
  const [valor, setValor] = useState('');
  const [parcelas, setParcelas] = useState(1);
  const [dataCompra, setDataCompra] = useState(new Date().toISOString().split('T')[0]);
  const [observacoes, setObservacoes] = useState('');
  const [arquivo, setArquivo] = useState(null);
  const [previewFoto, setPreviewFoto] = useState(null);

  const [enviando, setEnviando] = useState(false);
  const [sucesso, setSucesso] = useState(false);

  useEffect(() => {
    const carregar = async () => {
      setCarregando(true);
      setErro(null);
      try {
        const res = await solicitacoes.obterDadosPublicos(token);
        setDados(res.data);
        if (res.data?.cartoes?.length > 0) {
          setCartaoId(res.data.cartoes[0].id.toString());
        }
      } catch (err) {
        setErro(err.response?.data?.detail || 'Link de lançamento inválido ou indisponível.');
      } finally {
        setCarregando(false);
      }
    };
    if (token) carregar();
  }, [token]);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setArquivo(file);
      if (file.type.startsWith('image/')) {
        setPreviewFoto(URL.createObjectURL(file));
      } else {
        setPreviewFoto(null);
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!valor || parseFloat(valor) <= 0) {
      alert('Informe um valor válido maior que zero.');
      return;
    }
    if (!descricao.trim()) {
      alert('Informe a descrição da compra.');
      return;
    }

    setEnviando(true);
    try {
      const formData = new FormData();
      formData.append('descricao', descricao.trim());
      formData.append('valor', valor);
      formData.append('tipo_solicitacao', tipo);
      if (tipo === 'compra_cartao' && cartaoId) {
        formData.append('cartao_id', cartaoId);
      }
      formData.append('total_parcelas', parcelas.toString());
      formData.append('data_compra', dataCompra);
      if (observacoes.trim()) {
        formData.append('observacoes', observacoes.trim());
      }
      if (arquivo) {
        formData.append('comprovante', arquivo);
      }

      await solicitacoes.enviarPublico(token, formData);
      setSucesso(true);
    } catch (err) {
      alert('Erro ao enviar compra: ' + (err.response?.data?.detail || err.message));
    } finally {
      setEnviando(false);
    }
  };

  if (carregando) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-slate-400">Carregando painel de lançamento...</p>
        </div>
      </div>
    );
  }

  const gestorNome = dados?.gestor_nome || 'o responsável';

  if (erro) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
        <div className="card max-w-md w-full p-6 text-center space-y-4 border border-rose-900/50 bg-slate-900">
          <AlertCircle size={44} className="text-rose-500 mx-auto" />
          <h2 className="text-xl font-black text-white">Link Indisponível</h2>
          <p className="text-sm text-slate-400">{erro}</p>
          <p className="text-xs text-slate-500">Peça um novo link pelo WhatsApp.</p>
        </div>
      </div>
    );
  }

  if (sucesso) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
        <div className="card max-w-md w-full p-8 text-center space-y-5 border border-emerald-900/50 bg-slate-900">
          <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center mx-auto">
            <CheckCircle2 size={36} />
          </div>
          <h2 className="text-2xl font-black text-white">Lançamento Enviado!</h2>
          <p className="text-sm text-slate-300">
            Sua compra de <strong className="text-emerald-400">R$ {parseFloat(valor).toFixed(2).replace('.', ',')}</strong> foi enviada para <strong>{gestorNome}</strong> e já aparece na lista de aprovações no celular e no computador.
          </p>
          <button
            onClick={() => {
              setSucesso(false);
              setDescricao('');
              setValor('');
              setParcelas(1);
              setObservacoes('');
              setArquivo(null);
              setPreviewFoto(null);
            }}
            className="btn-primary w-full py-3"
          >
            Lançar Outra Compra
          </button>
        </div>
      </div>
    );
  }

  const pessoa = dados?.pessoa;
  const cartoes = dados?.cartoes || [];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-6 flex flex-col items-center justify-center">
      <div className="w-full max-w-lg space-y-5">
        {/* Identificação da Pessoa */}
        <div className="card p-5 border border-slate-800 bg-slate-900 flex items-center justify-between shadow-xl">
          <div className="flex items-center gap-3.5 min-w-0">
            <Avatar nome={pessoa?.nome} foto={mediaUrl(pessoa?.foto_path)} className="w-12 h-12 rounded-2xl shrink-0" />
            <div className="min-w-0">
              <span className="text-xs text-slate-400 block">Lançamento em nome de:</span>
              <h2 className="text-lg font-black text-white truncate">{pessoa?.nome}</h2>
            </div>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 text-xs font-bold">
            <ShieldCheck size={14} />
            <span>Link Seguro</span>
          </div>
        </div>

        {/* Formulário de Envio */}
        <form onSubmit={handleSubmit} className="card p-6 border border-slate-800 bg-slate-900 space-y-5 shadow-2xl">
          {/* Alternador de Tipo de Lançamento */}
          <div>
            <label className="label text-slate-300 font-semibold mb-2 block">O que você está lançando?</label>
            <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-950 border border-slate-800">
              <button
                type="button"
                onClick={() => setTipo('compra_cartao')}
                className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs font-bold transition-all ${
                  tipo === 'compra_cartao'
                    ? 'bg-blue-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <ShoppingBag size={16} />
                <span>Usei Cartão</span>
              </button>

              <button
                type="button"
                onClick={() => setTipo('compra_para_mim')}
                className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs font-bold transition-all ${
                  tipo === 'compra_para_mim'
                    ? 'bg-purple-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <HandCoins size={16} />
                <span className="truncate">Comprei p/ {gestorNome}</span>
              </button>
            </div>
            <p className="text-[11px] text-slate-400 mt-1.5">
              {tipo === 'compra_cartao'
                ? `Compra parcelada ou à vista feita no cartão de crédito de ${gestorNome}.`
                : `Você pagou algo do seu bolso para ${gestorNome} (o valor será abatido da sua dívida).`}
            </p>
          </div>

          {/* Se for no Cartão: Seleção do Cartão */}
          {tipo === 'compra_cartao' && (
            <div>
              <label className="label text-slate-300 font-semibold">Qual cartão você usou?</label>
              <select
                className="input text-white bg-slate-950 font-bold"
                value={cartaoId}
                onChange={e => setCartaoId(e.target.value)}
                required
              >
                {cartoes.map(c => (
                  <option key={c.id} value={c.id} className="bg-slate-900 text-white">
                    {c.nome} ({c.bandeira || 'Cartão'})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Descrição */}
          <div>
            <label className="label text-slate-300 font-semibold">O que foi comprado?</label>
            <input
              type="text"
              required
              className="input text-white bg-slate-950"
              placeholder="Ex: Tênis Netshoes, Farmácia, Remédio..."
              value={descricao}
              onChange={e => setDescricao(e.target.value)}
            />
          </div>

          {/* Valor e Parcelas */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label text-slate-300 font-semibold">Valor Total (R$)</label>
              <input
                type="number"
                step="0.01"
                required
                className="input text-white bg-slate-950 font-black text-lg"
                placeholder="0,00"
                value={valor}
                onChange={e => setValor(e.target.value)}
              />
            </div>

            <div>
              <label className="label text-slate-300 font-semibold">Parcelas</label>
              <select
                className="input text-white bg-slate-950"
                value={parcelas}
                onChange={e => setParcelas(Number(e.target.value))}
                disabled={tipo === 'compra_para_mim'}
              >
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(n => (
                  <option key={n} value={n} className="bg-slate-900 text-white">
                    {n === 1 ? 'À vista (1x)' : `${n}x de R$ ${valor ? (parseFloat(valor) / n).toFixed(2).replace('.', ',') : '0,00'}`}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Data da Compra */}
          <div>
            <label className="label text-slate-300 font-semibold">Data da Compra</label>
            <input
              type="date"
              className="input text-white bg-slate-950"
              value={dataCompra}
              onChange={e => setDataCompra(e.target.value)}
            />
          </div>

          {/* Foto do Comprovante / Nota Fiscal */}
          <div>
            <label className="label text-slate-300 font-semibold">Foto do Comprovante / Nota (Opcional)</label>
            <label className="flex flex-col items-center justify-center p-4 border-2 border-dashed border-slate-700 hover:border-blue-500 rounded-2xl cursor-pointer bg-slate-950 transition-colors">
              {previewFoto ? (
                <div className="space-y-2 text-center">
                  <img src={previewFoto} alt="Preview" className="h-32 object-contain rounded-lg mx-auto" />
                  <span className="text-xs text-blue-400 font-bold block">Trocar foto</span>
                </div>
              ) : (
                <div className="text-center space-y-1">
                  <Camera size={26} className="text-slate-400 mx-auto" />
                  <span className="text-xs font-bold text-slate-300 block">Tirar foto ou anexar comprovante</span>
                  <span className="text-[10px] text-slate-500 block">JPG, PNG ou PDF</span>
                </div>
              )}
              <input
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={handleFileChange}
              />
            </label>
          </div>

          {/* Observações */}
          <div>
            <label className="label text-slate-300 font-semibold">Observações (Opcional)</label>
            <textarea
              rows={2}
              className="input text-white bg-slate-950 text-sm"
              placeholder={`Ex: Compra autorizada por ${gestorNome}`}
              value={observacoes}
              onChange={e => setObservacoes(e.target.value)}
            />
          </div>

          {/* Botão de Envio */}
          <button
            type="submit"
            disabled={enviando}
            className="btn-primary w-full py-3.5 text-base font-black flex items-center justify-center gap-2 shadow-lg shadow-blue-600/30"
          >
            {enviando ? (
              <span>Enviando Lançamento...</span>
            ) : (
              <>
                <span>Enviar para Aprovação</span>
                <ArrowRight size={18} />
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
