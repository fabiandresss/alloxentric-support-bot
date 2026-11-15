import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bot, ClipboardList, FlaskConical, GitCompare, History, Loader2, Pencil, Play, Plus, Scale, Sparkles, Trash2, TriangleAlert, UserRound, Wand2, Zap,
} from 'lucide-react';
import * as api from '../api/client';
import { AiModelOption, AuthUser, Company, DocumentItem, TestCase, TestRunBrief, TestSet, TestSetItem } from '../types';
import { fmtDateTime, fmtInt } from '../lib/format';
import { Modal } from './Modal';
import { ProviderLogo } from './ProviderLogo';
import { Select } from './Select';
import { TestRunView } from './TestRunView';
import { ComparisonView } from './ComparisonView';
import { CalibrationPanel } from './CalibrationPanel';

interface TestingViewProps {
  me: AuthUser;
  companies: Company[];
  onToast: (type: 'success' | 'warning' | 'info', title: string, description?: string) => void;
  focusRunId?: string | null;   // abrir directamente una corrida (viene de una notificación)
  onFocusConsumed?: () => void;
}

const card = 'bg-white border border-[color:var(--c-line)] rounded-2xl card-glow';
const input = 'w-full bg-white border border-[color:var(--c-line)] rounded-xl px-3.5 py-2.5 text-xs text-[color:var(--c-ink)] placeholder:text-[color:var(--c-faint)]';
const btnPrimary = 'px-4 py-2.5 rounded-xl bg-[#D20A2E] hover:bg-[#B00825] text-white text-xs font-semibold disabled:opacity-50 flex items-center gap-1.5';
const btnGhost = 'px-4 py-2.5 rounded-xl border border-[color:var(--c-line)] bg-white text-xs font-semibold text-[color:var(--c-ink)] disabled:opacity-50 flex items-center gap-1.5';

/** Opciones del menú de modelos, con el logo de cada proveedor. */
const modelOptions = (models: AiModelOption[]) => models.map((m) => ({ value: m.id, label: m.name, hint: m.provider + (m.recommended ? ' · recomendado' : ''), icon: <ProviderLogo provider={m.providerId} size={18} /> }));
const JUEZ_DEFECTO = 'haiku-5-5';

const rateChip = (p: number) => (p >= 80 ? 'bg-[color:var(--c-gbg2)] text-[color:var(--c-gtx)]' : p >= 50 ? 'bg-[color:var(--c-abg2)] text-[color:var(--c-atx2)]' : 'bg-[color:var(--c-rbg2)] text-[color:var(--c-rtx2)]');

/** Chip con el estado de una corrida (tasa de aprobación, en curso o con error). */
const RunChip: React.FC<{ run?: TestRunBrief }> = ({ run }) => {
  if (!run) return <span className="text-[11px] text-[color:var(--c-faint)]">Sin corridas</span>;
  if (run.status === 'ejecutando') return <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[color:var(--c-atx2)]"><Loader2 className="w-3 h-3 animate-spin" />{run.completed}/{run.total}</span>;
  if (run.status === 'error' || !run.summary) return <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[color:var(--c-rbg2)] text-[color:var(--c-rtx2)]">Con error</span>;
  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold tabular-nums ${rateChip(run.summary.passRate)}`}>{run.summary.passRate}% aprobado</span>;
};

export const TestingView: React.FC<TestingViewProps> = ({ me, companies, onToast, focusRunId, onFocusConsumed }) => {
  const isSuper = me.role === 'superadmin';
  const [slug, setSlug] = useState<string>(isSuper ? companies[0]?.id ?? '' : me.companyId ?? '');
  const [tab, setTab] = useState<'sets' | 'runs' | 'calibration'>('sets');
  const [compareId, setCompareId] = useState<string | null>(null);
  const [sets, setSets] = useState<TestSetItem[]>([]);
  const [runs, setRuns] = useState<TestRunBrief[]>([]);
  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [models, setModels] = useState<AiModelOption[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [runId, setRunId] = useState<string | null>(null);
  const [runsSet, setRunsSet] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<'nuevo' | 'generar' | null>(null);

  useEffect(() => { api.getAiModels().then(setModels).catch(() => setModels([])); }, []);
  useEffect(() => { setSelected(''); setRunId(null); setCompareId(null); setRunsSet(''); }, [slug]);
  useEffect(() => { if (focusRunId) { setCompareId(null); setRunId(focusRunId); onFocusConsumed?.(); } }, [focusRunId, onFocusConsumed]);

  const load = useCallback(async () => {
    if (!slug) return;
    try {
      const [s, r, d] = await Promise.all([api.getTestSets(slug), api.getTestRuns(slug), api.getDocuments(slug)]);
      setSets(s);
      setRuns(r);
      setDocs(d);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar las pruebas');
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  useEffect(() => { if (!selected && sets.length) setSelected(sets[0].id); if (selected && !sets.some((s) => s.id === selected)) setSelected(sets[0]?.id ?? ''); }, [sets, selected]);
  // mientras haya una corrida en curso, la lista se refresca sola
  const hayEnCurso = runs.some((r) => r.status === 'ejecutando');
  useEffect(() => {
    if (!hayEnCurso) return;
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [hayEnCurso, load]);

  const company = companies.find((c) => c.id === slug);
  const processed = useMemo(() => docs.filter((d) => d.status === 'procesado'), [docs]);
  const modelOf = (id: string) => models.find((m) => m.id === id);

  if (compareId && !runId) {
    return <ComparisonView slug={slug} groupId={compareId} models={models} onBack={() => { setCompareId(null); load(); }} onOpenRun={setRunId} />;
  }
  if (runId) {
    return <TestRunView slug={slug} runId={runId} models={models} onBack={() => { setRunId(null); load(); }} onToast={onToast} />;
  }

  const runsShown = runs.filter((r) => !runsSet || r.setId === runsSet);
  const trend = runsSet ? [...runsShown].filter((r) => r.summary).reverse().slice(-12) : [];

  return (
    <div className="space-y-6" data-testid="testing-view">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[color:var(--c-ink)]">Pruebas del agente</h1>
          <p className="text-xs text-[color:var(--c-muted)] mt-1 max-w-2xl">
            Mide cómo responde el agente{company ? ` de ${company.name}` : ''} con conjuntos de preguntas de referencia (golden sets). Córrelos después de ingestar documentación para ver si el desempeño mejoró o empeoró.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isSuper && <Select value={slug} onChange={setSlug} ariaLabel="Empresa" size="sm" className="w-52" options={companies.map((c) => ({ value: c.id, label: c.name }))} />}
          <button onClick={() => setModal('generar')} className={btnGhost} data-testid="test-generate"><Wand2 className="w-3.5 h-3.5 text-[#D20A2E]" /> Generar con IA</button>
          <button onClick={() => setModal('nuevo')} className={btnPrimary} data-testid="test-new-set"><Plus className="w-3.5 h-3.5" /> Nuevo conjunto</button>
        </div>
      </div>

      <div role="tablist" aria-label="Secciones" className="flex gap-1 border-b border-[color:var(--c-line)]">
        {([['sets', 'Conjuntos de prueba', ClipboardList, sets.length], ['runs', 'Historial de corridas', History, runs.length], ['calibration', 'Calibración del juez', Scale, null]] as const).map(([id, label, Icon, n]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} data-testid={`test-tab-${id}`}
            className={`relative px-4 py-2.5 text-xs font-semibold flex items-center gap-1.5 transition-colors ${tab === id ? 'text-[#D20A2E]' : 'text-[color:var(--c-muted)] hover:text-[color:var(--c-ink)]'}`}>
            <Icon className="w-4 h-4" /> {label} {n !== null && <span className="tabular-nums text-[10px] rounded-full bg-[color:var(--c-soft)] px-1.5 py-px text-[color:var(--c-muted)]">{n}</span>}
            {tab === id && <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-[#D20A2E] rounded-full" />}
          </button>
        ))}
      </div>

      {error && <div className="p-4 rounded-xl border border-[color:var(--c-rline)] bg-[color:var(--c-rbg)] text-xs text-[color:var(--c-rtx2)]">{error}</div>}
      {loading && <div className="py-16 flex justify-center text-[color:var(--c-muted)]"><Loader2 className="w-5 h-5 animate-spin" /></div>}

      {!loading && tab === 'sets' && (
        sets.length === 0 ? (
          <div className={`${card} py-14 px-6 text-center animate-fade-up`}>
            <span className="w-14 h-14 rounded-2xl bg-[color:var(--c-ch100)] text-[#D20A2E] inline-flex items-center justify-center mb-4"><FlaskConical className="w-7 h-7" /></span>
            <h2 className="text-sm font-bold text-[color:var(--c-ink)]">Crea tu primer golden set</h2>
            <p className="text-xs text-[color:var(--c-muted)] mt-1.5 max-w-md mx-auto">Un golden set es una lista de preguntas con la respuesta que esperas. Puedes escribirlas tú o dejar que la IA las proponga a partir de tu documentación.</p>
            <div className="mt-5 flex items-center justify-center gap-2 flex-wrap">
              <button onClick={() => setModal('generar')} className={btnPrimary}><Wand2 className="w-3.5 h-3.5" /> Generar con IA</button>
              <button onClick={() => setModal('nuevo')} className={btnGhost}><Plus className="w-3.5 h-3.5" /> Crear manualmente</button>
            </div>
          </div>
        ) : (
          <div className="grid lg:grid-cols-[18rem_minmax(0,1fr)] gap-5 items-start">
            <ul className="space-y-2.5" aria-label="Conjuntos">
              {sets.map((s, i) => (
                <li key={s.id} style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }} className="animate-fade-up">
                  <button onClick={() => setSelected(s.id)} data-testid={`test-set-${s.id}`}
                    className={`w-full text-left p-3.5 rounded-2xl border transition-all ${selected === s.id ? 'border-[#D20A2E] bg-[color:var(--c-ch50)] ring-2 ring-[#D20A2E]/10' : 'border-[color:var(--c-line)] bg-white hover:border-[color:var(--c-ch350)]'}`}>
                    <p className="text-xs font-bold text-[color:var(--c-ink)] truncate">{s.name}</p>
                    <p className="text-[11px] text-[color:var(--c-muted)] mt-0.5">{s.caseCount} caso{s.caseCount === 1 ? '' : 's'}{s.aiCases > 0 && <> · <Sparkles className="inline w-3 h-3 text-[#D20A2E] -mt-0.5" /> {s.aiCases} con IA</>}</p>
                    <div className="mt-2 flex items-center justify-between gap-2"><RunChip run={s.lastRun} /><span className="text-[10px] text-[color:var(--c-faint)]">{s.lastRun ? fmtDateTime(s.lastRun.startedAt) : ''}</span></div>
                  </button>
                </li>
              ))}
            </ul>
            {selected && <SetEditor key={selected} slug={slug} setId={selected} docs={processed} models={models} agentModelId={company?.aiModel} onChanged={load} onOpenRun={setRunId} onOpenComparison={setCompareId} onToast={onToast} />}
          </div>
        )
      )}

      {!loading && tab === 'runs' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <Select value={runsSet} onChange={setRunsSet} ariaLabel="Conjunto" size="sm" className="w-64" testId="test-runs-filter"
              options={[{ value: '', label: 'Todos los conjuntos' }, ...sets.map((s) => ({ value: s.id, label: s.name }))]} />
            <span className="text-xs text-[color:var(--c-muted)]">{runsShown.length} corrida{runsShown.length === 1 ? '' : 's'}</span>
          </div>

          {trend.length > 1 && (
            <section className={`${card} p-5 animate-fade-up`} aria-label="Evolución">
              <h2 className="text-sm font-bold text-[color:var(--c-ink)]">Evolución de la tasa de aprobación</h2>
              <p className="text-[11px] text-[color:var(--c-muted)] mt-0.5">Cada barra es una corrida. Si cae tras ingestar un documento, ese documento pudo afectar al agente.</p>
              <div className="mt-4 h-28 flex items-end gap-2" role="img" aria-label="Tasa de aprobación por corrida">
                {trend.map((r) => (
                  <button key={r.id} onClick={() => setRunId(r.id)} className="group relative flex-1 h-full flex items-end min-w-0" title={`${fmtDateTime(r.startedAt)} · ${r.summary?.passRate}%`}>
                    <span className={`w-full rounded-t-md transition-all group-hover:opacity-80 ${(r.summary?.passRate ?? 0) >= 80 ? 'bg-[#22C55E]' : (r.summary?.passRate ?? 0) >= 50 ? 'bg-[#F59E0B]' : 'bg-[#EF4444]'}`} style={{ height: `${Math.max(4, r.summary?.passRate ?? 0)}%` }} />
                    <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] font-semibold tabular-nums text-[color:var(--c-muted)]">{r.summary?.passRate}%</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {runsShown.length === 0 ? (
            <p className={`${card} py-12 text-center text-xs text-[color:var(--c-muted)]`}>Aún no hay corridas. Ejecuta un conjunto desde la pestaña «Conjuntos de prueba».</p>
          ) : (
            <ul className={`${card} divide-y divide-[color:var(--c-line)] overflow-hidden`} data-testid="test-runs">
              {runsShown.map((r, i) => {
                const mo = modelOf(r.modelId);
                return (
                  <li key={r.id} style={{ animationDelay: `${Math.min(i, 10) * 25}ms` }} className="animate-fade-up">
                    <div className="flex items-center gap-3 px-5 py-3.5 hover:bg-[color:var(--c-canvas)] transition-colors">
                      <button onClick={() => setRunId(r.id)} data-testid={`test-run-${r.id}`} className="flex-1 min-w-0 text-left flex items-center gap-4 flex-wrap">
                        <span className="min-w-0 flex-1 basis-56">
                          <span className="block text-xs font-bold text-[color:var(--c-ink)] truncate">{r.setName}</span>
                          <span className="block text-[11px] text-[color:var(--c-muted)]">{fmtDateTime(r.startedAt)}{r.createdBy ? ` · ${r.createdBy}` : ''}</span>
                          {r.trigger && <span className="block text-[11px] text-[color:var(--c-muted)] truncate" data-testid="test-run-trigger">Disparada por: {r.trigger}</span>}
                        </span>
                        <span className="flex items-center gap-1.5 text-[11px] font-medium text-[color:var(--c-ink)]">{mo && <ProviderLogo provider={mo.providerId} size={14} />}{mo?.name ?? r.modelId}</span>
                        <span className="text-[11px] text-[color:var(--c-muted)] tabular-nums" title="Base de conocimiento al correr">{fmtInt(r.kb.documents)} docs · {fmtInt(r.kb.fragments)} frag.</span>
                        {r.origin === 'automatica' && <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#D20A2E] bg-[color:var(--c-ch100)] rounded-full px-2 py-0.5"><Zap className="w-2.5 h-2.5" />Automática</span>}
                        {r.groupId && <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[color:var(--c-ink)] bg-[color:var(--c-soft)] rounded-full px-2 py-0.5" title="Parte de una comparativa de modelos"><GitCompare className="w-2.5 h-2.5" />Comparativa</span>}
                        <RunChip run={r} />
                      </button>
                      <button aria-label="Eliminar corrida" disabled={r.status === 'ejecutando'} onClick={async () => { try { await api.deleteTestRun(slug, r.id); load(); } catch (e) { onToast('warning', 'No se pudo eliminar', e instanceof Error ? e.message : undefined); } }}
                        className="p-2 rounded-lg text-[color:var(--c-muted)] hover:text-[color:var(--c-rtx)] hover:bg-[color:var(--c-rbg)] disabled:opacity-40"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {!loading && tab === 'calibration' && <CalibrationPanel slug={slug} models={models} onToast={onToast} />}

      {modal === 'nuevo' && (
        <SetModal onClose={() => setModal(null)} onSave={async (p) => {
          const s = await api.createTestSet(slug, p);
          setModal(null);
          setTab('sets');
          await load();
          setSelected(s.id);
          onToast('success', 'Conjunto creado', 'Agrega los casos de prueba.');
        }} />
      )}
      {modal === 'generar' && (
        <GenerateModal docs={processed} models={models} onClose={() => setModal(null)} onGenerate={async (p) => {
          const s = await api.generateTestSet(slug, p);
          setModal(null);
          setTab('sets');
          await load();
          setSelected(s.id);
          onToast('success', 'Casos generados con IA', `${s.caseCount} casos para revisar antes de ejecutar.`);
        }} />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------------------------- editor de un conjunto
const SetEditor: React.FC<{
  slug: string; setId: string; docs: DocumentItem[]; models: AiModelOption[]; agentModelId?: string; onChanged: () => void; onOpenRun: (id: string) => void; onOpenComparison: (groupId: string) => void;
  onToast: (t: 'success' | 'warning' | 'info', title: string, d?: string) => void;
}> = ({ slug, setId, docs, models, agentModelId, onChanged, onOpenRun, onOpenComparison, onToast }) => {
  const [set, setSet] = useState<TestSet | null>(null);
  const [configuring, setConfiguring] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [editing, setEditing] = useState<TestCase | 'nuevo' | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => { try { setSet(await api.getTestSet(slug, setId)); } catch { setSet(null); } }, [slug, setId]);
  useEffect(() => { load(); }, [load]);

  if (!set) return <div className={`${card} py-16 flex justify-center text-[color:var(--c-muted)]`}><Loader2 className="w-5 h-5 animate-spin" /></div>;

  const refrescar = async () => { await load(); onChanged(); };
  const ejecutar = async (judgeModelId: string) => {
    setRunning(true);
    try {
      const run = await api.runTestSet(slug, setId, { judgeModelId });
      setConfiguring(false);
      onChanged();
      onOpenRun(run.id);
    } catch (e) {
      onToast('warning', 'No se pudo iniciar la prueba', e instanceof Error ? e.message : undefined);
    } finally {
      setRunning(false);
    }
  };
  const borrar = async () => {
    if (!window.confirm(`¿Eliminar el conjunto «${set.name}», sus casos y todas sus corridas? Esta acción no se puede deshacer.`)) return;
    try { await api.deleteTestSet(slug, setId); onChanged(); } catch (e) { onToast('warning', 'No se pudo eliminar', e instanceof Error ? e.message : undefined); }
  };

  return (
    <section className={`${card} overflow-hidden animate-fade-up`} data-testid="test-set-editor">
      <div className="px-5 py-4 border-b border-[color:var(--c-line)] flex flex-col md:flex-row md:items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-[color:var(--c-ink)] flex items-center gap-2 truncate">{set.name}
            <button onClick={() => setRenaming(true)} aria-label="Renombrar conjunto" className="p-1 rounded-md text-[color:var(--c-muted)] hover:text-[#D20A2E]"><Pencil className="w-3.5 h-3.5" /></button></h2>
          <p className="text-[11px] text-[color:var(--c-muted)] mt-0.5">{set.description || 'Sin descripción.'}</p>
          {set.generatedWith && (
            <p className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] text-[color:var(--c-muted)]" data-testid="test-set-generated-with">
              <Sparkles className="w-3 h-3 text-[#D20A2E]" /> Casos generados con <strong className="text-[color:var(--c-ink)]">{models.find((m) => m.id === set.generatedWith)?.name ?? set.generatedWith}</strong>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <button onClick={borrar} aria-label="Eliminar conjunto" className="p-2.5 rounded-xl border border-[color:var(--c-line)] bg-white text-[color:var(--c-muted)] hover:text-[color:var(--c-rtx)]"><Trash2 className="w-4 h-4" /></button>
          <button onClick={() => setComparing(true)} disabled={set.cases.length === 0} className={btnGhost} data-testid="test-compare"><GitCompare className="w-3.5 h-3.5 text-[#D20A2E]" /> Comparar modelos</button>
          <button onClick={() => setEditing('nuevo')} className={btnGhost} data-testid="test-add-case"><Plus className="w-3.5 h-3.5" /> Agregar caso</button>
          <button onClick={() => setConfiguring(true)} disabled={running || set.cases.length === 0} className={btnPrimary} data-testid="test-run">
            <Play className="w-3.5 h-3.5" /> Ejecutar prueba
          </button>
        </div>
      </div>

      <div className="px-5 py-3 border-b border-[color:var(--c-line)] bg-[color:var(--c-canvas)]">
        <button type="button" role="switch" aria-checked={set.autoRun} data-testid="test-auto" onClick={async () => {
          try { await api.updateTestSet(slug, setId, { autoRun: !set.autoRun }); refrescar(); onToast('success', !set.autoRun ? 'Pruebas automáticas activadas' : 'Pruebas automáticas desactivadas', !set.autoRun ? 'Este conjunto correrá solo al subir, reemplazar o eliminar documentos.' : undefined); }
          catch (e) { onToast('warning', 'No se pudo cambiar', e instanceof Error ? e.message : undefined); }
        }} className="w-full flex items-start gap-3 text-left">
          <span className={`mt-0.5 w-9 h-5 rounded-full p-0.5 shrink-0 transition-colors ${set.autoRun ? 'bg-[#D20A2E]' : 'bg-[color:var(--c-line2)]'}`}><span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform ${set.autoRun ? 'translate-x-4' : ''}`} /></span>
          <span><span className="flex items-center gap-1.5 text-xs font-semibold text-[color:var(--c-ink)]"><Zap className="w-3.5 h-3.5 text-[#D20A2E]" /> Correr automáticamente cuando cambie la base de conocimiento</span>
            <span className="block text-[11px] text-[color:var(--c-muted)] mt-0.5">Al subir, reemplazar o eliminar un documento se ejecuta solo y avisa en la campana si el desempeño bajó o mejoró. Gasta tokens en cada cambio.</span></span>
        </button>
      </div>

      {set.cases.length === 0 ? (
        <p className="py-14 text-center text-xs text-[color:var(--c-muted)]">Este conjunto no tiene casos. Agrega el primero.</p>
      ) : (
        <ul className="divide-y divide-[color:var(--c-line)]" data-testid="test-cases">
          {set.cases.map((c) => (
            <li key={c.id} className="group px-5 py-3.5 flex items-start gap-3 hover:bg-[color:var(--c-canvas)] transition-colors">
              <span className="w-6 h-6 mt-0.5 rounded-md bg-[color:var(--c-soft)] text-[10px] font-bold text-[color:var(--c-muted)] flex items-center justify-center shrink-0 tabular-nums">{c.order}</span>
              <button onClick={() => setEditing(c)} className="min-w-0 flex-1 text-left">
                <span className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-[color:var(--c-ink)]">{c.question}</span>
                  {c.origin === 'ia' && <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#D20A2E] bg-[color:var(--c-ch100)] rounded-full px-1.5 py-px"><Sparkles className="w-2.5 h-2.5" />IA</span>}
                  {c.origin === 'real' && <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[color:var(--c-gtx)] bg-[color:var(--c-gbg2)] rounded-full px-1.5 py-px" title="Salió de una conversación real">Conversación real</span>}
                </span>
                {c.shouldEscalate ? (
                  <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-[color:var(--c-atx2)] bg-[color:var(--c-abg2)] rounded-md px-2 py-0.5"><UserRound className="w-3 h-3" /> Debe derivar a un humano</span>
                ) : (
                  <span className="block mt-1 text-[11px] text-[color:var(--c-muted)] line-clamp-2">
                    {c.expectedAnswer ? <><Bot className="inline w-3 h-3 -mt-0.5 mr-1" />{c.expectedAnswer}</> : 'Sin respuesta esperada'}
                    {c.expectedDocument && <span className="ml-2 font-medium text-[color:var(--c-ink)]">· {c.expectedDocument}</span>}
                  </span>
                )}
              </button>
              <button aria-label="Eliminar caso" onClick={async () => { try { await api.deleteTestCase(slug, c.id); refrescar(); } catch (e) { onToast('warning', 'No se pudo eliminar', e instanceof Error ? e.message : undefined); } }}
                className="p-1.5 rounded-lg text-[color:var(--c-faint)] hover:text-[color:var(--c-rtx)] hover:bg-[color:var(--c-rbg)] sm:opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"><Trash2 className="w-4 h-4" /></button>
            </li>
          ))}
        </ul>
      )}
      <p className="px-5 py-3 border-t border-[color:var(--c-line)] text-[11px] text-[color:var(--c-muted)] flex items-start gap-1.5">
        <TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-px text-[#D20A2E]" /> Ejecutar usa el modelo, el umbral y la base de conocimiento actuales del agente, y gasta tokens que cuentan en tu plan de gasto. No crea conversaciones ni tickets.
      </p>

      {editing && (
        <CaseModal docs={docs} initial={editing === 'nuevo' ? undefined : editing} onClose={() => setEditing(null)}
          onSave={async (p) => { if (editing === 'nuevo') await api.createTestCase(slug, setId, p); else await api.updateTestCase(slug, editing.id, p); setEditing(null); refrescar(); }} />
      )}
      {comparing && <CompareModal models={models} agentModelId={agentModelId} caseCount={set.cases.length} onClose={() => setComparing(false)} onStart={async (ids, judge) => {
        try { const g = await api.compareModels(slug, setId, { modelIds: ids, judgeModelId: judge }); setComparing(false); onOpenComparison(g.groupId); }
        catch (e) { onToast('warning', 'No se pudo comparar', e instanceof Error ? e.message : undefined); }
      }} />}
      {configuring && <RunModal models={models} agentModelId={agentModelId} busy={running} caseCount={set.cases.length} onClose={() => setConfiguring(false)} onRun={ejecutar} />}
      {renaming && <SetModal initial={set} onClose={() => setRenaming(false)} onSave={async (p) => { await api.updateTestSet(slug, setId, p); setRenaming(false); refrescar(); }} />}
    </section>
  );
};

// ---------------------------------------------------------------------------------------------- modales
const ErrorLine: React.FC<{ msg: string | null }> = ({ msg }) => msg ? <p role="alert" className="text-xs text-[color:var(--c-rtx2)] bg-[color:var(--c-rbg)] border border-[color:var(--c-rline)] rounded-xl px-3 py-2">{msg}</p> : null;

const SetModal: React.FC<{ initial?: { name: string; description?: string }; onClose: () => void; onSave: (p: { name: string; description?: string }) => Promise<void> }> = ({ initial, onClose, onSave }) => {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const guardar = async () => { setBusy(true); setErr(null); try { await onSave({ name: name.trim(), description: description.trim() || undefined }); } catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo guardar'); setBusy(false); } };
  return (
    <Modal title={initial ? 'Editar conjunto' : 'Nuevo conjunto de prueba'} subtitle="Un golden set agrupa preguntas de referencia sobre un tema." icon={<ClipboardList className="w-5 h-5" />} onClose={onClose}
      footer={<><button onClick={onClose} className={btnGhost}>Cancelar</button><button onClick={guardar} disabled={busy || !name.trim()} className={btnPrimary} data-testid="test-set-save">{busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Guardar</button></>}>
      <div className="space-y-4">
        <label className="block text-xs font-semibold text-[color:var(--c-ink)]">Nombre
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus placeholder="Ej.: Reembolsos y pagos" data-testid="test-set-name" className={`${input} mt-1.5`} /></label>
        <label className="block text-xs font-semibold text-[color:var(--c-ink)]">Descripción <span className="font-normal text-[color:var(--c-muted)]">(opcional)</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={1000} placeholder="Qué cubre y cuándo conviene correrlo" className={`${input} mt-1.5 resize-none`} /></label>
        <ErrorLine msg={err} />
      </div>
    </Modal>
  );
};

const CaseModal: React.FC<{ docs: DocumentItem[]; initial?: TestCase; onClose: () => void; onSave: (p: api.TestCasePayload) => Promise<void> }> = ({ docs, initial, onClose, onSave }) => {
  const [question, setQuestion] = useState(initial?.question ?? '');
  const [escalate, setEscalate] = useState(initial?.shouldEscalate ?? false);
  const [answer, setAnswer] = useState(initial?.expectedAnswer ?? '');
  const [doc, setDoc] = useState(initial?.expectedDocument ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const guardar = async () => {
    setBusy(true); setErr(null);
    try { await onSave({ question: question.trim(), shouldEscalate: escalate, expectedAnswer: escalate ? null : answer.trim() || null, expectedDocument: escalate ? null : doc || null }); }
    catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo guardar'); setBusy(false); }
  };
  return (
    <Modal title={initial ? 'Editar caso' : 'Nuevo caso'} subtitle="Una pregunta y lo que el agente debería responder." icon={<FlaskConical className="w-5 h-5" />} onClose={onClose} width="max-w-xl"
      footer={<><button onClick={onClose} className={btnGhost}>Cancelar</button><button onClick={guardar} disabled={busy || question.trim().length < 3} className={btnPrimary} data-testid="test-case-save">{busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Guardar caso</button></>}>
      <div className="space-y-4">
        <label className="block text-xs font-semibold text-[color:var(--c-ink)]">Pregunta del cliente
          <textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={2} maxLength={1000} autoFocus placeholder="Ej.: ¿Cuánto tardan los reembolsos?" data-testid="test-case-question" className={`${input} mt-1.5 resize-none`} /></label>

        <button type="button" role="switch" aria-checked={escalate} onClick={() => setEscalate(!escalate)} data-testid="test-case-escalate"
          className={`w-full flex items-start gap-3 p-3.5 rounded-xl border text-left transition-all ${escalate ? 'border-[#D20A2E] bg-[color:var(--c-ch50)]' : 'border-[color:var(--c-line)] bg-white hover:border-[color:var(--c-ch350)]'}`}>
          <span className={`mt-0.5 w-9 h-5 rounded-full p-0.5 shrink-0 transition-colors ${escalate ? 'bg-[#D20A2E]' : 'bg-[color:var(--c-line2)]'}`}><span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform ${escalate ? 'translate-x-4' : ''}`} /></span>
          <span><span className="block text-xs font-semibold text-[color:var(--c-ink)]">Debe derivar a un humano</span><span className="block text-[11px] text-[color:var(--c-muted)] mt-0.5">Actívalo para preguntas que la documentación no cubre: el agente no debe inventar una respuesta.</span></span>
        </button>

        {!escalate && (
          <>
            <label className="block text-xs font-semibold text-[color:var(--c-ink)]">Respuesta esperada <span className="font-normal text-[color:var(--c-muted)]">(opcional)</span>
              <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={3} maxLength={2000} placeholder="Los reembolsos tardan cinco días hábiles." data-testid="test-case-answer" className={`${input} mt-1.5 resize-none`} />
              <span className="block mt-1 text-[11px] font-normal text-[color:var(--c-muted)]">Un juez de IA compara la respuesta del agente con esto, aunque use otras palabras.</span></label>
            <div className="text-xs font-semibold text-[color:var(--c-ink)]">Documento que debería citar <span className="font-normal text-[color:var(--c-muted)]">(opcional)</span>
              <div className="mt-1.5"><Select value={doc} onChange={setDoc} ariaLabel="Documento esperado" placeholder="Cualquiera"
                options={[{ value: '', label: 'Cualquiera (no revisar la fuente)' }, ...docs.map((d) => ({ value: d.name, label: d.name }))]} /></div></div>
          </>
        )}
        <ErrorLine msg={err} />
      </div>
    </Modal>
  );
};

const GenerateModal: React.FC<{
  docs: DocumentItem[]; models: AiModelOption[]; onClose: () => void;
  onGenerate: (p: { name: string; description?: string; count: number; negatives: number; documentIds?: string[]; modelId?: string }) => Promise<void>;
}> = ({ docs, models, onClose, onGenerate }) => {
  const [name, setName] = useState('Casos generados con IA');
  const [modelId, setModelId] = useState(JUEZ_DEFECTO);
  const [count, setCount] = useState('10');
  const [negatives, setNegatives] = useState('2');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toggle = (id: string) => setChosen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const generar = async () => {
    setBusy(true); setErr(null);
    try { await onGenerate({ name: name.trim(), count: Number(count), negatives: Number(negatives), documentIds: chosen.size ? [...chosen] : undefined, modelId }); }
    catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo generar'); setBusy(false); }
  };
  const num = (arr: number[]) => arr.map((n) => ({ value: String(n), label: String(n) }));
  return (
    <Modal title="Generar casos con IA" subtitle="La IA lee tu documentación y propone preguntas con su respuesta esperada. Revísalas antes de usarlas." icon={<Wand2 className="w-5 h-5" />} onClose={busy ? () => undefined : onClose} width="max-w-xl"
      footer={<><button onClick={onClose} disabled={busy} className={btnGhost}>Cancelar</button><button onClick={generar} disabled={busy || !name.trim() || docs.length === 0} className={btnPrimary} data-testid="test-generate-submit">{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}{busy ? 'Generando…' : 'Generar casos'}</button></>}>
      <div className="space-y-4">
        {docs.length === 0 && <ErrorLine msg="No hay documentación procesada: sube documentos antes de generar casos." />}
        <label className="block text-xs font-semibold text-[color:var(--c-ink)]">Nombre del conjunto
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className={`${input} mt-1.5`} /></label>
        <div className="text-xs font-semibold text-[color:var(--c-ink)]">Modelo que genera los casos
          <div className="mt-1.5"><Select value={modelId} onChange={setModelId} ariaLabel="Modelo generador" options={modelOptions(models)} testId="test-generator-model" /></div>
          <span className="block mt-1 text-[11px] font-normal text-[color:var(--c-muted)]">Lee tu documentación y redacta las preguntas y respuestas esperadas. Un modelo más capaz propone casos más difíciles y precisos.</span></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="text-xs font-semibold text-[color:var(--c-ink)]">Preguntas con respuesta<div className="mt-1.5"><Select value={count} onChange={setCount} ariaLabel="Cantidad de casos" options={num([5, 10, 15, 20, 30])} /></div></div>
          <div className="text-xs font-semibold text-[color:var(--c-ink)]">Fuera de la documentación<div className="mt-1.5"><Select value={negatives} onChange={setNegatives} ariaLabel="Casos que deben derivar" options={num([0, 1, 2, 3, 5, 10])} /></div></div>
        </div>
        <fieldset>
          <legend className="text-xs font-semibold text-[color:var(--c-ink)] mb-1.5">Documentos <span className="font-normal text-[color:var(--c-muted)]">({chosen.size === 0 ? 'toda la base de conocimiento' : `${chosen.size} elegidos`})</span></legend>
          <ul className="max-h-44 overflow-y-auto rounded-xl border border-[color:var(--c-line)] divide-y divide-[color:var(--c-line)]">
            {docs.map((d) => (
              <li key={d.id}><label className="flex items-center gap-2.5 px-3 py-2 text-xs cursor-pointer hover:bg-[color:var(--c-canvas)]">
                <input type="checkbox" checked={chosen.has(d.id)} onChange={() => toggle(d.id)} className="accent-[#D20A2E]" />
                <span className="truncate flex-1 text-[color:var(--c-ink)]">{d.name}</span><span className="text-[11px] text-[color:var(--c-muted)] tabular-nums">{d.chunkCount} frag.</span></label></li>
            ))}
          </ul>
        </fieldset>
        <p className="text-[11px] text-[color:var(--c-muted)] flex items-start gap-1.5"><TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-px text-[#D20A2E]" /> Usa AWS Bedrock: gasta tokens que cuentan en tu plan de gasto. Los casos quedan marcados «IA» y puedes editarlos o borrarlos.</p>
        <ErrorLine msg={err} />
      </div>
    </Modal>
  );
};

/** Configura la corrida antes de lanzarla: qué agente se prueba (el actual) y qué LLM actúa como juez. */
const RunModal: React.FC<{ models: AiModelOption[]; agentModelId?: string; busy: boolean; caseCount: number; onClose: () => void; onRun: (judgeModelId: string) => void }> = ({ models, agentModelId, busy, caseCount, onClose, onRun }) => {
  const [judge, setJudge] = useState(() => { try { return localStorage.getItem('alloxentric-judge') || JUEZ_DEFECTO; } catch { return JUEZ_DEFECTO; } });
  const agent = models.find((m) => m.id === agentModelId);
  const juez = models.find((m) => m.id === judge);
  const mismo = !!agentModelId && agentModelId === judge;
  const iniciar = () => { try { localStorage.setItem('alloxentric-judge', judge); } catch { /* sin almacenamiento */ } onRun(judge); };
  return (
    <Modal title="Ejecutar prueba" subtitle={`${caseCount} caso${caseCount === 1 ? '' : 's'} contra el agente actual de la empresa.`} icon={<Play className="w-5 h-5" />} onClose={busy ? () => undefined : onClose} width="max-w-xl"
      footer={<><button onClick={onClose} disabled={busy} className={btnGhost}>Cancelar</button><button onClick={iniciar} disabled={busy} className={btnPrimary} data-testid="test-run-start">{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}{busy ? 'Iniciando…' : 'Iniciar prueba'}</button></>}>
      <div className="space-y-5">
        <div>
          <p className="text-xs font-semibold text-[color:var(--c-ink)] mb-1.5">Agente que se prueba</p>
          <div className="flex items-center gap-2.5 rounded-xl border border-[color:var(--c-line)] bg-[color:var(--c-canvas)] px-3.5 py-2.5 text-xs">
            {agent && <ProviderLogo provider={agent.providerId} size={18} />}
            <span className="font-semibold text-[color:var(--c-ink)]">{agent?.name ?? agentModelId ?? 'Modelo actual'}</span>
            <span className="text-[color:var(--c-muted)]">· el modelo configurado en Empresas y agentes</span>
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold text-[color:var(--c-ink)] mb-1.5 flex items-center gap-1.5"><Scale className="w-3.5 h-3.5 text-[#D20A2E]" /> Modelo juez (LLM as a Judge)</p>
          <Select value={judge} onChange={setJudge} ariaLabel="Modelo juez" options={modelOptions(models)} testId="test-judge-model" />
          <p className="mt-1.5 text-[11px] text-[color:var(--c-muted)]">El juez compara cada respuesta del agente con la esperada y la puntúa de 0 a 1 (con una frase de motivo), aunque use otras palabras. Un caso se aprueba con puntaje de al menos 0,7.</p>
          {mismo && (
            <p role="status" data-testid="test-judge-same" className="mt-2 flex items-start gap-1.5 text-[11px] text-[color:var(--c-atx2)] bg-[color:var(--c-abg)] border border-[color:var(--c-aline)] rounded-xl px-3 py-2">
              <TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-px" /> El mismo modelo responde y se evalúa a sí mismo ({juez?.name}): tiende a puntuarse mejor. Para una medición más justa elige un juez distinto.
            </p>
          )}
        </div>
        <p className="text-[11px] text-[color:var(--c-muted)] flex items-start gap-1.5"><TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-px text-[#D20A2E]" /> Gasta tokens del agente y del juez, que cuentan en tu plan de gasto. No crea conversaciones ni tickets.</p>
      </div>
    </Modal>
  );
};

/** Elige qué modelos de agente comparar con el mismo golden set (2 a 5) y el juez que los evaluará. */
const CompareModal: React.FC<{ models: AiModelOption[]; agentModelId?: string; caseCount: number; onClose: () => void; onStart: (ids: string[], judge: string) => Promise<void> }> = ({ models, agentModelId, caseCount, onClose, onStart }) => {
  const [chosen, setChosen] = useState<Set<string>>(new Set([agentModelId ?? JUEZ_DEFECTO, ...models.filter((m) => m.id !== (agentModelId ?? JUEZ_DEFECTO)).slice(0, 1).map((m) => m.id)]));
  const [judge, setJudge] = useState(JUEZ_DEFECTO);
  const [busy, setBusy] = useState(false);
  const toggle = (id: string) => setChosen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else if (n.size < 5) n.add(id); return n; });
  const juezEnLista = chosen.has(judge);
  return (
    <Modal title="Comparar modelos" subtitle={`El mismo golden set (${caseCount} casos) con cada modelo, lado a lado.`} icon={<GitCompare className="w-5 h-5" />} onClose={busy ? () => undefined : onClose} width="max-w-xl"
      footer={<><button onClick={onClose} disabled={busy} className={btnGhost}>Cancelar</button><button onClick={async () => { setBusy(true); await onStart([...chosen], judge); setBusy(false); }} disabled={busy || chosen.size < 2} className={btnPrimary} data-testid="compare-start">{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}Comparar {chosen.size} modelos</button></>}>
      <div className="space-y-5">
        <fieldset>
          <legend className="text-xs font-semibold text-[color:var(--c-ink)] mb-1.5">Modelos a comparar <span className="font-normal text-[color:var(--c-muted)]">(2 a 5)</span></legend>
          <ul className="rounded-xl border border-[color:var(--c-line)] divide-y divide-[color:var(--c-line)] overflow-hidden">
            {models.map((m) => (
              <li key={m.id}><label className="flex items-center gap-3 px-3.5 py-2.5 text-xs cursor-pointer hover:bg-[color:var(--c-canvas)]">
                <input type="checkbox" checked={chosen.has(m.id)} onChange={() => toggle(m.id)} className="accent-[#D20A2E]" data-testid={`compare-model-${m.id}`} />
                <ProviderLogo provider={m.providerId} size={18} /><span className="font-semibold text-[color:var(--c-ink)] flex-1">{m.name}</span>
                {m.id === agentModelId && <span className="text-[10px] font-bold text-[#D20A2E] bg-[color:var(--c-ch100)] rounded-full px-1.5 py-px">Actual</span>}<span className="text-[11px] text-[color:var(--c-muted)]">{m.provider}</span></label></li>
            ))}
          </ul>
        </fieldset>
        <div>
          <p className="text-xs font-semibold text-[color:var(--c-ink)] mb-1.5 flex items-center gap-1.5"><Scale className="w-3.5 h-3.5 text-[#D20A2E]" /> Modelo juez (el mismo para todos)</p>
          <Select value={judge} onChange={setJudge} ariaLabel="Modelo juez" options={modelOptions(models)} testId="compare-judge" />
          {juezEnLista && <p className="mt-2 flex items-start gap-1.5 text-[11px] text-[color:var(--c-atx2)] bg-[color:var(--c-abg)] border border-[color:var(--c-aline)] rounded-xl px-3 py-2"><TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-px" /> {models.find((m) => m.id === judge)?.name} es candidato y también juez: tiende a puntuarse mejor a sí mismo.</p>}
        </div>
        <p className="text-[11px] text-[color:var(--c-muted)] flex items-start gap-1.5"><TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-px text-[#D20A2E]" /> Corre {chosen.size} veces el golden set y gasta tokens de cada modelo y del juez, que cuentan en tu plan de gasto. No cambia el modelo configurado del agente.</p>
      </div>
    </Modal>
  );
};
