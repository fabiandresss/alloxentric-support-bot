import React, { useEffect, useState } from 'react';
import { Check, Cpu, Loader2 } from 'lucide-react';
import * as api from '../api/client';
import { AiModelOption } from '../types';
import { ProviderLogo } from './ProviderLogo';

interface ModelPickerProps {
  value: string;
  onChange: (id: string) => void;
}

/** Elige el modelo de IA del agente. El catálogo viene del backend (GET /modelos-ia). */
export const ModelPicker: React.FC<ModelPickerProps> = ({ value, onChange }) => {
  const [models, setModels] = useState<AiModelOption[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    api.getAiModels().then((m) => alive && setModels(m)).catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, []);

  return (
    <div data-testid="model-picker">
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs font-semibold text-[color:var(--c-ink)] flex items-center gap-1.5">
          <Cpu className="w-3.5 h-3.5 text-[#D20A2E]" /> Modelo de IA
        </label>
        <span className="text-[11px] text-[color:var(--c-muted)]">Se ejecuta en AWS Bedrock</span>
      </div>

      {!models && !failed && (
        <div className="flex items-center gap-2 text-xs text-[color:var(--c-muted)] py-4"><Loader2 className="w-4 h-4 animate-spin" /> Cargando modelos…</div>
      )}
      {failed && <p className="text-xs text-[color:var(--c-rtx)]">No se pudo cargar el catálogo de modelos.</p>}

      {models && (
        <div role="radiogroup" aria-label="Modelo de IA" className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {models.map((m) => {
            const selected = m.id === value;
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={selected}
                data-testid={`model-${m.id}`}
                onClick={() => onChange(m.id)}
                className={`group relative text-left flex items-start gap-3 p-3 rounded-xl border transition-all ${
                  selected
                    ? 'border-[#D20A2E] bg-[color:var(--c-ch50)] ring-2 ring-[#D20A2E]/15'
                    : 'border-[color:var(--c-line)] bg-white hover:border-[color:var(--c-ch350)] hover:-translate-y-0.5'
                }`}
              >
                <span className="w-10 h-10 shrink-0 rounded-xl bg-[color:var(--c-canvas)] border border-[color:var(--c-line)] flex items-center justify-center">
                  <ProviderLogo provider={m.providerId} size={22} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-semibold text-[color:var(--c-ink)]">{m.name}</span>
                    {m.recommended && (
                      <span className="text-[10px] font-bold text-[#D20A2E] bg-[color:var(--c-ch150)] rounded-full px-1.5 py-px">Recomendado</span>
                    )}
                  </span>
                  <span className="block text-[11px] font-medium text-[color:var(--c-muted)]">{m.provider}</span>
                  <span className="block text-[11px] text-[color:var(--c-muted)] mt-1 leading-snug">{m.description}</span>
                </span>
                <span
                  className={`absolute top-2.5 right-2.5 w-4 h-4 rounded-full flex items-center justify-center transition-all ${
                    selected ? 'bg-[#D20A2E] text-white scale-100' : 'border border-[color:var(--c-line2)] scale-90 opacity-60'
                  }`}
                >
                  {selected && <Check className="w-3 h-3" strokeWidth={3} />}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <p className="text-[10px] text-[color:var(--c-muted)] mt-2">
        El cambio aplica a las respuestas nuevas del agente al publicar. Si el modelo no responde, el agente contesta con el fragmento más relevante de la documentación.
      </p>
    </div>
  );
};
