import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Loader2, Scale, ShieldCheck, TriangleAlert, XCircle } from 'lucide-react';
import * as api from '../api/client';
import { AiModelOption, CalibrationRun, LabelCounts } from '../types';
import { fmtDateTime, fmtUsd } from '../lib/format';
import { Modal } from './Modal';
import { ProviderLogo } from './ProviderLogo';

interface CalibrationPanelProps {
  slug: string;
  models: AiModelOption[];
  onToast: (type: 'success' | 'warning' | 'info', title: string, description?: string) => void;
}

const card = 'bg-white border border-[color:var(--c-line)] rounded-2xl card-glow';
const btnPrimary = 'px-4 py-2.5 rounded-xl bg-[#D20A2E] hover:bg-[#B00825] text-white text-xs font-semibold disabled:opacity-50 flex items-center gap-1.5';
const btnGhost = 'px-4 py-2.5 rounded-xl border border-[color:var(--c-line)] bg-white text-xs font-semibold text-[color:var(--c-ink)] disabled:opacity-50 flex items-center gap-1.5';

const kappaLabel = (k: number) => (k >= 0.8 ? ['Casi perfecto', 'bg-[color:var(--c-gbg2)] text-[color:var(--c-gtx)]'] : k >= 0.6 ? ['Bueno', 'bg-[color:var(--c-gbg2)] text-[color:var(--c-gtx)]'] : k >= 0.4 ? ['Moderado', 'bg-[color:var(--c-abg2)] text-[color:var(--c-atx2)]'] : ['Débil', 'bg-[color:var(--c-rbg2)] text-[color:var(--c-rtx2)]']);

/** Mide cuánto coincide cada modelo juez con TUS etiquetas (correcto / incorrecto): así se sabe en qué juez confiar. */
export const CalibrationPanel: React.FC<CalibrationPanelProps> = ({ slug, models, onToast }) => {
  const [counts, setCounts] = useState<LabelCounts | null>(null);
  const [runs, setRuns] = useState<CalibrationRun[]>([]);
  const [modal, setModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, r] = await Promise.all([api.getLabelCounts(slug), api.getCalibrations(slug)]);
      setCounts(c); setRuns(r); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo cargar la calibración'); }
  }, [slug]);

  useEffect(() => { load(); }, [load]);
  const enCurso = runs.some((r) => r.status === 'ejecutando');
  useEffect(() => {
    if (!enCurso) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [enCurso, load]);

  const modelo = (id: string) => models.find((m) => m.id === id);
  const listo = !!counts && counts.labeled >= counts.minRequired;

  return (
    <div className="space-y-5" data-testid="calibration-panel">
      {error && <div className="p-4 rounded-xl border border-[color:var(--c-rline)] bg-[color:var(--c-rbg)] text-xs text-[color:var(--c-rtx2)]">{error}</div>}

      <section className={`${card} p-5 sm:p-6 animate-fade-up`}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="max-w-xl">
            <h2 className="text-sm font-bold text-[color:var(--c-ink)] flex items-center gap-2"><Scale className="w-4 h-4 text-[#D20A2E]" /> Calibrar al juez</h2>
            <p className="text-xs text-[color:var(--c-muted)] mt-1.5 leading-relaxed">
              El juez de IA puntúa las respuestas del agente, pero ¿se puede confiar en él? Marca a mano respuestas como <strong className="text-[color:var(--c-ink)]">correctas</strong> o <strong className="text-[color:var(--c-ink)]">incorrectas</strong> (dentro de los resultados de una corrida) y aquí se mide cuánto coincide cada modelo juez contigo.
            </p>
          </div>
          <button onClick={() => setModal(true)} disabled={!listo || enCurso} className={btnPrimary} data-testid="calibrate-open"><ShieldCheck className="w-3.5 h-3.5" /> Calibrar jueces</button>
        </div>
        {counts && (
          <div className="mt-5">
            <div className="flex items-baseline justify-between text-xs mb-1.5">
              <span className="font-semibold text-[color:var(--c-ink)] tabular-nums" data-testid="label-counts">{counts.labeled} respuestas etiquetadas <span className="font-normal text-[color:var(--c-muted)]">· {counts.correct} correctas · {counts.incorrect} incorrectas</span></span>
              <span className="text-[color:var(--c-muted)] tabular-nums">mínimo {counts.minRequired}</span>
            </div>
            <div className="h-2.5 rounded-full bg-[color:var(--c-soft)] overflow-hidden"><div className={`h-full rounded-full transition-all duration-700 ${listo ? 'bg-[#22C55E]' : 'bg-[#D20A2E]'}`} style={{ width: `${Math.min(100, (counts.labeled / counts.minRequired) * 100)}%` }} /></div>
            <p className="mt-2 text-[11px] text-[color:var(--c-muted)]">
              {listo ? 'Ya hay suficientes. Para que la medición sea útil conviene que haya de ambos tipos (correctas e incorrectas).' : `Faltan ${counts.minRequired - counts.labeled} etiquetas. Abre una corrida, expande un caso y marca si la respuesta del agente es correcta o no. Solo cuentan los casos con respuesta esperada que el agente respondió.`}
            </p>
          </div>
        )}
      </section>

      {runs.length === 0 ? (
        <p className={`${card} py-12 text-center text-xs text-[color:var(--c-muted)]`}>Aún no hay calibraciones.</p>
      ) : runs.map((c) => {
        const mejor = c.judges.length > 1 ? [...c.judges].sort((a, b) => b.kappa - a.kappa || b.agreement - a.agreement)[0].modelId : undefined;
        return (
          <section key={c.id} className={`${card} overflow-hidden animate-fade-up`} data-testid={`calibration-${c.id}`}>
            <div className="px-5 py-3.5 border-b border-[color:var(--c-line)] flex items-center justify-between gap-3 flex-wrap">
              <p className="text-xs font-bold text-[color:var(--c-ink)]">Calibración del {fmtDateTime(c.startedAt)} <span className="font-normal text-[color:var(--c-muted)]">· {c.labeled} etiquetas · {c.judgeModelIds.length} juez{c.judgeModelIds.length > 1 ? 'es' : ''}{c.createdBy ? ` · ${c.createdBy}` : ''}</span></p>
              {c.status === 'ejecutando' && <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[color:var(--c-atx2)]"><Loader2 className="w-3 h-3 animate-spin" />{c.completed}/{c.total} evaluaciones</span>}
              {c.status === 'error' && <span className="text-[11px] font-semibold text-[color:var(--c-rtx2)] flex items-center gap-1"><TriangleAlert className="w-3.5 h-3.5" />{c.error}</span>}
            </div>
            {c.judges.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-xs">
                  <thead className="bg-[color:var(--c-canvas)] text-[color:var(--c-muted)] text-left">
                    <tr>
                      <th className="px-5 py-3 font-semibold">Juez</th>
                      <th className="px-5 py-3 font-semibold text-right" title="% de respuestas en las que el juez y tú dijeron lo mismo">Acuerdo</th>
                      <th className="px-5 py-3 font-semibold" title="Acuerdo corregido por azar: 1 es perfecto, 0 es como tirar una moneda">Kappa</th>
                      <th className="px-5 py-3 font-semibold text-right" title="El juez aprobó algo que tú diste por incorrecto">Falsos aprobados</th>
                      <th className="px-5 py-3 font-semibold text-right" title="El juez rechazó algo que tú diste por correcto">Falsos rechazos</th>
                      <th className="px-5 py-3 font-semibold text-right">Costo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.judges.map((j) => {
                      const mo = modelo(j.modelId);
                      const [txt, cls] = kappaLabel(j.kappa);
                      return (
                        <tr key={j.modelId} data-testid={`calibration-judge-${j.modelId}`} className={`border-t border-[color:var(--c-line)] ${j.modelId === mejor ? 'bg-[color:var(--c-gbg)]' : ''}`}>
                          <td className="px-5 py-3.5">
                            <span className="flex items-center gap-2.5"><span className="w-8 h-8 rounded-lg bg-[color:var(--c-canvas)] border border-[color:var(--c-line)] flex items-center justify-center"><ProviderLogo provider={mo?.providerId ?? ''} size={18} /></span>
                              <span><span className="block font-semibold text-[color:var(--c-ink)]">{mo?.name ?? j.modelId}</span>{j.modelId === mejor && <span className="text-[10px] font-bold text-[color:var(--c-gtx)] bg-[color:var(--c-gbg2)] rounded-full px-1.5 py-px">El que más coincide contigo</span>}{j.withoutJudge > 0 && <span className="block text-[10px] text-[color:var(--c-rtx)]">{j.withoutJudge} sin puntaje válido</span>}</span></span>
                          </td>
                          <td className="px-5 py-3.5 text-right tabular-nums font-bold text-[color:var(--c-ink)]">{j.agreement}%</td>
                          <td className="px-5 py-3.5"><span className="tabular-nums font-semibold text-[color:var(--c-ink)] mr-2">{j.kappa.toFixed(2)}</span><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${cls}`}>{txt}</span></td>
                          <td className="px-5 py-3.5 text-right tabular-nums text-[color:var(--c-ink)]">{j.falsePositives}</td>
                          <td className="px-5 py-3.5 text-right tabular-nums text-[color:var(--c-ink)]">{j.falseNegatives}</td>
                          <td className="px-5 py-3.5 text-right tabular-nums text-[color:var(--c-muted)]">{fmtUsd(j.costUsd)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}

      {modal && <CalibrateModal models={models} onClose={() => setModal(false)} onStart={async (ids) => {
        try { await api.startCalibration(slug, ids); setModal(false); onToast('success', 'Calibración iniciada', 'Los jueces están puntuando tus respuestas etiquetadas.'); load(); }
        catch (e) { onToast('warning', 'No se pudo calibrar', e instanceof Error ? e.message : undefined); }
      }} />}
    </div>
  );
};

const CalibrateModal: React.FC<{ models: AiModelOption[]; onClose: () => void; onStart: (ids: string[]) => Promise<void> }> = ({ models, onClose, onStart }) => {
  const [chosen, setChosen] = useState<Set<string>>(new Set(models.filter((m) => m.recommended).map((m) => m.id)));
  const [busy, setBusy] = useState(false);
  const toggle = (id: string) => setChosen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else if (n.size < 4) n.add(id); return n; });
  return (
    <Modal title="Calibrar jueces" subtitle="Elige hasta 4 modelos. Cada uno volverá a puntuar tus respuestas etiquetadas." icon={<Scale className="w-5 h-5" />} onClose={busy ? () => undefined : onClose}
      footer={<><button onClick={onClose} disabled={busy} className={btnGhost}>Cancelar</button><button onClick={async () => { setBusy(true); await onStart([...chosen]); setBusy(false); }} disabled={busy || chosen.size === 0} className={btnPrimary} data-testid="calibrate-start">{busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Calibrar</button></>}>
      <ul className="rounded-xl border border-[color:var(--c-line)] divide-y divide-[color:var(--c-line)] overflow-hidden">
        {models.map((m) => (
          <li key={m.id}><label className="flex items-center gap-3 px-3.5 py-2.5 text-xs cursor-pointer hover:bg-[color:var(--c-canvas)]">
            <input type="checkbox" checked={chosen.has(m.id)} onChange={() => toggle(m.id)} className="accent-[#D20A2E]" data-testid={`calibrate-model-${m.id}`} />
            <ProviderLogo provider={m.providerId} size={18} /><span className="font-semibold text-[color:var(--c-ink)] flex-1">{m.name}</span><span className="text-[11px] text-[color:var(--c-muted)]">{m.provider}</span></label></li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] text-[color:var(--c-muted)] flex items-start gap-1.5"><TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-px text-[#D20A2E]" /> Cada juez evalúa todas las respuestas etiquetadas (hasta 40): gasta tokens que cuentan en tu plan de gasto.</p>
      <p className="mt-2 text-[11px] text-[color:var(--c-muted)] flex items-start gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-px text-[color:var(--c-gtx)]" /> Un juez es confiable si su kappa supera 0,6: coincide contigo bastante más que el azar. <XCircle className="w-3.5 h-3.5 shrink-0 mt-px text-[color:var(--c-rtx)] hidden" /></p>
    </Modal>
  );
};
