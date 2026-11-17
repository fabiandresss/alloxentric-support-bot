import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowDownToLine, ArrowUpFromLine, BarChart3, CalendarRange, CircleDollarSign, Gauge, Infinity as InfinityIcon,
  Layers, Loader2, MessagesSquare, Pencil, RotateCcw, ShieldAlert, Sparkles, Zap,
} from 'lucide-react';
import * as api from '../api/client';
import { AiModelOption, AuthUser, Company, FinOpsGroup, FinOpsSummary } from '../types';
import { addDays, fmtDay, fmtInt, fmtRange, fmtTokens, fmtUsd, isoDay, monthLabel } from '../lib/format';
import { ProviderLogo } from './ProviderLogo';
import { Select } from './Select';
import { PerformancePanel } from './PerformancePanel';

interface FinOpsViewProps {
  me: AuthUser;
  companies: Company[];
  onToast: (type: 'success' | 'warning' | 'info', title: string, description?: string) => void;
}

type Preset = 'hoy' | '7d' | '30d' | 'mes' | 'mes-anterior' | 'custom';

const PRESETS: { id: Preset; label: string }[] = [
  { id: 'hoy', label: 'Hoy' },
  { id: '7d', label: '7 días' },
  { id: '30d', label: '30 días' },
  { id: 'mes', label: 'Este mes' },
  { id: 'mes-anterior', label: 'Mes anterior' },
  { id: 'custom', label: 'Personalizado' },
];
const GROUPS: { id: FinOpsGroup; label: string }[] = [
  { id: 'dia', label: 'Día' },
  { id: 'semana', label: 'Semana' },
  { id: 'mes', label: 'Mes' },
];

/** Rango de fechas (AAAA-MM-DD) de cada atajo. */
const rangeOf = (p: Exclude<Preset, 'custom'>): { desde: string; hasta: string } => {
  const hoy = new Date();
  if (p === 'hoy') return { desde: isoDay(hoy), hasta: isoDay(hoy) };
  if (p === '7d') return { desde: isoDay(addDays(hoy, -6)), hasta: isoDay(hoy) };
  if (p === '30d') return { desde: isoDay(addDays(hoy, -29)), hasta: isoDay(hoy) };
  if (p === 'mes') return { desde: isoDay(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), hasta: isoDay(hoy) };
  return { desde: isoDay(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1)), hasta: isoDay(new Date(hoy.getFullYear(), hoy.getMonth(), 0)) };
};

const card = 'bg-white border border-[color:var(--c-line)] rounded-2xl card-glow';

/** Grupo de botones tipo "segmentado" (un solo valor activo). `full` reparte el ancho entre las opciones. */
function Segmented<T extends string>({ value, onChange, options, label, full }: { value: T; onChange: (v: T) => void; options: { id: T; label: string }[]; label: string; full?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className={`flex p-1 rounded-xl bg-[color:var(--c-soft)] text-xs font-semibold overflow-x-auto max-w-full ${full ? 'w-full' : ''}`}>
      {options.map((o) => (
        <button
          key={o.id} type="button" role="radio" aria-checked={value === o.id} onClick={() => onChange(o.id)} data-testid={`finops-${label}-${o.id}`}
          className={`${full ? 'flex-1' : ''} px-3 py-1.5 rounded-lg whitespace-nowrap transition-all ${value === o.id ? 'bg-[#D20A2E] text-white shadow-sm' : 'text-[color:var(--c-muted)] hover:text-[color:var(--c-ink)]'}`}
        >{o.label}</button>
      ))}
    </div>
  );
}

/** Campo de filtro con su rótulo arriba, para que cada control tenga nombre y quede alineado. */
const Field: React.FC<{ label: string; icon: React.ElementType; className?: string; children: React.ReactNode }> = ({ label, icon: Icon, className = '', children }) => (
  <div className={`min-w-0 ${className}`}>
    <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--c-muted)]"><Icon className="w-3.5 h-3.5 text-[#D20A2E]" />{label}</p>
    {children}
  </div>
);

const Stat: React.FC<{ icon: React.ElementType; label: string; value: string; hint?: string; delay?: number }> = ({ icon: Icon, label, value, hint, delay = 0 }) => (
  <div style={{ animationDelay: `${delay}ms` }} className={`${card} animate-fade-up p-4`}>
    <div className="flex items-center justify-between">
      <span className="text-xs font-medium text-[color:var(--c-muted)]">{label}</span>
      <span className="w-8 h-8 rounded-xl bg-[color:var(--c-ch100)] text-[#D20A2E] flex items-center justify-center"><Icon className="w-4 h-4" /></span>
    </div>
    <p className="mt-3 text-2xl sm:text-3xl font-bold tracking-tight tabular-nums text-[color:var(--c-ink)]">{value}</p>
    {hint && <p className="mt-1 text-[11px] text-[color:var(--c-muted)]">{hint}</p>}
  </div>
);

export const FinOpsView: React.FC<FinOpsViewProps> = ({ me, companies, onToast }) => {
  const isSuper = me.role === 'superadmin';
  const [slug, setSlug] = useState<string>(isSuper ? companies[0]?.id ?? '' : me.companyId ?? '');
  const [preset, setPreset] = useState<Preset>('mes');
  const [custom, setCustom] = useState(rangeOf('30d'));
  const [modelo, setModelo] = useState('');
  const [group, setGroup] = useState<FinOpsGroup>('dia');
  const [catalog, setCatalog] = useState<AiModelOption[]>([]);
  const [data, setData] = useState<FinOpsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  const range = preset === 'custom' ? custom : rangeOf(preset);
  const rangeOk = range.desde !== '' && range.hasta !== '' && range.desde <= range.hasta;
  const filtered = preset !== 'mes' || modelo !== '' || group !== 'dia';

  useEffect(() => { api.getAiModels().then(setCatalog).catch(() => setCatalog([])); }, []);

  const load = useCallback(async () => {
    if (!slug || !rangeOk) return;
    setLoading(true);
    setError(null);
    try {
      setData(await api.getFinOps(slug, { desde: range.desde, hasta: range.hasta, modelo: modelo || undefined, agrupar: group }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el consumo');
    } finally {
      setLoading(false);
    }
  }, [slug, range.desde, range.hasta, modelo, group, rangeOk]);

  useEffect(() => { load(); }, [load]);

  const reset = () => { setPreset('mes'); setModelo(''); setGroup('dia'); };

  const maxPoint = useMemo(() => Math.max(0.0000001, ...(data?.series.map((d) => d.costUsd) ?? [0])), [data]);
  const total = data?.spentUsd ?? 0;
  const b = data?.billing;
  const limited = data?.plan.mode === 'limitado' && data.plan.monthlyLimitUsd !== undefined;
  const pct = Math.min(100, b?.usedPct ?? 0);
  const barColor = b?.limitReached ? 'bg-[#EF4444]' : b?.nearLimit ? 'bg-[#F59E0B]' : 'bg-[#D20A2E]';
  const company = companies.find((c) => c.id === slug);
  const modelName = catalog.find((m) => m.id === modelo)?.name;
  const unit = group === 'dia' ? 'día' : group === 'semana' ? 'semana' : 'mes';
  const manyBars = (data?.series.length ?? 0) > 45;
  const pointLabel = (p: { date: string; endDate: string }) => (group === 'mes' ? monthLabel(p.date.slice(0, 7)) : fmtRange(p.date, p.endDate));

  const modelOptions = [
    { value: '', label: 'Todos los modelos', icon: <Layers className="w-4 h-4 text-[#D20A2E]" /> },
    ...catalog.map((m) => ({ value: m.id, label: m.name, hint: m.provider, icon: <ProviderLogo provider={m.providerId} size={18} /> })),
  ];

  return (
    <div className="space-y-6" data-testid="finops-view">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[color:var(--c-ink)]">Consumo y costos</h1>
          <p className="text-xs text-[color:var(--c-muted)] mt-1">
            Tokens y costo de los modelos de IA del agente{company ? ` de ${company.name}` : ''}, y el estado de su plan de gasto.
          </p>
        </div>
        {isSuper && (
          <Select value={slug} onChange={(v) => { setSlug(v); setEditing(false); }} ariaLabel="Empresa" size="sm" className="w-56"
            options={companies.map((c) => ({ value: c.id, label: c.name }))} />
        )}
      </div>

      {error && <div className="p-4 rounded-xl border border-[color:var(--c-rline)] bg-[color:var(--c-rbg)] text-xs text-[color:var(--c-rtx2)]">{error}</div>}
      {loading && !data && <div className="py-20 flex justify-center text-[color:var(--c-muted)]"><Loader2 className="w-5 h-5 animate-spin" /></div>}

      {data && b && (
        <>
          {b.limitReached && (
            <div role="alert" data-testid="finops-limit-reached" className="flex items-start gap-3 p-4 rounded-2xl border border-[color:var(--c-rline)] bg-[color:var(--c-rbg)] text-[color:var(--c-rtx2)]">
              <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
              <div className="text-xs">
                <p className="font-semibold">Tope mensual alcanzado</p>
                <p className="mt-0.5">El agente dejó de usar el modelo de IA y responde con el fragmento más relevante de la documentación. El chat sigue funcionando; el consumo se reinicia el próximo mes o al subir el límite.</p>
              </div>
            </div>
          )}
          {b.dailyLimitReached && !b.limitReached && (
            <div role="alert" data-testid="finops-daily-reached" className="flex items-start gap-3 p-4 rounded-2xl border border-[color:var(--c-rline)] bg-[color:var(--c-rbg)] text-[color:var(--c-rtx2)]">
              <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
              <div className="text-xs"><p className="font-semibold">Tope diario alcanzado</p><p className="mt-0.5">Hoy se gastó el máximo diario: el agente responde sin IA (con el fragmento más relevante) hasta mañana. El chat sigue funcionando.</p></div>
            </div>
          )}
          {b.nearLimit && (
            <div role="status" className="flex items-start gap-3 p-4 rounded-2xl border border-[color:var(--c-aline)] bg-[color:var(--c-abg)] text-[color:var(--c-atx2)]">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
              <p className="text-xs"><span className="font-semibold">Vas en {b.usedPct}% de tu límite mensual.</span> Al llegar al 100% el agente responderá sin IA hasta el próximo mes.</p>
            </div>
          )}

          {/* Plan: siempre el mes en curso */}
          <section className={`${card} p-5 sm:p-6 animate-fade-up`} aria-label="Plan de gasto">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-xl bg-[color:var(--c-ch100)] text-[#D20A2E] flex items-center justify-center">
                  {limited ? <Gauge className="w-5 h-5" /> : <InfinityIcon className="w-5 h-5" />}
                </span>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--c-muted)]">Plan de gasto · ciclo de {monthLabel(b.month).toLowerCase()}</p>
                  <p className="text-sm font-bold text-[color:var(--c-ink)]" data-testid="finops-plan-name">{limited ? 'Límite mensual' : 'Sin límite mensual'}</p>
                </div>
              </div>
              {!editing && (   // el admin de la empresa (o el superadmin) define si el gasto es ilimitado o con límite
                <button onClick={() => setEditing(true)} data-testid="finops-edit-plan" className="px-3 py-1.5 rounded-lg border border-[color:var(--c-line)] bg-white text-xs font-semibold text-[color:var(--c-ink)] flex items-center gap-1.5">
                  <Pencil className="w-3.5 h-3.5" /> Cambiar plan
                </button>
              )}
            </div>

            {editing ? (
              <PlanEditor
                key={slug}
                initial={data.plan}
                onCancel={() => setEditing(false)}
                onSave={async (p) => {
                  try {
                    await api.updateSpendPlan(slug, p);
                    setEditing(false);
                    onToast('success', 'Plan actualizado', p.mode === 'limitado' ? `Límite de ${fmtUsd(p.monthlyLimitUsd ?? 0)} al mes${p.dailyLimitUsd ? ` y ${fmtUsd(p.dailyLimitUsd)} al día` : ''}.` : 'Sin límite mensual.');
                    load();
                  } catch (e) {
                    onToast('warning', 'No se pudo guardar el plan', e instanceof Error ? e.message : undefined);
                  }
                }}
              />
            ) : limited ? (
              <div className="mt-5">
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <p className="text-3xl font-bold tabular-nums tracking-tight text-[color:var(--c-ink)]" data-testid="finops-spent">
                    {fmtUsd(b.spentUsd)} <span className="text-sm font-medium text-[color:var(--c-muted)]">de {fmtUsd(data.plan.monthlyLimitUsd ?? 0)}</span>
                  </p>
                  <p className="text-xs font-semibold text-[color:var(--c-muted)] tabular-nums">{b.usedPct ?? 0}% usado</p>
                </div>
                <div className="mt-3 h-2.5 rounded-full bg-[color:var(--c-soft)] overflow-hidden" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
                  <div className={`h-full rounded-full transition-all duration-700 ${barColor}`} style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-3 flex items-center justify-between text-[11px] text-[color:var(--c-muted)] flex-wrap gap-2">
                  <span>Disponible: <strong className="text-[color:var(--c-ink)] tabular-nums">{fmtUsd(Math.max(0, (data.plan.monthlyLimitUsd ?? 0) - b.spentUsd))}</strong></span>
                  {b.projectedUsd !== undefined && (
                    <span>Proyección al cierre del mes: <strong className={`tabular-nums ${b.projectedUsd > (data.plan.monthlyLimitUsd ?? Infinity) ? 'text-[color:var(--c-rtx)]' : 'text-[color:var(--c-ink)]'}`}>{fmtUsd(b.projectedUsd)}</strong></span>
                  )}
                </div>
              </div>
            ) : (
              <div className="mt-5">
                <p className="text-3xl font-bold tabular-nums tracking-tight text-[color:var(--c-ink)]" data-testid="finops-spent">{fmtUsd(b.spentUsd)}</p>
                <p className="mt-1 text-xs text-[color:var(--c-muted)]">Gastado en {monthLabel(b.month).toLowerCase()}. Sin tope: se cobra lo que se consuma.
                  {b.projectedUsd !== undefined && <> Proyección al cierre: <strong className="text-[color:var(--c-ink)] tabular-nums">{fmtUsd(b.projectedUsd)}</strong>.</>}
                </p>
              </div>
            )}

            {!editing && data.plan.dailyLimitUsd !== undefined && (
              <div className="mt-4" data-testid="finops-daily">
                <div className="flex items-baseline justify-between text-[11px] text-[color:var(--c-muted)] mb-1.5">
                  <span>Hoy: <strong className="text-[color:var(--c-ink)] tabular-nums">{fmtUsd(b.dailySpentUsd)}</strong> de {fmtUsd(data.plan.dailyLimitUsd)} <span className="text-[color:var(--c-faint)]">(tope diario)</span></span>
                  <span className="tabular-nums font-semibold">{b.dailyUsedPct ?? 0}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-[color:var(--c-soft)] overflow-hidden"><div className={`h-full rounded-full transition-all duration-700 ${b.dailyLimitReached ? 'bg-[#EF4444]' : (b.dailyUsedPct ?? 0) >= 80 ? 'bg-[#F59E0B]' : 'bg-[#D20A2E]'}`} style={{ width: `${Math.min(100, b.dailyUsedPct ?? 0)}%` }} /></div>
              </div>
            )}

            <p className="mt-4 pt-4 border-t border-[color:var(--c-line)] text-[11px] text-[color:var(--c-muted)] flex items-start gap-1.5">
              <Sparkles className="w-3.5 h-3.5 shrink-0 mt-px text-[#D20A2E]" />
              El plan mide siempre el mes en curso y todos los modelos, sin importar los filtros de abajo. El cobro automático mensual al medio de pago se activará con la integración de pagos (aún no disponible): hoy este panel mide y aplica el límite.
            </p>
          </section>

          {/* Filtros */}
          <section className={`${card} p-5 relative z-20`} aria-label="Filtros de consumo" data-testid="finops-filters">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)_minmax(0,0.9fr)]">
              <Field label="Período" icon={CalendarRange} className="lg:col-span-2 xl:col-span-1">
                <Segmented full value={preset} onChange={setPreset} options={PRESETS} label="periodo" />
              </Field>
              <Field label="Modelo de IA" icon={Layers}>
                <Select value={modelo} onChange={setModelo} ariaLabel="Modelo" className="w-full" options={modelOptions} testId="finops-model-filter" />
              </Field>
              <Field label="Agrupar por" icon={BarChart3}>
                <Segmented full value={group} onChange={setGroup} options={GROUPS} label="agrupar" />
              </Field>
            </div>

            {preset === 'custom' && (
              <div className="mt-4 flex flex-wrap items-end gap-4 rounded-xl bg-[color:var(--c-canvas)] border border-[color:var(--c-line)] p-4 animate-fade-up">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--c-muted)]">Desde
                  <input type="date" value={custom.desde} max={custom.hasta || undefined} onChange={(e) => setCustom({ ...custom, desde: e.target.value })} data-testid="finops-from"
                    className="mt-1.5 block bg-white border border-[color:var(--c-line)] rounded-xl px-3 py-2.5 text-xs font-medium normal-case tracking-normal text-[color:var(--c-ink)]" />
                </label>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--c-muted)]">Hasta
                  <input type="date" value={custom.hasta} min={custom.desde || undefined} onChange={(e) => setCustom({ ...custom, hasta: e.target.value })} data-testid="finops-to"
                    className="mt-1.5 block bg-white border border-[color:var(--c-line)] rounded-xl px-3 py-2.5 text-xs font-medium normal-case tracking-normal text-[color:var(--c-ink)]" />
                </label>
                {!rangeOk && <span className="pb-2.5 text-[11px] text-[color:var(--c-rtx)]">Elige un rango válido: "desde" no puede ser posterior a "hasta".</span>}
              </div>
            )}

            <div className="mt-4 pt-4 border-t border-[color:var(--c-line)] flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap text-[11px]" data-testid="finops-summary-line">
                {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-[color:var(--c-muted)]" />}
                <span className="text-[color:var(--c-muted)]">Mostrando</span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--c-soft)] px-2.5 py-1 font-semibold text-[color:var(--c-ink)]"><CalendarRange className="w-3 h-3 text-[#D20A2E]" />{fmtRange(data.rangeFrom, data.rangeTo)}</span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--c-soft)] px-2.5 py-1 font-semibold text-[color:var(--c-ink)]"><Layers className="w-3 h-3 text-[#D20A2E]" />{modelName ?? 'Todos los modelos'}</span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--c-soft)] px-2.5 py-1 font-semibold text-[color:var(--c-ink)]"><BarChart3 className="w-3 h-3 text-[#D20A2E]" />Por {unit}</span>
              </div>
              {filtered && (
                <button onClick={reset} className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--c-line)] bg-white px-3 py-1.5 text-xs font-semibold text-[#D20A2E] hover:border-[color:var(--c-ch350)]" data-testid="finops-reset">
                  <RotateCcw className="w-3.5 h-3.5" /> Restablecer filtros
                </button>
              )}
            </div>
          </section>

          {/* KPIs del filtro */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <Stat icon={CircleDollarSign} label="Gasto del período" value={fmtUsd(total)} hint={`${fmtInt(data.calls)} llamadas al modelo`} />
            <Stat icon={ArrowDownToLine} label="Tokens de entrada" value={fmtTokens(data.inputTokens)} hint="Pregunta + fragmentos enviados" delay={60} />
            <Stat icon={ArrowUpFromLine} label="Tokens de salida" value={fmtTokens(data.outputTokens)} hint="Texto generado por el modelo" delay={120} />
            <Stat icon={MessagesSquare} label="Costo por conversación" value={data.avgCostPerConversationUsd !== undefined ? fmtUsd(data.avgCostPerConversationUsd) : '—'} hint={`${fmtInt(data.conversations)} conversaciones con IA`} delay={180} />
          </div>

          <PerformancePanel slug={slug} />

          {/* Gasto en el tiempo */}
          <section className={`${card} p-5 animate-fade-up`}>
            <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
              <h2 className="text-sm font-bold text-[color:var(--c-ink)] flex items-center gap-2"><Zap className="w-4 h-4 text-[#D20A2E]" /> Gasto por {unit}</h2>
              <span className="text-[11px] text-[color:var(--c-muted)]">USD · {fmtRange(data.rangeFrom, data.rangeTo)}</span>
            </div>
            {total === 0 ? (
              <p className="py-10 text-center text-xs text-[color:var(--c-muted)]">Sin consumo de IA con estos filtros.</p>
            ) : (
              <div className={`h-44 flex items-end border-b border-[color:var(--c-line)] pb-1 ${manyBars ? 'gap-px' : 'gap-[3px] sm:gap-1'}`} role="img" aria-label={`Gasto por ${unit} en dólares`} data-testid="finops-chart">
                {data.series.map((d) => (
                  <div key={d.date} className="group relative flex-1 h-full flex items-end min-w-0">
                    <div
                      className={`w-full rounded-t transition-all ${d.costUsd > 0 ? 'bg-[#D20A2E] group-hover:bg-[#E8405F]' : 'bg-[color:var(--c-soft)]'}`}
                      style={{ height: `${d.costUsd > 0 ? Math.max(4, (d.costUsd / maxPoint) * 100) : 2}%` }}
                    />
                    <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-10 hidden group-hover:block whitespace-nowrap rounded-lg bg-[color:var(--c-ink)] text-[color:var(--c-canvas)] px-2.5 py-1.5 text-[10px] leading-tight shadow-lg">
                      <p className="font-semibold capitalize">{pointLabel(d)}</p>
                      <p>{fmtUsd(d.costUsd)} · {fmtInt(d.calls)} llamadas</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-1.5 flex justify-between text-[10px] text-[color:var(--c-faint)] tabular-nums">
              <span>{fmtDay(data.rangeFrom, true)}</span><span>{fmtDay(data.rangeTo, true)}</span>
            </div>
          </section>

          {/* Por modelo */}
          <section className={`${card} overflow-hidden animate-fade-up`}>
            <div className="px-5 py-4 border-b border-[color:var(--c-line)]">
              <h2 className="text-sm font-bold text-[color:var(--c-ink)]">Consumo por modelo</h2>
              <p className="text-[11px] text-[color:var(--c-muted)] mt-0.5">Del período elegido. Haz clic en un modelo para filtrar el resto del panel. Costo con la tabla de precios de Bedrock (referencial).</p>
            </div>
            {data.byModel.length === 0 ? (
              <p className="py-10 text-center text-xs text-[color:var(--c-muted)]">Sin consumo de IA en este período.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-xs" data-testid="finops-models">
                  <thead className="bg-[color:var(--c-canvas)] text-[color:var(--c-muted)] text-left">
                    <tr>
                      <th className="px-5 py-3 font-semibold">Modelo</th>
                      <th className="px-5 py-3 font-semibold text-right">Llamadas</th>
                      <th className="px-5 py-3 font-semibold text-right">Entrada</th>
                      <th className="px-5 py-3 font-semibold text-right">Salida</th>
                      <th className="px-5 py-3 font-semibold text-right">Costo</th>
                      <th className="px-5 py-3 font-semibold w-32">% del gasto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const totalModelos = data.byModel.reduce((s, r) => s + r.costUsd, 0);
                      return data.byModel.map((r) => {
                        const share = totalModelos > 0 ? (r.costUsd / totalModelos) * 100 : 0;
                        const active = modelo === r.modelId;
                        return (
                          <tr
                            key={r.modelId} onClick={() => setModelo(active ? '' : r.modelId)} data-testid={`finops-row-${r.modelId}`}
                            className={`border-t border-[color:var(--c-line)] cursor-pointer transition-colors ${active ? 'bg-[color:var(--c-ch50)]' : 'hover:bg-[color:var(--c-canvas)]'}`}
                          >
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-2.5">
                                <span className="w-8 h-8 rounded-lg bg-[color:var(--c-canvas)] border border-[color:var(--c-line)] flex items-center justify-center"><ProviderLogo provider={r.providerId} size={18} /></span>
                                <span><span className="block font-semibold text-[color:var(--c-ink)]">{r.name}</span><span className="block text-[11px] text-[color:var(--c-muted)]">{r.provider}</span></span>
                              </div>
                            </td>
                            <td className="px-5 py-3 text-right tabular-nums text-[color:var(--c-ink)]">{fmtInt(r.calls)}</td>
                            <td className="px-5 py-3 text-right tabular-nums text-[color:var(--c-muted)]">{fmtTokens(r.inputTokens)}</td>
                            <td className="px-5 py-3 text-right tabular-nums text-[color:var(--c-muted)]">{fmtTokens(r.outputTokens)}</td>
                            <td className="px-5 py-3 text-right tabular-nums font-semibold text-[color:var(--c-ink)]">{fmtUsd(r.costUsd)}</td>
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-2">
                                <div className="flex-1 h-1.5 rounded-full bg-[color:var(--c-soft)] overflow-hidden"><div className="h-full bg-[#D20A2E] rounded-full" style={{ width: `${share}%` }} /></div>
                                <span className="tabular-nums text-[11px] text-[color:var(--c-muted)] w-9 text-right">{Math.round(share)}%</span>
                              </div>
                            </td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
};

/** Editor del plan (admin de la empresa o superadmin): límite mensual en USD, o sin límite. */
const PlanEditor: React.FC<{
  initial: { mode: 'limitado' | 'sin_limite'; monthlyLimitUsd?: number; dailyLimitUsd?: number };
  onCancel: () => void;
  onSave: (p: { mode: 'limitado' | 'sin_limite'; monthlyLimitUsd?: number; dailyLimitUsd?: number }) => Promise<void>;
}> = ({ initial, onCancel, onSave }) => {
  const [mode, setMode] = useState(initial.mode);
  const [amount, setAmount] = useState(initial.monthlyLimitUsd ? String(initial.monthlyLimitUsd) : '100');
  const [daily, setDaily] = useState(initial.dailyLimitUsd ? String(initial.dailyLimitUsd) : '');
  const [busy, setBusy] = useState(false);
  const value = Number(amount);
  const dailyValue = daily.trim() === '' ? undefined : Number(daily);
  const dailyInvalid = mode === 'limitado' && dailyValue !== undefined && (!Number.isFinite(dailyValue) || dailyValue < 0.01 || dailyValue > value);
  const invalid = (mode === 'limitado' && (!Number.isFinite(value) || value < 0.01)) || dailyInvalid;

  const option = (m: 'limitado' | 'sin_limite', title: string, text: string, Icon: React.ElementType) => (
    <button
      type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} data-testid={`plan-${m}`}
      className={`text-left flex items-start gap-3 p-3.5 rounded-xl border transition-all ${mode === m ? 'border-[#D20A2E] bg-[color:var(--c-ch50)] ring-2 ring-[#D20A2E]/15' : 'border-[color:var(--c-line)] bg-white hover:border-[color:var(--c-ch350)]'}`}
    >
      <span className="w-9 h-9 rounded-xl bg-[color:var(--c-ch100)] text-[#D20A2E] flex items-center justify-center shrink-0"><Icon className="w-4 h-4" /></span>
      <span><span className="block text-xs font-semibold text-[color:var(--c-ink)]">{title}</span><span className="block text-[11px] text-[color:var(--c-muted)] mt-0.5">{text}</span></span>
    </button>
  );

  return (
    <div className="mt-5 space-y-4">
      <div role="radiogroup" aria-label="Tipo de plan" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {option('limitado', 'Límite mensual', 'Un tope en USD por mes. Al llegar, el agente responde sin IA hasta el mes siguiente.', Gauge)}
        {option('sin_limite', 'Sin límite mensual', 'Nunca se corta: se cobra lo que se consuma en el mes.', InfinityIcon)}
      </div>
      {mode === 'limitado' && (
        <label className="block max-w-xs text-xs font-semibold text-[color:var(--c-ink)]">
          Límite mensual (USD)
          <div className="relative mt-1.5">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--c-muted)] text-sm">$</span>
            <input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="plan-amount"
              className="w-full bg-white border border-[color:var(--c-line)] rounded-xl pl-7 pr-3 py-2.5 text-sm tabular-nums" />
          </div>
          {mode === 'limitado' && (!Number.isFinite(value) || value < 0.01) && <span className="block mt-1 text-[11px] font-normal text-[color:var(--c-rtx)]">Ingresa un monto de al menos $0,01.</span>}
        </label>
      )}
      {mode === 'limitado' && (
        <label className="block max-w-xs text-xs font-semibold text-[color:var(--c-ink)]">
          Tope diario (USD) <span className="font-normal text-[color:var(--c-muted)]">· opcional</span>
          <div className="relative mt-1.5">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--c-muted)] text-sm">$</span>
            <input type="number" min="0.01" step="0.01" value={daily} onChange={(e) => setDaily(e.target.value)} placeholder="Sin tope diario" data-testid="plan-daily"
              className="w-full bg-white border border-[color:var(--c-line)] rounded-xl pl-7 pr-3 py-2.5 text-sm tabular-nums" />
          </div>
          <span className="block mt-1 text-[11px] font-normal text-[color:var(--c-muted)]">Evita que un mal día (o un abuso del widget) se coma el mes. Al alcanzarlo, el agente responde sin IA hasta mañana.</span>
          {dailyInvalid && <span className="block mt-1 text-[11px] font-normal text-[color:var(--c-rtx)]">Debe ser de al menos $0,01 y no superar el límite mensual.</span>}
        </label>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button" disabled={invalid || busy} data-testid="plan-save"
          onClick={async () => { setBusy(true); await onSave(mode === 'limitado' ? { mode, monthlyLimitUsd: value, ...(dailyValue !== undefined ? { dailyLimitUsd: dailyValue } : {}) } : { mode }); setBusy(false); }}
          className="px-4 py-2 rounded-xl bg-[#D20A2E] hover:bg-[#B00825] text-white text-xs font-semibold disabled:opacity-50"
        >{busy ? 'Guardando…' : 'Guardar plan'}</button>
        <button type="button" onClick={onCancel} className="px-4 py-2 rounded-xl border border-[color:var(--c-line)] bg-white text-xs font-semibold text-[color:var(--c-ink)]">Cancelar</button>
      </div>
    </div>
  );
};
