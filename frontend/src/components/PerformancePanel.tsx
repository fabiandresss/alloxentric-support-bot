import React, { useEffect, useState } from 'react';
import { Activity, AlertTriangle, DatabaseZap, Gauge, LifeBuoy, Loader2 } from 'lucide-react';
import * as api from '../api/client';
import { Performance } from '../types';
import { fmtInt, fmtUsd } from '../lib/format';
import { Select } from './Select';

const card = 'bg-white border border-[color:var(--c-line)] rounded-2xl card-glow';
const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${n} ms`);

const Kpi: React.FC<{ icon: React.ElementType; label: string; value: string; hint: string; tone?: 'bad' }> = ({ icon: Icon, label, value, hint, tone }) => (
  <div className={`${card} p-4`}>
    <div className="flex items-center justify-between">
      <span className="text-xs font-medium text-[color:var(--c-muted)]">{label}</span>
      <span className="w-8 h-8 rounded-xl bg-[color:var(--c-ch100)] text-[#D20A2E] flex items-center justify-center"><Icon className="w-4 h-4" /></span>
    </div>
    <p className={`mt-3 text-2xl font-bold tracking-tight tabular-nums ${tone === 'bad' ? 'text-[color:var(--c-rtx2)]' : 'text-[color:var(--c-ink)]'}`}>{value}</p>
    <p className="mt-1 text-[11px] text-[color:var(--c-muted)]">{hint}</p>
  </div>
);

/** Rendimiento de la IA de la empresa: latencia, errores, modelo de respaldo y ahorro de la caché (trazas de cada llamada al modelo). */
export const PerformancePanel: React.FC<{ slug: string }> = ({ slug }) => {
  const [days, setDays] = useState('7');
  const [p, setP] = useState<Performance | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    let alive = true;
    setP(null);
    setError(null);
    api.getPerformance(slug, Number(days)).then((x) => alive && setP(x)).catch((e) => alive && setError(e instanceof Error ? e.message : 'No se pudo cargar'));
    return () => { alive = false; };
  }, [slug, days]);

  return (
    <section className="space-y-3 animate-fade-up" aria-label="Rendimiento de la IA" data-testid="performance-panel">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-bold text-[color:var(--c-ink)] flex items-center gap-2"><Activity className="w-4 h-4 text-[#D20A2E]" /> Rendimiento de la IA</h2>
          <p className="text-[11px] text-[color:var(--c-muted)] mt-0.5">Qué tan rápido y confiable responde el modelo, y cuánto se ahorra con la caché.</p>
        </div>
        <Select value={days} onChange={setDays} ariaLabel="Periodo del rendimiento" size="sm" className="w-40"
          options={[{ value: '7', label: 'Últimos 7 días' }, { value: '30', label: 'Últimos 30 días' }, { value: '90', label: 'Últimos 90 días' }]} />
      </div>
      {error && <p className="text-xs text-[color:var(--c-rtx2)]">{error}</p>}
      {!p && !error && <div className="py-8 flex justify-center text-[color:var(--c-muted)]"><Loader2 className="w-5 h-5 animate-spin" /></div>}
      {p && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <Kpi icon={Gauge} label="Latencia" value={p.calls ? ms(p.p50Ms) : '—'} hint={p.calls ? `p95: ${ms(p.p95Ms)} · ${fmtInt(p.calls)} llamadas` : 'Sin llamadas en el periodo'} />
            <Kpi icon={AlertTriangle} label="Errores" value={`${p.errorRate}%`} hint={`${fmtInt(p.errors)} de ${fmtInt(p.calls)} llamadas`} tone={p.errorRate >= 5 ? 'bad' : undefined} />
            <Kpi icon={LifeBuoy} label="Modelo de respaldo" value={fmtInt(p.fallbacks)} hint="Respuestas dadas por el respaldo cuando el modelo falló" />
            <Kpi icon={DatabaseZap} label="Caché de respuestas" value={fmtInt(p.cacheHits)} hint={`Ahorro estimado ${fmtUsd(p.cacheSavedUsd)} · ${fmtInt(p.cacheEntries)} guardadas`} />
          </div>
          {(p.byModel.length > 0 || p.topErrors.length > 0) && (
            <div className={`${card} overflow-hidden`}>
              {p.byModel.length > 0 && (
                <table className="w-full text-xs" data-testid="performance-models">
                  <thead className="bg-[color:var(--c-canvas)] text-[color:var(--c-muted)] text-left">
                    <tr><th className="px-4 py-2.5 font-semibold">Modelo</th><th className="px-4 py-2.5 font-semibold text-right">Llamadas</th><th className="px-4 py-2.5 font-semibold text-right">p50</th><th className="px-4 py-2.5 font-semibold text-right">p95</th><th className="px-4 py-2.5 font-semibold text-right">Errores</th></tr>
                  </thead>
                  <tbody>
                    {p.byModel.map((m) => (
                      <tr key={m.modelId} className="border-t border-[color:var(--c-line)]">
                        <td className="px-4 py-2.5 font-semibold text-[color:var(--c-ink)]">{m.name}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{fmtInt(m.calls)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{ms(m.p50Ms)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{ms(m.p95Ms)}</td>
                        <td className={`px-4 py-2.5 text-right tabular-nums ${m.errors ? 'text-[color:var(--c-rtx2)] font-semibold' : ''}`}>{fmtInt(m.errors)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {p.topErrors.length > 0 && (
                <p className="px-4 py-2.5 border-t border-[color:var(--c-line)] text-[11px] text-[color:var(--c-muted)]">
                  Errores más frecuentes: {p.topErrors.map((e) => `${e.error} (${e.count})`).join(' · ')}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
};
