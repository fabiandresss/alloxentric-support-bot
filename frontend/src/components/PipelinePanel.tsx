import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, Loader2, RefreshCw, RotateCcw, Save, SlidersHorizontal } from 'lucide-react';
import * as api from '../api/client';
import { PipelineConfig, PipelineState } from '../types';

interface PipelinePanelProps {
  slug: string;
  onToast: (type: 'success' | 'warning' | 'info', title: string, description?: string) => void;
  /** Se llama tras pedir el reprocesado, para que la vista refresque documentos y fragmentos. */
  onReprocessed: () => void;
}

const card = 'bg-white border border-[color:var(--c-line)] rounded-2xl card-glow';

const Campo: React.FC<{ id: keyof PipelineConfig; label: string; hint: string; unit?: string; value: number; def: number; limits: [number, number]; onChange: (v: number) => void }> =
  ({ id, label, hint, unit, value, def, limits, onChange }) => (
    <div className="p-3.5 rounded-xl bg-[color:var(--c-canvas)] border border-[color:var(--c-line)]">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={`pl-${id}`} className="text-xs font-semibold text-[color:var(--c-ink)]">{label}</label>
        <div className="flex items-center gap-1.5">
          <input id={`pl-${id}`} data-testid={`pipeline-${id}`} type="number" min={limits[0]} max={limits[1]} value={value}
            onChange={(e) => onChange(e.target.value === '' ? limits[0] : Number(e.target.value))}
            className="w-20 px-2 py-1 text-xs text-right tabular-nums rounded-lg border border-[color:var(--c-line)] bg-white focus:outline-none focus:ring-2 focus:ring-[#D20A2E]/30" />
          {unit && <span className="text-[11px] text-[color:var(--c-muted)] w-14">{unit}</span>}
        </div>
      </div>
      <input type="range" aria-label={label} min={limits[0]} max={limits[1]} value={Math.min(Math.max(value, limits[0]), limits[1])} onChange={(e) => onChange(Number(e.target.value))}
        className="w-full mt-2.5 accent-[#D20A2E]" />
      <p className="text-[11px] text-[color:var(--c-muted)] mt-1">{hint} <span className="whitespace-nowrap">· defecto {def}, rango {limits[0]}–{limits[1]}</span></p>
    </div>
  );

const Interruptor: React.FC<{ on: boolean; onChange: (v: boolean) => void; label: string; hint: string; testId: string }> = ({ on, onChange, label, hint, testId }) => (
  <button type="button" role="switch" aria-checked={on} data-testid={testId} onClick={() => onChange(!on)}
    className={`w-full flex items-start gap-3 p-3.5 rounded-xl border text-left transition-all ${on ? 'border-[#D20A2E] bg-[color:var(--c-ch50)]' : 'border-[color:var(--c-line)] bg-white'}`}>
    <span className={`mt-0.5 w-9 h-5 rounded-full p-0.5 shrink-0 transition-colors ${on ? 'bg-[#D20A2E]' : 'bg-[color:var(--c-line2)]'}`}><span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : ''}`} /></span>
    <span><span className="block text-xs font-semibold text-[color:var(--c-ink)]">{label}</span><span className="block text-[11px] text-[color:var(--c-muted)] mt-0.5">{hint}</span></span>
  </button>
);

export const PipelinePanel: React.FC<PipelinePanelProps> = ({ slug, onToast, onReprocessed }) => {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<PipelineState | null>(null);
  const [draft, setDraft] = useState<PipelineConfig | null>(null);
  const [busy, setBusy] = useState<'guardar' | 'reprocesar' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const st = await api.getPipeline(slug);
      setState(st);
      setDraft(st.config);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el pipeline');
    }
  }, [slug]);
  useEffect(() => { setState(null); setDraft(null); cargar(); }, [cargar]);

  if (!state || !draft) {
    return error ? <div className="p-4 rounded-xl border border-[color:var(--c-rline)] bg-[color:var(--c-rbg)] text-xs text-[color:var(--c-rtx2)]">{error}</div> : null;
  }

  const sucio = (Object.keys(draft) as (keyof PipelineConfig)[]).some((k) => draft[k] !== state.config[k]);
  const lim = (k: string) => state.limits[k] as [number, number];
  const set = <K extends keyof PipelineConfig>(k: K, v: PipelineConfig[K]) => setDraft({ ...draft, [k]: v });
  // validación en el cliente (el servidor vuelve a validar)
  const problema =
    draft.chunkMin >= draft.chunkMax ? 'El tamaño mínimo debe ser menor que el máximo.'
    : draft.chunkOverlap > Math.floor(draft.chunkMax / 3) ? 'El solapamiento no puede superar un tercio del tamaño máximo.'
    : (['chunkMax', 'chunkMin', 'chunkOverlap', 'topK'] as const).find((k) => draft[k] < lim(k)[0] || draft[k] > lim(k)[1])
      ? 'Hay un valor fuera de rango.' : null;

  const guardar = async () => {
    setBusy('guardar');
    try {
      const st = await api.savePipeline(slug, draft);
      setState(st); setDraft(st.config);
      onToast('success', 'Pipeline guardado', 'Top-k, búsqueda híbrida y OCR aplican desde ahora. El tamaño de fragmentos aplica a lo que subas; para lo ya ingestado usa «Reprocesar documentos».');
    } catch (e) { onToast('warning', 'No se pudo guardar', e instanceof Error ? e.message : undefined); }
    finally { setBusy(null); }
  };
  const reprocesar = async () => {
    setBusy('reprocesar');
    try {
      const r = await api.reprocessKb(slug);
      onToast(r.queued ? 'success' : 'info', r.queued ? `Reprocesando ${r.queued} documento${r.queued > 1 ? 's' : ''}` : 'No hay documentos que reprocesar',
        r.skipped ? `${r.skipped} sin archivo (p. ej. los de ejemplo) se omitieron.` : 'Se vuelven a fragmentar y vectorizar con los ajustes vigentes.');
      onReprocessed();
      await cargar();
    } catch (e) { onToast('warning', 'No se pudo reprocesar', e instanceof Error ? e.message : undefined); }
    finally { setBusy(null); }
  };

  return (
    <section className={`${card} overflow-hidden animate-fade-up`} aria-label="Pipeline de ingesta y recuperación" data-testid="pipeline-panel">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} data-testid="pipeline-toggle" className="w-full flex items-center gap-3 p-5 text-left">
        <span className="w-9 h-9 rounded-xl bg-[color:var(--c-ch100)] text-[#D20A2E] flex items-center justify-center shrink-0"><SlidersHorizontal className="w-4 h-4" /></span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-bold text-[color:var(--c-ink)]">Pipeline de ingesta y recuperación</span>
          <span className="block text-[11px] text-[color:var(--c-muted)] mt-0.5 truncate">
            Fragmentos de {state.config.chunkMin}–{state.config.chunkMax} caracteres{state.config.chunkOverlap ? ` con ${state.config.chunkOverlap} de solapamiento` : ''} · top-k {state.config.topK} · búsqueda {state.config.hybrid ? 'híbrida' : 'solo vectorial'}
          </span>
        </span>
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${state.customized ? 'bg-[color:var(--c-ch100)] text-[#D20A2E]' : 'bg-[color:var(--c-soft)] text-[color:var(--c-muted)]'}`}>{state.customized ? 'Personalizado' : 'Valores por defecto'}</span>
        <ChevronDown className={`w-4 h-4 text-[color:var(--c-muted)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-5 border-t border-[color:var(--c-line)] pt-5">
          <div>
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-[color:var(--c-muted)] mb-2.5">Ingesta · cómo se fragmenta lo que subes</h3>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <Campo id="chunkMax" label="Tamaño máximo" unit="caracteres" hint="Los párrafos más largos se cortan por oraciones." value={draft.chunkMax} def={state.defaults.chunkMax} limits={lim('chunkMax')} onChange={(v) => set('chunkMax', v)} />
              <Campo id="chunkMin" label="Tamaño mínimo" unit="caracteres" hint="Los más cortos (títulos, viñetas) se unen al siguiente." value={draft.chunkMin} def={state.defaults.chunkMin} limits={lim('chunkMin')} onChange={(v) => set('chunkMin', v)} />
              <Campo id="chunkOverlap" label="Solapamiento" unit="caracteres" hint="Cada fragmento repite el final del anterior." value={draft.chunkOverlap} def={state.defaults.chunkOverlap} limits={lim('chunkOverlap')} onChange={(v) => set('chunkOverlap', v)} />
            </div>
            <div className="mt-3"><Interruptor on={draft.ocr} onChange={(v) => set('ocr', v)} testId="pipeline-ocr" label="OCR de PDFs escaneados" hint="Si un PDF no trae texto seleccionable, se transcribe con visión del modelo (consume tokens). Apagado, ese PDF queda «sin texto»." /></div>
          </div>

          <div>
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-[color:var(--c-muted)] mb-2.5">Recuperación · cómo busca el agente al responder</h3>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <Campo id="topK" label="Top-k" unit="fragmentos" hint="Cuántos fragmentos recibe el modelo. Más contexto, más costo y más ruido." value={draft.topK} def={state.defaults.topK} limits={lim('topK')} onChange={(v) => set('topK', v)} />
              <Interruptor on={draft.hybrid} onChange={(v) => set('hybrid', v)} testId="pipeline-hybrid" label="Búsqueda híbrida" hint="Combina vectores y palabras clave (códigos, cifras, nombres propios). Apagada, solo cuenta la similitud semántica." />
            </div>
            <p className="text-[11px] text-[color:var(--c-muted)] mt-2">El umbral de confianza y el modelo de IA se configuran en el agente. El modelo de embeddings es el mismo para todas las empresas: vectores de modelos distintos no se pueden comparar.</p>
          </div>

          {problema && <p role="alert" data-testid="pipeline-error" className="text-xs font-semibold text-[color:var(--c-rtx2)]">{problema}</p>}

          <div className="flex items-center gap-2 flex-wrap pt-1">
            <button type="button" onClick={guardar} disabled={!sucio || !!problema || busy !== null} data-testid="pipeline-save"
              className="px-4 py-2.5 rounded-xl bg-[#D20A2E] hover:bg-[#B00825] text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50">
              {busy === 'guardar' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Guardar ajustes
            </button>
            <button type="button" onClick={() => setDraft(state.defaults)} disabled={busy !== null || JSON.stringify(draft) === JSON.stringify(state.defaults)} data-testid="pipeline-reset"
              className="px-4 py-2.5 rounded-xl border border-[color:var(--c-line)] bg-white hover:bg-[color:var(--c-canvas)] text-xs font-semibold text-[color:var(--c-ink)] flex items-center gap-1.5 disabled:opacity-50">
              <RotateCcw className="w-3.5 h-3.5" /> Restablecer valores por defecto
            </button>
            <span className="flex-1" />
            <button type="button" onClick={reprocesar} disabled={busy !== null || sucio || state.reprocessable === 0} data-testid="pipeline-reprocess"
              title={sucio ? 'Guarda los ajustes primero' : state.reprocessable === 0 ? 'No hay documentos con archivo' : 'Vuelve a fragmentar y vectorizar los documentos'}
              className="px-4 py-2.5 rounded-xl border border-[#D20A2E] text-[#D20A2E] hover:bg-[color:var(--c-ch50)] text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50 disabled:border-[color:var(--c-line)] disabled:text-[color:var(--c-muted)]">
              {busy === 'reprocesar' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Reprocesar documentos ({state.reprocessable})
            </button>
          </div>
          <p className="text-[11px] text-[color:var(--c-muted)]">Al guardar o reprocesar corren los golden sets automáticos para que veas si el agente mejoró o empeoró. El reprocesado vuelve a vectorizar todo: puede tardar según el tamaño de la base.</p>
        </div>
      )}
    </section>
  );
};
