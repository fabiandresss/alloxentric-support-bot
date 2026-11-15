import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownRight, ArrowLeft, ArrowUpRight, CheckCircle2, ChevronDown, Clock, Coins, Download, FileSpreadsheet, Library, Loader2, Minus,
  Scale, Search, ShieldAlert, Target, ThumbsDown, ThumbsUp, TriangleAlert, UserRound, Bot, XCircle, Zap,
} from 'lucide-react';
import * as api from '../api/client';
import { AiModelOption, TestResult, TestRunDetail } from '../types';
import { fmtDateTime, fmtInt, fmtTokens, fmtUsd } from '../lib/format';
import { ProviderLogo } from './ProviderLogo';

interface TestRunViewProps {
  slug: string;
  runId: string;
  models: AiModelOption[];
  onBack: () => void;
  onToast: (type: 'success' | 'warning' | 'info', title: string, description?: string) => void;
}

const card = 'bg-white border border-[color:var(--c-line)] rounded-2xl card-glow';

const VEREDICTO = {
  aprobado: { label: 'Aprobado', cls: 'bg-[color:var(--c-gbg2)] text-[color:var(--c-gtx)]', icon: CheckCircle2 },
  fallido: { label: 'Fallido', cls: 'bg-[color:var(--c-rbg2)] text-[color:var(--c-rtx2)]', icon: XCircle },
  error: { label: 'Error', cls: 'bg-[color:var(--c-abg2)] text-[color:var(--c-atx2)]', icon: TriangleAlert },
} as const;

type Filtro = 'todos' | 'aprobado' | 'fallido' | 'error' | 'cambios';

/** Variación frente a la corrida anterior. `mejorSiSube` invierte el color cuando un número más bajo es mejor (latencia, costo). */
const Delta: React.FC<{ actual?: number; previo?: number; unidad?: string; decimales?: number; mejorSiSube?: boolean }> = ({ actual, previo, unidad = '', decimales = 1, mejorSiSube = true }) => {
  if (actual === undefined || previo === undefined) return null;
  const d = Math.round((actual - previo) * 10 ** decimales) / 10 ** decimales;
  if (d === 0) return <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-[color:var(--c-muted)]"><Minus className="w-3 h-3" /> igual</span>;
  const bueno = mejorSiSube ? d > 0 : d < 0;
  const Icon = d > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${bueno ? 'text-[color:var(--c-gtx)]' : 'text-[color:var(--c-rtx)]'}`} title="Frente a la corrida anterior">
      <Icon className="w-3 h-3" />{d > 0 ? '+' : ''}{d}{unidad}
    </span>
  );
};

const Kpi: React.FC<{ icon: React.ElementType; label: string; value: string; hint?: React.ReactNode; delta?: React.ReactNode }> = ({ icon: Icon, label, value, hint, delta }) => (
  <div className={`${card} p-4 animate-fade-up`}>
    <div className="flex items-center justify-between">
      <span className="text-xs font-medium text-[color:var(--c-muted)]">{label}</span>
      <span className="w-8 h-8 rounded-xl bg-[color:var(--c-ch100)] text-[#D20A2E] flex items-center justify-center"><Icon className="w-4 h-4" /></span>
    </div>
    <div className="mt-3 flex items-baseline gap-2 flex-wrap">
      <span className="text-2xl font-bold tracking-tight tabular-nums text-[color:var(--c-ink)]">{value}</span>
      {delta}
    </div>
    {hint && <p className="mt-1 text-[11px] text-[color:var(--c-muted)]">{hint}</p>}
  </div>
);

export const TestRunView: React.FC<TestRunViewProps> = ({ slug, runId, models, onBack, onToast }) => {
  const [d, setD] = useState<TestRunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [q, setQ] = useState('');
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const [exportando, setExportando] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setD(await api.getTestRun(slug, runId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar la corrida');
    }
  }, [slug, runId]);

  useEffect(() => { load(); }, [load]);
  const enCurso = d?.run.status === 'ejecutando';
  useEffect(() => {
    if (!enCurso) return;
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [enCurso, load]);

  const exportar = async (formato: 'csv' | 'excel') => {
    setExportando(formato);
    try {
      const nombre = await api.downloadTestRun(slug, runId, formato);
      onToast('success', 'Reporte exportado', nombre);
    } catch (e) {
      onToast('warning', 'No se pudo exportar', e instanceof Error ? e.message : undefined);
    } finally {
      setExportando(null);
    }
  };

  const run = d?.run;
  const prev = d?.previous?.summary;
  const sum = run?.summary;
  const modelo = models.find((m) => m.id === run?.modelId);
  const juez = models.find((m) => m.id === run?.judgeModelId);
  const cambio = (r: TestResult) => !!d?.previous && r.previousVerdict !== undefined && r.previousVerdict !== r.verdict;

  const resultados = useMemo(() => (d?.results ?? []).filter((r) => {
    if (filtro === 'cambios' ? !cambio(r) : filtro !== 'todos' && r.verdict !== filtro) return false;
    const t = q.trim().toLowerCase();
    return !t || r.question.toLowerCase().includes(t) || r.answer.toLowerCase().includes(t) || (r.expectedAnswer ?? '').toLowerCase().includes(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [d, filtro, q]);

  const etiquetar = async (r: TestResult, label: 'correcto' | 'incorrecto') => {
    const nueva = r.humanLabel === label ? null : label;      // volver a pulsar la misma quita la marca
    try {
      const out = await api.labelResult(slug, r.id, nueva);
      setD((prev) => prev && { ...prev, results: prev.results.map((x) => (x.id === r.id ? { ...x, humanLabel: out.humanLabel } : x)) });
    } catch (e) {
      onToast('warning', 'No se pudo guardar la etiqueta', e instanceof Error ? e.message : undefined);
    }
  };
  const toggle = (id: string) => setAbiertos((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const cuenta = (f: Filtro) => (d?.results ?? []).filter((r) => (f === 'todos' ? true : f === 'cambios' ? cambio(r) : r.verdict === f)).length;
  const pct = sum?.passRate ?? 0;
  const color = pct >= 80 ? 'bg-[#22C55E]' : pct >= 50 ? 'bg-[#F59E0B]' : 'bg-[#EF4444]';

  return (
    <div className="space-y-6" data-testid="test-run-view">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[color:var(--c-muted)] hover:text-[#D20A2E] transition-colors" data-testid="test-run-back">
        <ArrowLeft className="w-4 h-4" /> Volver a las pruebas
      </button>

      {error && <div className="p-4 rounded-xl border border-[color:var(--c-rline)] bg-[color:var(--c-rbg)] text-xs text-[color:var(--c-rtx2)]">{error}</div>}
      {!d && !error && <div className="py-20 flex justify-center text-[color:var(--c-muted)]"><Loader2 className="w-5 h-5 animate-spin" /></div>}

      {d && run && (
        <>
          <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight text-[color:var(--c-ink)] truncate">{run.setName}</h1>
              <div className="mt-2 flex items-center gap-2 flex-wrap text-[11px] text-[color:var(--c-muted)]">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--c-soft)] px-2.5 py-1 font-semibold text-[color:var(--c-ink)]"><Clock className="w-3 h-3 text-[#D20A2E]" />{fmtDateTime(run.startedAt)}</span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--c-soft)] px-2.5 py-1 font-semibold text-[color:var(--c-ink)]">{modelo && <ProviderLogo provider={modelo.providerId} size={14} />}<span className="font-normal text-[color:var(--c-muted)]">Agente:</span> {modelo?.name ?? run.modelId}</span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--c-soft)] px-2.5 py-1 font-semibold text-[color:var(--c-ink)]" title="LLM as a Judge: el modelo que puntúa cada respuesta frente a la esperada" data-testid="test-run-judge"><Scale className="w-3 h-3 text-[#D20A2E]" />{juez && <ProviderLogo provider={juez.providerId} size={14} />}<span className="font-normal text-[color:var(--c-muted)]">Juez:</span> {juez?.name ?? run.judgeModelId}</span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--c-soft)] px-2.5 py-1 font-semibold text-[color:var(--c-ink)]" title="Cómo estaba la base de conocimiento al correr la prueba"><Library className="w-3 h-3 text-[#D20A2E]" />{fmtInt(run.kb.documents)} docs · {fmtInt(run.kb.fragments)} fragmentos</span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--c-soft)] px-2.5 py-1 font-semibold text-[color:var(--c-ink)]"><Target className="w-3 h-3 text-[#D20A2E]" />Umbral RAG {Math.round(run.ragThreshold * 100)}%</span>
                {run.createdBy && <span>por {run.createdBy}</span>}
                {run.trigger && <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--c-ch100)] px-2.5 py-1 font-semibold text-[#D20A2E]" data-testid="test-run-trigger"><Zap className="w-3 h-3" />Disparada por: {run.trigger}</span>}
              </div>
              {d.previous && <p className="mt-2 text-[11px] text-[color:var(--c-muted)]">Comparada con la corrida del {fmtDateTime(d.previous.startedAt)} ({fmtInt(d.previous.kb.documents)} docs · {fmtInt(d.previous.kb.fragments)} fragmentos).</p>}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => exportar('csv')} disabled={enCurso || !!exportando} data-testid="test-export-csv"
                className="px-4 py-2.5 rounded-xl bg-[#D20A2E] hover:bg-[#B00825] text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50">
                {exportando === 'csv' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} Exportar CSV
              </button>
              <button onClick={() => exportar('excel')} disabled={enCurso || !!exportando} data-testid="test-export-excel" title="Separa las columnas con «;», como espera Excel en español"
                className="px-3.5 py-2.5 rounded-xl border border-[color:var(--c-line)] bg-white text-xs font-semibold text-[color:var(--c-ink)] flex items-center gap-1.5 disabled:opacity-50">
                {exportando === 'excel' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5 text-[#D20A2E]" />} Para Excel
              </button>
            </div>
          </div>

          {enCurso && (
            <section className={`${card} p-5`} role="status" data-testid="test-run-progress">
              <div className="flex items-center justify-between text-xs mb-2.5">
                <span className="font-semibold text-[color:var(--c-ink)] flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin text-[#D20A2E]" /> Ejecutando la prueba contra el agente…</span>
                <span className="tabular-nums text-[color:var(--c-muted)]">{run.completed} de {run.total} casos</span>
              </div>
              <div className="h-2.5 rounded-full bg-[color:var(--c-soft)] overflow-hidden"><div className="h-full bg-[#D20A2E] rounded-full transition-all duration-500" style={{ width: `${run.total ? (run.completed / run.total) * 100 : 0}%` }} /></div>
            </section>
          )}
          {run.status === 'error' && (
            <div role="alert" className="flex items-start gap-3 p-4 rounded-2xl border border-[color:var(--c-rline)] bg-[color:var(--c-rbg)] text-[color:var(--c-rtx2)] text-xs">
              <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" /> <p><span className="font-semibold">La corrida no terminó.</span> {d.error}</p>
            </div>
          )}
          {sum?.limitReached && (
            <div role="status" className="flex items-start gap-3 p-4 rounded-2xl border border-[color:var(--c-aline)] bg-[color:var(--c-abg)] text-[color:var(--c-atx2)] text-xs">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" /> <p><span className="font-semibold">El límite mensual de gasto cortó la IA durante esta corrida.</span> El agente respondió en modo extractivo y la evaluación usó palabras clave: los resultados no representan al modelo real.</p>
            </div>
          )}

          {sum && (
            <>
              <section className={`${card} p-5 sm:p-6 animate-fade-up`} aria-label="Resultado general">
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <p className="text-xs font-semibold uppercase tracking-wider text-[color:var(--c-muted)]">Tasa de aprobación</p>
                  <Delta actual={sum.passRate} previo={prev?.passRate} unidad=" pts" />
                </div>
                <div className="mt-2 flex items-end justify-between gap-4 flex-wrap">
                  <p className="text-4xl font-bold tracking-tight tabular-nums text-[color:var(--c-ink)]" data-testid="test-pass-rate">{sum.passRate}%</p>
                  <p className="text-xs text-[color:var(--c-muted)] tabular-nums"><strong className="text-[color:var(--c-gtx)]">{sum.passed}</strong> aprobados · <strong className="text-[color:var(--c-rtx)]">{sum.failed}</strong> fallidos{sum.errors > 0 && <> · <strong className="text-[color:var(--c-atx)]">{sum.errors}</strong> con error</>} · {sum.total} casos</p>
                </div>
                <div className="mt-3 h-3 rounded-full bg-[color:var(--c-soft)] overflow-hidden"><div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${pct}%` }} /></div>
              </section>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                <Kpi icon={Target} label="Puntaje de respuestas" value={sum.avgScore !== undefined ? sum.avgScore.toFixed(2) : '—'} hint="0 a 1 frente a lo esperado" delta={<Delta actual={sum.avgScore} previo={prev?.avgScore} decimales={2} />} />
                <Kpi icon={Library} label="Precisión de fuentes" value={sum.sourceAccuracy !== undefined ? `${sum.sourceAccuracy}%` : '—'} hint="Citó el documento esperado" delta={<Delta actual={sum.sourceAccuracy} previo={prev?.sourceAccuracy} unidad=" pts" />} />
                <Kpi icon={Bot} label="Precisión de derivación" value={sum.derivationAccuracy !== undefined ? `${sum.derivationAccuracy}%` : '—'} hint="Derivó (o no) como se esperaba" delta={<Delta actual={sum.derivationAccuracy} previo={prev?.derivationAccuracy} unidad=" pts" />} />
                <Kpi icon={CheckCircle2} label="Confianza RAG" value={sum.avgConfidence !== undefined ? `${sum.avgConfidence}%` : '—'} hint="Promedio del agente" delta={<Delta actual={sum.avgConfidence} previo={prev?.avgConfidence} unidad=" pts" />} />
                <Kpi icon={Clock} label="Latencia promedio" value={`${fmtInt(sum.avgLatencyMs)} ms`} hint={`p95: ${fmtInt(sum.p95LatencyMs)} ms`} delta={<Delta actual={sum.avgLatencyMs} previo={prev?.avgLatencyMs} unidad=" ms" decimales={0} mejorSiSube={false} />} />
                <Kpi icon={Download} label="Tokens" value={fmtTokens(sum.inputTokens + sum.outputTokens)} hint={`${fmtTokens(sum.inputTokens)} entrada · ${fmtTokens(sum.outputTokens)} salida`} />
                <Kpi icon={Coins} label="Costo del agente" value={fmtUsd(sum.agentCostUsd)} hint="Cuenta en tu plan de gasto" delta={<Delta actual={sum.agentCostUsd} previo={prev?.agentCostUsd} unidad=" USD" decimales={4} mejorSiSube={false} />} />
                <Kpi icon={Coins} label="Costo del juez" value={fmtUsd(sum.judgeCostUsd)} hint={`${juez?.name ?? run.judgeModelId} puntúa las respuestas`} />
              </div>
            </>
          )}

          {/* Resultados */}
          <section className={`${card} overflow-hidden animate-fade-up`} aria-label="Resultados por caso">
            <div className="px-5 py-4 border-b border-[color:var(--c-line)] space-y-3">
              <h2 className="text-sm font-bold text-[color:var(--c-ink)]">Respuestas del agente, caso por caso</h2>
              <div className="flex flex-col md:flex-row gap-3 md:items-center justify-between">
                <div role="radiogroup" aria-label="Filtrar resultados" className="flex p-1 rounded-xl bg-[color:var(--c-soft)] text-xs font-semibold overflow-x-auto max-w-full">
                  {([['todos', 'Todos'], ['aprobado', 'Aprobados'], ['fallido', 'Fallidos'], ['error', 'Con error'], ...(d.previous ? [['cambios', 'Cambiaron']] : [])] as [Filtro, string][]).map(([id, label]) => (
                    <button key={id} role="radio" aria-checked={filtro === id} onClick={() => setFiltro(id)} data-testid={`test-filter-${id}`}
                      className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-all ${filtro === id ? 'bg-[#D20A2E] text-white shadow-sm' : 'text-[color:var(--c-muted)] hover:text-[color:var(--c-ink)]'}`}>
                      {label} <span className="tabular-nums opacity-80">{cuenta(id)}</span>
                    </button>
                  ))}
                </div>
                <div className="relative md:w-72">
                  <Search className="w-3.5 h-3.5 text-[color:var(--c-faint)] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en preguntas y respuestas…" aria-label="Buscar en los resultados" className="w-full bg-white border border-[color:var(--c-line)] rounded-xl pl-8 pr-3 py-2 text-xs" />
                </div>
              </div>
            </div>

            {resultados.length === 0 ? (
              <p className="py-12 text-center text-xs text-[color:var(--c-muted)]">{enCurso ? 'Los resultados aparecen a medida que termina cada caso.' : 'Ningún caso coincide con el filtro.'}</p>
            ) : (
              <ul className="divide-y divide-[color:var(--c-line)]" data-testid="test-results">
                {resultados.map((r) => {
                  const v = VEREDICTO[r.verdict];
                  const Icon = v.icon;
                  const abierto = abiertos.has(r.id);
                  const regresion = r.previousVerdict === 'aprobado' && r.verdict !== 'aprobado';
                  const mejoro = r.previousVerdict !== undefined && r.previousVerdict !== 'aprobado' && r.verdict === 'aprobado';
                  return (
                    <li key={r.id} data-testid={`test-result-${r.order}`}>
                      <button onClick={() => toggle(r.id)} aria-expanded={abierto} className="w-full text-left px-5 py-3.5 flex items-start gap-3 hover:bg-[color:var(--c-canvas)] transition-colors">
                        <span className="w-6 h-6 mt-0.5 rounded-md bg-[color:var(--c-soft)] text-[10px] font-bold text-[color:var(--c-muted)] flex items-center justify-center shrink-0 tabular-nums">{r.order}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-semibold text-[color:var(--c-ink)]">{r.question}</span>
                          <span className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${v.cls}`}><Icon className="w-3 h-3" />{v.label}</span>
                            {r.score !== undefined && <span className="text-[11px] text-[color:var(--c-muted)] tabular-nums">puntaje {r.score.toFixed(2)}</span>}
                            {r.sourceOk !== undefined && <span className={`text-[11px] font-medium ${r.sourceOk ? 'text-[color:var(--c-gtx)]' : 'text-[color:var(--c-rtx)]'}`}>{r.sourceOk ? 'fuente ✓' : 'fuente ✗'}</span>}
                            <span className={`text-[11px] font-medium ${r.escalationOk ? 'text-[color:var(--c-muted)]' : 'text-[color:var(--c-rtx)]'}`}>{r.escalated ? 'derivó' : 'respondió'}{!r.escalationOk && ' ✗'}</span>
                            <span className="text-[11px] text-[color:var(--c-faint)] tabular-nums">{fmtInt(r.latencyMs)} ms</span>
                            {regresion && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[color:var(--c-rbg2)] text-[color:var(--c-rtx2)]">Regresión</span>}
                            {mejoro && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[color:var(--c-gbg2)] text-[color:var(--c-gtx)]">Mejoró</span>}
                          </span>
                        </span>
                        <ChevronDown className={`w-4 h-4 mt-1 shrink-0 text-[color:var(--c-muted)] transition-transform duration-200 ${abierto ? 'rotate-180' : ''}`} />
                      </button>
                      {abierto && (
                        <div className="px-5 pb-5 pt-1 grid md:grid-cols-2 gap-3 animate-fade-up">
                          <div className="rounded-xl border border-[color:var(--c-line)] bg-[color:var(--c-canvas)] p-3.5">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-[color:var(--c-muted)] flex items-center gap-1.5 mb-1.5"><UserRound className="w-3 h-3" /> Lo esperado</p>
                            {r.shouldEscalate ? <p className="text-xs text-[color:var(--c-ink)]">Debe <strong>derivar a un humano</strong> (la respuesta no está en la documentación).</p> : (
                              <>
                                <p className="text-xs text-[color:var(--c-ink)] whitespace-pre-wrap">{r.expectedAnswer || <span className="text-[color:var(--c-muted)]">Sin respuesta esperada (solo se revisó la derivación y la fuente).</span>}</p>
                                {r.expectedDocument && <p className="mt-2 text-[11px] text-[color:var(--c-muted)]">Documento esperado: <strong className="text-[color:var(--c-ink)]">{r.expectedDocument}</strong></p>}
                              </>
                            )}
                          </div>
                          <div className="rounded-xl border border-[color:var(--c-line)] p-3.5">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-[#D20A2E] flex items-center gap-1.5 mb-1.5"><Bot className="w-3 h-3" /> Respuesta del agente</p>
                            <p className="text-xs text-[color:var(--c-ink)] whitespace-pre-wrap">{r.answer || <span className="text-[color:var(--c-muted)]">—</span>}</p>
                            <p className="mt-2 text-[11px] text-[color:var(--c-muted)]">
                              {r.sources.length ? <>Fuentes: <strong className="text-[color:var(--c-ink)]">{r.sources.join(', ')}</strong></> : 'Sin fuentes citadas'}
                              {r.confidence !== undefined && <> · confianza {Math.round(r.confidence * 100)}%</>}
                            </p>
                          </div>
                          <div className="md:col-span-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-[color:var(--c-muted)] tabular-nums">
                            {r.reason && <span className="basis-full text-[color:var(--c-ink)]"><strong>Evaluación:</strong> {r.reason}</span>}
                            <span>{fmtInt(r.inputTokens)} tokens de entrada</span><span>{fmtInt(r.outputTokens)} de salida</span><span>{fmtUsd(r.costUsd)}</span>
                            {r.previousVerdict && <span>Corrida anterior: <strong className="text-[color:var(--c-ink)]">{r.previousVerdict}</strong></span>}
                          </div>
                          {r.answer && !r.shouldEscalate && !r.escalated && r.expectedAnswer && (
                            <div className="md:col-span-2 flex items-center gap-2 flex-wrap rounded-xl border border-dashed border-[color:var(--c-line2)] px-3.5 py-2.5" data-testid={`label-box-${r.order}`}>
                              <span className="text-[11px] font-semibold text-[color:var(--c-ink)] flex items-center gap-1.5"><Scale className="w-3.5 h-3.5 text-[#D20A2E]" /> ¿Esta respuesta es correcta?</span>
                              <button onClick={() => etiquetar(r, 'correcto')} aria-pressed={r.humanLabel === 'correcto'} data-testid={`label-ok-${r.order}`}
                                className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1 transition-colors ${r.humanLabel === 'correcto' ? 'bg-[color:var(--c-gbg2)] border-[color:var(--c-gline)] text-[color:var(--c-gtx)]' : 'border-[color:var(--c-line)] bg-white text-[color:var(--c-muted)] hover:text-[color:var(--c-gtx)]'}`}><ThumbsUp className="w-3 h-3" /> Correcta</button>
                              <button onClick={() => etiquetar(r, 'incorrecto')} aria-pressed={r.humanLabel === 'incorrecto'} data-testid={`label-bad-${r.order}`}
                                className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1 transition-colors ${r.humanLabel === 'incorrecto' ? 'bg-[color:var(--c-rbg2)] border-[color:var(--c-rline)] text-[color:var(--c-rtx2)]' : 'border-[color:var(--c-line)] bg-white text-[color:var(--c-muted)] hover:text-[color:var(--c-rtx)]'}`}><ThumbsDown className="w-3 h-3" /> Incorrecta</button>
                              {r.humanLabel && ((r.humanLabel === 'correcto') !== (r.verdict === 'aprobado')) && (
                                <span className="text-[11px] font-semibold text-[color:var(--c-atx2)] flex items-center gap-1" data-testid={`label-mismatch-${r.order}`}><TriangleAlert className="w-3 h-3" /> El juez y tú no coinciden</span>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
};
