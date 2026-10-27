import React, { useState } from 'react';
import { X, Copy, Check, Code, ExternalLink, Sparkles } from 'lucide-react';
import { Company } from '../types';
import { rotateApiKey } from '../api/client';

interface EmbedWidgetModalProps {
  company: Company;
  onClose: () => void;
}

export const EmbedWidgetModal: React.FC<EmbedWidgetModalProps> = ({ company, onClose }) => {
  const [copied, setCopied] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);

  const handleGenerateKey = async () => {
    setKeyError(null);
    try {
      setApiKey((await rotateApiKey(company.slug)).apiKey ?? null);
    } catch (e) {
      setKeyError(e instanceof Error ? e.message : String(e));
    }
  };

  const embedSnippet = `<!-- Alloxentric SupportHub AI Web Widget for ${company.name} -->
<script
  src="${window.location.origin}/widget.min.js"
  data-tenant-id="${company.slug}"
  data-agent-name="${company.agentName}"
  data-primary-color="${company.brandColor}"
  data-position="right"
  defer>
</script>`;

  const handleCopy = () => {
    navigator.clipboard.writeText(embedSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#1E1B4B]/40 backdrop-blur-xs animate-in fade-in duration-200">
      <div 
        className="bg-white rounded-2xl border border-[#E2E8F0] shadow-2xl w-full max-w-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#EEF2FF] flex items-center justify-center text-[#4F46E5]">
              <Code className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#1E1B4B]">
                Widget embebible — {company.name}
              </h3>
              <p className="text-[11px] text-[#64748B]">
                Pega este script antes del cierre de la etiqueta &lt;/body&gt; en tu sitio web o aplicación SaaS.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[#64748B] hover:text-[#1E1B4B] hover:bg-[#F1F5F9] rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="relative">
            <pre className="bg-[#1E1B4B] text-[#93C5FD] p-4 rounded-xl text-xs font-mono overflow-x-auto leading-relaxed border border-[#312E81]">
              <code>{embedSnippet}</code>
            </pre>
            <button
              onClick={handleCopy}
              className="absolute top-3 right-3 px-3 py-1.5 bg-[#4F46E5] hover:bg-[#4338CA] text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-all"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-[#22C55E]" />
                  <span>¡Código copiado!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copiar script</span>
                </>
              )}
            </button>
          </div>

          <div className="p-3.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-xs text-[#1E1B4B] flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold">API key del widget</p>
              <p className="text-[11px] text-[#64748B] mt-0.5">
                Para integraciones propias vía POST /chat (el widget no la necesita). Se muestra una sola vez; generar una nueva invalida la anterior.
              </p>
              {apiKey && <code className="block mt-1.5 text-[11px] font-mono break-all text-[#4F46E5]">{apiKey}</code>}
              {keyError && <p className="mt-1.5 text-[11px] text-[#B91C1C]">{keyError}</p>}
            </div>
            <button
              onClick={handleGenerateKey}
              className="shrink-0 px-3 py-1.5 bg-white border border-[#E2E8F0] rounded-lg text-xs font-semibold hover:bg-[#F1F5F9]"
            >
              {apiKey ? 'Regenerar' : 'Generar API key'}
            </button>
          </div>

          <div className="p-3.5 rounded-xl bg-[#F0FDFA] border border-[#CCFBF1] flex items-start gap-2.5 text-xs text-[#0D9488]">
            <Sparkles className="w-4 h-4 text-[#14B8A6] shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-[#0F766E]">Integración con RAG & Corestream lista</p>
              <p className="text-[11px] text-[#134E4A] mt-0.5">
                El widget incluye detección semántica automática y formulario de derivación con notificación push directa a esta consola de agentes.
              </p>
            </div>
          </div>
        </div>

        <div className="px-6 py-3 bg-[#F8FAFC] border-t border-[#E2E8F0] flex items-center justify-between">
          <a
            href="/wellq-landing.html"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#E0F2FE] border border-[#BAE6FD] text-xs font-semibold text-[#0369A1] rounded-lg hover:bg-[#BAE6FD] transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>Ver Landing Page Demo en vivo</span>
          </a>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-white border border-[#E2E8F0] text-xs font-semibold text-[#1E1B4B] rounded-lg hover:bg-[#F1F5F9] transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
