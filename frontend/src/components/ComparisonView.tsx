import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Award, Clock, Coins, Loader2, Scale, Target, Zap } from 'lucide-react';
import * as api from '../api/client';
import { AiModelOption, TestComparison, TestRunBrief } from '../types';
import { fmtInt, fmtUsd } from '../lib/format';
import { ProviderLogo } from './ProviderLogo';
import { Select } from './Select';

interface ComparisonViewProps {
  slug: string;
  groupId: string;
  models: AiModelOption[];
  onBack: () => void;
  onOpenRun: (runId: string) => void;
}

const card = 'bg-white border border-[color:var(--c-line)] rounded-2xl card-glow';
const CALIDADES = [50, 60, 70, 80, 90, 100].map((n) => ({ value: String(n), label: `${n} % de aprobación` }));

/** Compara el mismo golden set con varios modelos de agente, lado a lado, y recomienda el más barato que cumple la calidad pedida. */
export const ComparisonView: React.FC<ComparisonViewProps> = ({ slug, groupId, models, onBack, onOpenRun }) => {
  const [d, setD] = useState<TestComparison | null>(null);
  const [minimo, setMinimo] = useState('80');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setD(await api.getComparison(slug, groupId, Number(minimo))); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo cargar la comparativa'); }
  }, [slug, groupId, minimo]);

  useEffect(() => { load(); }, [load]);
  const enCurso = !!d?.runs.some((r) => r.status === 'ejecutando');
  useEffect(() => {
    if (!enCurso) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [enCurso, load]);

  const modelo = (id: string) => models.find((m) => m.id === id);
  const juez = modelo(d?.judgeModelId ?? '');
  const hechas = useMemo(() => (d?.runs ?? []).filter((r) => r.status === 'completada' && r.summary), [d]);
  const mejor = <K extends (r: TestRunBrief) => number>(f: K, menor: boolean) => {
    if (hechas.length < 2) return undefined;
    return hechas.reduce((a, b) => ((menor ? f(b) < f(a) : f(b) > f(a)) ? b : a)).id;
  };
  const masBarato = mejor((r) => r.summary!.agentCostUsd, true);
  const masRapido = mejor((r) => r.summary!.avgLatencyMs, true);
  const masPreciso = mejor((r) => r.summary!.passRate, false);
  const total = d?.runs.reduce((s, r) => s + r.total, 0) ?? 0;
  const hecho = d?.runs.reduce((s, r) => s + (r.status === 'completada' ? r.total : r.completed), 0) ?? 0;

  return (
    <div className="space-y-6" data-testid="comparison-view">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[color:var(--c-muted)] hover:text-[#D20A2E] transition-colors" data-testid="comparison-back">
        <ArrowLeft className="w-4 h-4" /> Volver a las pruebas
      </button>
      {error && <div className="p-4 rounded-xl border border-[color:var(--c-rline)] bg-[color:var(--c-rbg)] text-xs text-[color:var(--c-rtx2)]">{error}</div>}
      {!d && !error && <div className="py-20 flex justify-center text-[color:var(--c-muted)]"><Loader2 className="w-5 h-5 animate-spin" /></div>}

      {d && (
        <>
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight text-[color:var(--c-ink)] truncate">Comparativa de modelos</h1>
              <p className="text-xs text-[color:var(--c-muted)] mt-1 flex items-center gap-2 flex-wrap">
                Golden set <strong className="text-[color:var(--c-ink)]">{d.setName}</strong> · {d.runs.length} modelos ·
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--c-soft)] px-2.5 py-1 font-semibold text-[color:var(--c-ink)]"><Scale className="w-3 h-3 text-[#D20A2E]" />{juez && <ProviderLogo provider={juez.providerId} size={14} />}Juez: {juez?.name ?? d.judgeModelId}</span>
              </p>
            </div>
            <div className="w-64">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--c-muted)] flex items-center gap-1.5"><Target className="w-3.5 h-3.5 text-[#D20A2E]" /> Calidad mínima</p>
              <Select value={minimo} onChange={setMinimo} ariaLabel="Calidad mínima" options={CALIDADES} testId="comparison-min" />
            </div>
          </div>

          {enCurso && (
            <section className={`${card} p-5`} role="status" data-testid="comparison-progress">
              <div className="flex items-center justify-between text-xs mb-2.5">
                <span className="font-semibold text-[color:var(--c-ink)] flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin text-[#D20A2E]" /> Probando los modelos uno tras otro…</span>
                <span className="tabular-nums text-[color:var(--c-muted)]">{hecho} de {total} respuestas</span>
              </div>
              <div className="h-2.5 rounded-full bg-[color:var(--c-soft)] overflow-hidden"><div className="h-full bg-[#D20A2E] rounded-full transition-all duration-500" style={{ width: `${total ? (hecho / total) * 100 : 0}%` }} /></div>
            </section>
          )}

          {!enCurso && (
            <section role="status" data-testid="comparison-reco" className={`rounded-2xl border p-4 flex items-start gap-3 ${d.recommendedRunId ? 'border-[color:var(--c-gline)] bg-[color:var(--c-gbg)]' : 'border-[color:var(--c-aline)] bg-[color:var(--c-abg)]'}`}>
              <Award className={`w-5 h-5 shrink-0 mt-0.5 ${d.recommendedRunId ? 'text-[color:var(--c-gtx)]' : 'text-[color:var(--c-atx2)]'}`} />
              <div className="text-xs">
                <p className={`font-bold ${d.recommendedRunId ? 'text-[color:var(--c-gtx)]' : 'text-[color:var(--c-atx2)]'}`}>{d.recommendedRunId ? 'Modelo recomendado' : 'Sin recomendación'}</p>
                <p className="mt-0.5 text-[color:var(--c-ink)]">{d.recommendation}</p>
              </div>
            </section>
          )}

          <section className={`${card} overflow-hidden animate-fade-up`}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-xs" data-testid="comparison-table">
                <thead className="bg-[color:var(--c-canvas)] text-[color:var(--c-muted)] text-left">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Modelo</th>
                    <th className="px-5 py-3 font-semibold">Aprobación</th>
                    <th className="px-5 py-3 font-semibold text-right">Puntaje</th>
                    <th className="px-5 py-3 font-semibold text-right">Latencia</th>
                    <th className="px-5 py-3 font-semibold text-right">Costo del agente</th>
                    <th className="px-5 py-3 font-semibold"></th>
                  </tr>
                </thead>
                <tbody>
                  {d.runs.map((r) => {
                    const mo = modelo(r.modelId);
                    const s = r.summary;
                    const reco = r.id === d.recommendedRunId;
                    return (
                      <tr key={r.id} data-testid={`comparison-row-${r.modelId}`} className={`border-t border-[color:var(--c-line)] ${reco ? 'bg-[color:var(--c-gbg)]' : ''}`}>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2.5">
                            <span className="w-9 h-9 rounded-xl bg-[color:var(--c-canvas)] border border-[color:var(--c-line)] flex items-center justify-center"><ProviderLogo provider={mo?.providerId ?? ''} size={20} /></span>
                            <span>
                              <span className="block font-semibold text-[color:var(--c-ink)]">{mo?.name ?? r.modelId}</span>
                              <span className="flex items-center gap-1 flex-wrap mt-0.5">
                                {reco && <span className="text-[10px] font-bold text-[color:var(--c-gtx)] bg-[color:var(--c-gbg2)] rounded-full px-1.5 py-px">Recomendado</span>}
                                {r.id === masBarato && <span className="text-[10px] font-bold text-[#D20A2E] bg-[color:var(--c-ch100)] rounded-full px-1.5 py-px inline-flex items-center gap-0.5"><Coins className="w-2.5 h-2.5" />Más barato</span>}
                                {r.id === masRapido && <span className="text-[10px] font-bold text-[#D20A2E] bg-[color:var(--c-ch100)] rounded-full px-1.5 py-px inline-flex items-center gap-0.5"><Zap className="w-2.5 h-2.5" />Más rápido</span>}
                                {r.id === masPreciso && <span className="text-[10px] font-bold text-[#D20A2E] bg-[color:var(--c-ch100)] rounded-full px-1.5 py-px inline-flex items-center gap-0.5"><Target className="w-2.5 h-2.5" />Más preciso</span>}
                              </span>
                            </span>
                          </div>
                        </td>
                        {s ? (
                          <>
                            <td className="px-5 py-3.5 w-52">
                              <div className="flex items-center gap-2">
                                <div className="flex-1 h-2 rounded-full bg-[color:var(--c-soft)] overflow-hidden"><div className={`h-full rounded-full ${s.passRate >= d.minQuality ? 'bg-[#22C55E]' : 'bg-[#EF4444]'}`} style={{ width: `${s.passRate}%` }} /></div>
                                <span className="tabular-nums font-bold text-[color:var(--c-ink)] w-12 text-right">{s.passRate}%</span>
                              </div>
                            </td>
                            <td className="px-5 py-3.5 text-right tabular-nums text-[color:var(--c-ink)]">{s.avgScore !== undefined ? s.avgScore.toFixed(2) : '—'}</td>
                            <td className="px-5 py-3.5 text-right tabular-nums text-[color:var(--c-ink)]"><Clock className="inline w-3 h-3 mr-1 text-[color:var(--c-faint)]" />{fmtInt(s.avgLatencyMs)} ms</td>
                            <td className="px-5 py-3.5 text-right tabular-nums font-semibold text-[color:var(--c-ink)]">{fmtUsd(s.agentCostUsd)}</td>
                          </>
                        ) : (
                          <td colSpan={4} className="px-5 py-3.5 text-[color:var(--c-muted)]">
                            {r.status === 'ejecutando' ? <span className="inline-flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" />{r.completed === 0 && hechas.every((h) => h.id !== r.id) ? 'En cola o ejecutando…' : `${r.completed}/${r.total} casos`}</span> : 'La corrida no terminó'}
                          </td>
                        )}
                        <td className="px-5 py-3.5 text-right"><button onClick={() => onOpenRun(r.id)} className="text-[11px] font-semibold text-[#D20A2E] hover:underline">Ver respuestas</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
          <p className="text-[11px] text-[color:var(--c-muted)]">Todos los modelos responden las mismas preguntas con la misma base de conocimiento y el mismo juez. No cambia el modelo configurado del agente: para usar uno, elígelo en Empresas y agentes.</p>
        </>
      )}
    </div>
  );
};
