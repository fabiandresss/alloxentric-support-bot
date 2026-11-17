import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Boxes, CheckCircle2, ChevronDown, Clock, Database, FileText, History, Layers, LibraryBig, Loader2, RefreshCw, RotateCcw, Search, ShieldCheck, Type, Upload } from 'lucide-react';
import * as api from '../api/client';
import { AuthUser, Company, DocVersion, KbChunk, KbDocument, KbQuality, KbSummary } from '../types';
import { fmtDate, fmtInt, fmtTokens } from '../lib/format';

const fmtBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
import { Select } from './Select';
import { Modal } from './Modal';
import { UnansweredPanel } from './UnansweredPanel';
import { FaqProposals } from './FaqProposals';
import { PipelinePanel } from './PipelinePanel';

interface KnowledgeBaseViewProps {
  me: AuthUser;
  companies: Company[];
  onToast: (type: 'success' | 'warning' | 'info', title: string, description?: string) => void;
  /** Abrir un fragmento citado por una respuesta (desde un ticket o una conversación). */
  focus?: { companyId: string; documentId: string; fragmentId?: string } | null;
  onFocusConsumed?: () => void;
}

const card = 'bg-white border border-[color:var(--c-line)] rounded-2xl card-glow';
const PAGE = 20;

const ESTADO: Record<string, { label: string; cls: string; icon: React.ElementType }> = {
  procesado: { label: 'Procesado', cls: 'bg-[color:var(--c-gbg2)] text-[color:var(--c-gtx)]', icon: CheckCircle2 },
  procesando: { label: 'Procesando', cls: 'bg-[color:var(--c-abg2)] text-[color:var(--c-atx2)]', icon: Loader2 },
  error: { label: 'Sin texto', cls: 'bg-[color:var(--c-rbg2)] text-[color:var(--c-rtx2)]', icon: AlertTriangle },
};

const Stat: React.FC<{ icon: React.ElementType; label: string; value: string; hint: string; delay?: number }> = ({ icon: Icon, label, value, hint, delay = 0 }) => (
  <div style={{ animationDelay: `${delay}ms` }} className={`${card} animate-fade-up p-4`}>
    <div className="flex items-center justify-between">
      <span className="text-xs font-medium text-[color:var(--c-muted)]">{label}</span>
      <span className="w-8 h-8 rounded-xl bg-[color:var(--c-ch100)] text-[#D20A2E] flex items-center justify-center"><Icon className="w-4 h-4" /></span>
    </div>
    <p className="mt-3 text-2xl font-bold tracking-tight tabular-nums text-[color:var(--c-ink)]">{value}</p>
    <p className="mt-1 text-[11px] text-[color:var(--c-muted)] truncate" title={hint}>{hint}</p>
  </div>
);

/** Resalta en amarillo lo que coincide con la búsqueda. */
const Highlight: React.FC<{ text: string; q: string }> = ({ text, q }) => {
  const term = q.trim();
  if (!term) return <>{text}</>;
  const partes = text.split(new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return <>{partes.map((p, i) => (p.toLowerCase() === term.toLowerCase() ? <mark key={i} className="bg-[#FDE68A] text-[#1F1B1A] rounded px-0.5">{p}</mark> : <React.Fragment key={i}>{p}</React.Fragment>))}</>;
};

export const KnowledgeBaseView: React.FC<KnowledgeBaseViewProps> = ({ me, companies, onToast, focus, onFocusConsumed }) => {
  const isSuper = me.role === 'superadmin';
  const [slug, setSlug] = useState<string>(isSuper ? companies[0]?.id ?? '' : me.companyId ?? '');
  const [summary, setSummary] = useState<KbSummary | null>(null);
  const [docs, setDocs] = useState<KbDocument[]>([]);
  const [docQ, setDocQ] = useState('');
  const [estado, setEstado] = useState('');
  const [docId, setDocId] = useState('');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [chunks, setChunks] = useState<KbChunk[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingChunks, setLoadingChunks] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const explorer = useRef<HTMLElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const [quality, setQuality] = useState<KbQuality | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [replacingId, setReplacingId] = useState<string | null>(null);
  const [versionsDoc, setVersionsDoc] = useState<KbDocument | null>(null);

  useEffect(() => { const t = setTimeout(() => setDebounced(q), 300); return () => clearTimeout(t); }, [q]);
  const [hl, setHl] = useState<string | null>(null); // fragmento a resaltar (viene de una fuente citada)
  const focusRef = useRef<typeof focus>(null);
  useEffect(() => { setDocId(focusRef.current?.documentId ?? ''); setQ(''); setDocQ(''); setEstado(''); }, [slug]);
  useEffect(() => {
    if (!focus) return;
    focusRef.current = focus;
    setHl(focus.fragmentId ?? null);
    setQ('');
    if (isSuper && focus.companyId !== slug) setSlug(focus.companyId); else setDocId(focus.documentId);
    onFocusConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);
  // con el fragmento ya en pantalla: se desplaza hasta él; si aún no se cargó, se piden más
  useEffect(() => {
    if (!hl || loadingChunks) return;
    if (chunks.some((c) => c.id === hl)) {
      setTimeout(() => document.querySelector(`[data-fragment-id="${hl}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
    } else if (chunks.length > 0 && chunks.length < total) {
      loadChunks(true, chunks.length);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hl, chunks, loadingChunks]);

  const loadBase = useCallback(async (silent = false) => {
    if (!slug) return;
    if (!silent) setLoading(true);
    try {
      const [s, d, q] = await Promise.all([api.getKbSummary(slug), api.getKbDocuments(slug), api.getKbQuality(slug)]);
      setSummary(s);
      setDocs(d);
      setQuality(q);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar la base de conocimiento');
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { loadBase(); }, [loadBase]);
  // mientras haya documentos procesándose, se refresca solo
  useEffect(() => {
    if (!summary?.processing) return;
    const t = setInterval(() => loadBase(true), 4000);
    return () => clearInterval(t);
  }, [summary?.processing, loadBase]);

  const loadChunks = useCallback(async (append: boolean, offset: number) => {
    if (!slug) return;
    setLoadingChunks(true);
    try {
      const r = await api.getKbChunks(slug, { q: debounced, documentId: docId || undefined, limit: PAGE, offset });
      setTotal(r.total);
      setChunks((prev) => (append ? [...prev, ...r.items] : r.items));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar los fragmentos');
    } finally {
      setLoadingChunks(false);
    }
  }, [slug, debounced, docId]);

  useEffect(() => { loadChunks(false, 0); }, [loadChunks, summary?.fragments]);

  const visibleDocs = useMemo(() => docs.filter((d) => (!docQ.trim() || d.name.toLowerCase().includes(docQ.trim().toLowerCase())) && (!estado || d.status === estado)), [docs, docQ, estado]);
  const company = companies.find((c) => c.id === slug);
  const selectedDoc = docs.find((d) => d.id === docId);
  const words = summary ? Math.round(summary.characters / 6) : 0;

  const subir = async (file?: File | null) => {
    if (!file) return;
    setBusy('subir');
    try { await api.uploadDocument(slug, file); onToast('success', 'Documento subido', `${file.name} se está procesando. Si hay pruebas automáticas, correrán al terminar.`); await loadBase(true); }
    catch (e) { onToast('warning', 'No se pudo subir', e instanceof Error ? e.message : undefined); }
    finally { setBusy(null); if (uploadRef.current) uploadRef.current.value = ''; }
  };
  const reemplazar = async (file?: File | null) => {
    const id = replacingId;
    if (!file || !id) return;
    setBusy(id);
    try { await api.replaceDocument(id, file); onToast('success', 'Documento reemplazado', 'La versión anterior quedó en el historial. Se está reprocesando.'); await loadBase(true); }
    catch (e) { onToast('warning', 'No se pudo reemplazar', e instanceof Error ? e.message : undefined); }
    finally { setBusy(null); setReplacingId(null); if (replaceRef.current) replaceRef.current.value = ''; }
  };

  const verFragmentos = (id: string) => {
    setDocId(id === docId ? '' : id);
    setTimeout(() => explorer.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  return (
    <div className="space-y-6" data-testid="kb-view">
      {versionsDoc && <VersionsModal doc={versionsDoc} onClose={() => setVersionsDoc(null)} onRestored={() => { setVersionsDoc(null); onToast('success', 'Versión restaurada', 'El documento se está reprocesando con esa versión.'); loadBase(true); }} onError={(m) => onToast('warning', 'No se pudo restaurar', m)} />}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[color:var(--c-ink)]">Base de conocimiento</h1>
          <p className="text-xs text-[color:var(--c-muted)] mt-1">
            Toda la documentación ingestada{company ? ` de ${company.name}` : ''} y los fragmentos que el agente usa para responder. Sube, reemplaza (con historial de versiones) o revisa la salud de tu documentación.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isSuper && <Select value={slug} onChange={setSlug} ariaLabel="Empresa" size="sm" className="w-56" options={companies.map((c) => ({ value: c.id, label: c.name }))} />}
          <button onClick={() => uploadRef.current?.click()} disabled={busy === 'subir'} data-testid="kb-upload" className="whitespace-nowrap px-4 py-2.5 rounded-xl bg-[#D20A2E] hover:bg-[#B00825] text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50">
            {busy === 'subir' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Subir documento
          </button>
          <input ref={uploadRef} type="file" accept=".pdf,.docx,.txt,.faq,.csv,.md,.markdown" className="hidden" data-testid="kb-upload-input" onChange={(e) => subir(e.target.files?.[0])} />
          <input ref={replaceRef} type="file" accept=".pdf,.docx,.txt,.faq,.csv,.md,.markdown" className="hidden" data-testid="kb-replace-input" onChange={(e) => reemplazar(e.target.files?.[0])} />
        </div>
      </div>

      {error && <div className="p-4 rounded-xl border border-[color:var(--c-rline)] bg-[color:var(--c-rbg)] text-xs text-[color:var(--c-rtx2)]">{error}</div>}
      {loading && !summary && <div className="py-20 flex justify-center text-[color:var(--c-muted)]"><Loader2 className="w-5 h-5 animate-spin" /></div>}

      {summary && (
        <>
          {summary.processing > 0 && (
            <div role="status" className="flex items-center gap-3 p-4 rounded-2xl border border-[color:var(--c-aline)] bg-[color:var(--c-abg)] text-[color:var(--c-atx2)] text-xs">
              <Loader2 className="w-4 h-4 animate-spin shrink-0" /> {summary.processing} documento{summary.processing > 1 ? 's' : ''} procesándose: se están fragmentando y vectorizando. Esta vista se actualiza sola.
            </div>
          )}
          {summary.errors > 0 && (
            <div role="alert" className="flex items-start gap-3 p-4 rounded-2xl border border-[color:var(--c-rline)] bg-[color:var(--c-rbg)] text-[color:var(--c-rtx2)] text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <p><span className="font-semibold">{summary.errors} documento{summary.errors > 1 ? 's' : ''} sin texto utilizable.</span> No se extrajo contenido (¿PDF escaneado o archivo vacío?), por eso el agente no los puede usar.</p>
            </div>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
            <Stat icon={FileText} label="Documentos" value={fmtInt(summary.documents)} hint={`${summary.processed} procesados`} />
            <Stat icon={Layers} label="Fragmentos" value={fmtInt(summary.fragments)} hint="Trozos que el agente puede citar" delay={50} />
            <Stat icon={Type} label="Contenido" value={`${fmtTokens(words)} palabras`} hint={`${fmtInt(summary.characters)} caracteres`} delay={100} />
            <Stat icon={Database} label="Vectores" value={`${fmtInt(summary.embeddedFragments)}/${fmtInt(summary.fragments)}`} hint={summary.models.length ? summary.models.join(' · ') : 'Sin vectores aún'} delay={150} />
            <Stat icon={Clock} label="Última subida" value={summary.lastUpdated ? fmtDate(summary.lastUpdated) : '—'} hint={summary.byType.map((t) => `${t.count} ${t.type.toUpperCase()}`).join(' · ') || 'Sin documentos'} delay={200} />
          </div>

          <PipelinePanel slug={slug} onToast={onToast} onReprocessed={() => loadBase(true)} />

          {/* Salud de la base */}
          {quality && (
            <section className={`${card} overflow-hidden animate-fade-up`} aria-label="Salud de la base de conocimiento" data-testid="kb-quality">
              <div className="p-5 flex items-start gap-5 flex-wrap">
                <div className="flex items-center gap-4">
                  <div className="relative w-16 h-16 shrink-0">
                    <svg viewBox="0 0 36 36" className="w-16 h-16 -rotate-90"><circle cx="18" cy="18" r="15.5" fill="none" strokeWidth="3.5" className="stroke-[color:var(--c-soft)]" />
                      <circle cx="18" cy="18" r="15.5" fill="none" strokeWidth="3.5" strokeLinecap="round" strokeDasharray={`${(quality.score / 100) * 97.4} 97.4`} className={`transition-all duration-700 ${quality.score >= 90 ? 'stroke-[#22C55E]' : quality.score >= 70 ? 'stroke-[#F59E0B]' : 'stroke-[#EF4444]'}`} /></svg>
                    <span data-testid="kb-score" className="absolute inset-0 flex items-center justify-center text-lg font-bold tabular-nums text-[color:var(--c-ink)]">{quality.score}</span>
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-[color:var(--c-ink)] flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-[#D20A2E]" /> Salud de la base</h2>
                    <p className="text-[11px] text-[color:var(--c-muted)] mt-0.5">{quality.score >= 90 ? 'Excelente' : quality.score >= 70 ? 'Buena' : quality.score >= 50 ? 'Mejorable' : 'Crítica'} · {quality.documentsChecked} documentos y {fmtInt(quality.fragmentsChecked)} fragmentos revisados</p>
                  </div>
                </div>
                {quality.issues.length === 0 && <p className="text-xs font-semibold text-[color:var(--c-gtx)] flex items-center gap-1.5 self-center"><CheckCircle2 className="w-4 h-4" /> No se detectaron problemas.</p>}
              </div>
              {quality.issues.length > 0 && (
                <ul className="divide-y divide-[color:var(--c-line)] border-t border-[color:var(--c-line)]" data-testid="kb-issues">
                  {quality.issues.map((i) => (
                    <li key={i.code} data-testid={`kb-issue-${i.code}`} className="px-5 py-3.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${i.severity === 'alta' ? 'bg-[color:var(--c-rbg2)] text-[color:var(--c-rtx2)]' : i.severity === 'media' ? 'bg-[color:var(--c-abg2)] text-[color:var(--c-atx2)]' : 'bg-[color:var(--c-soft)] text-[color:var(--c-muted)]'}`}>{i.severity}</span>
                        <span className="text-xs font-semibold text-[color:var(--c-ink)]">{i.title}</span><span className="text-[11px] text-[color:var(--c-muted)] tabular-nums">({fmtInt(i.count)})</span>
                      </div>
                      <p className="mt-1 text-[11px] text-[color:var(--c-muted)] leading-relaxed">{i.detail}</p>
                      <div className="mt-1.5 flex gap-1.5 flex-wrap">{i.documents.slice(0, 8).map((n) => <button key={n} onClick={() => setDocQ(n)} className="px-2 py-0.5 rounded-md bg-[color:var(--c-soft)] text-[11px] font-medium text-[color:var(--c-ink)] hover:text-[#D20A2E] max-w-[16rem] truncate" title={`Ver ${n} en la tabla`}>{n}</button>)}{i.documents.length > 8 && <span className="text-[11px] text-[color:var(--c-muted)]">+{i.documents.length - 8} más</span>}</div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <UnansweredPanel slug={slug} onSearchDoc={(name) => setDocQ(name)} />
          <FaqProposals slug={slug} onAdded={() => loadBase(true)} onToast={onToast} />

          {/* Documentos */}
          <section className={`${card} overflow-hidden animate-fade-up`} aria-label="Documentos ingestados">
            <div className="px-5 py-4 border-b border-[color:var(--c-line)] flex flex-col md:flex-row md:items-center justify-between gap-3">
              <h2 className="text-sm font-bold text-[color:var(--c-ink)] flex items-center gap-2"><LibraryBig className="w-4 h-4 text-[#D20A2E]" /> Documentos ingestados <span className="text-[11px] font-medium text-[color:var(--c-muted)]">({visibleDocs.length} de {docs.length})</span></h2>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-[color:var(--c-faint)] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input value={docQ} onChange={(e) => setDocQ(e.target.value)} placeholder="Buscar documento…" aria-label="Buscar documento" data-testid="kb-doc-search"
                    className="bg-white border border-[color:var(--c-line)] rounded-xl pl-8 pr-3 py-2 text-xs w-52" />
                </div>
                <Select value={estado} onChange={setEstado} ariaLabel="Estado" size="sm" className="w-40"
                  options={[{ value: '', label: 'Todos los estados' }, { value: 'procesado', label: 'Procesados' }, { value: 'procesando', label: 'Procesando' }, { value: 'error', label: 'Sin texto' }]} />
              </div>
            </div>
            {visibleDocs.length === 0 ? (
              <p className="py-12 text-center text-xs text-[color:var(--c-muted)]">{docs.length === 0 ? 'Aún no hay documentos ingestados. Súbelos desde Empresas y agentes → Configurar agente.' : 'Ningún documento coincide con el filtro.'}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-xs" data-testid="kb-docs">
                  <thead className="bg-[color:var(--c-canvas)] text-[color:var(--c-muted)] text-left">
                    <tr>
                      <th className="px-5 py-3 font-semibold">Documento</th>
                      <th className="px-5 py-3 font-semibold">Tipo</th>
                      <th className="px-5 py-3 font-semibold">Tamaño</th>
                      <th className="px-5 py-3 font-semibold">Subido</th>
                      <th className="px-5 py-3 font-semibold text-right">Fragmentos</th>
                      <th className="px-5 py-3 font-semibold">Estado</th>
                      <th className="px-5 py-3 font-semibold text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleDocs.map((d) => {
                      const st = ESTADO[d.status] ?? ESTADO.procesado;
                      const Icon = st.icon;
                      return (
                        <tr
                          key={d.id} onClick={() => d.fragments > 0 && verFragmentos(d.id)} data-testid={`kb-doc-${d.id}`}
                          className={`border-t border-[color:var(--c-line)] transition-colors ${d.fragments > 0 ? 'cursor-pointer hover:bg-[color:var(--c-canvas)]' : ''} ${docId === d.id ? 'bg-[color:var(--c-ch50)]' : ''}`}
                        >
                          <td className="px-5 py-3">
                            <span className="flex items-center gap-2.5 min-w-0">
                              <span className="w-8 h-8 rounded-lg bg-[color:var(--c-ch100)] text-[#D20A2E] flex items-center justify-center shrink-0"><FileText className="w-4 h-4" /></span>
                              <span className="font-semibold text-[color:var(--c-ink)] truncate max-w-[22rem]" title={d.name}>{d.name}</span>
                              {d.warning && <span data-testid={`kb-warning-${d.id}`} title={d.warning} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[color:var(--c-rbg2)] text-[color:var(--c-rtx2)] text-[10px] font-bold shrink-0"><AlertTriangle className="w-3 h-3" /> Revisar</span>}
                            </span>
                          </td>
                          <td className="px-5 py-3 uppercase text-[color:var(--c-muted)] font-medium">{d.type}</td>
                          <td className="px-5 py-3 text-[color:var(--c-muted)] tabular-nums">{fmtBytes(d.sizeBytes)}</td>
                          <td className="px-5 py-3 text-[color:var(--c-muted)] whitespace-nowrap">{fmtDate(d.uploadedAt)}</td>
                          <td className="px-5 py-3 text-right tabular-nums">{d.fragments > 0 ? <span className="font-semibold text-[color:var(--c-ink)]">{fmtInt(d.fragments)}</span> : <span className="text-[color:var(--c-faint)]" title="El documento figura como cargado, pero no tiene fragmentos: el agente no puede usarlo">sin contenido</span>}</td>
                          <td className="px-5 py-3"><span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${st.cls}`}><Icon className={`w-3 h-3 ${d.status === 'procesando' ? 'animate-spin' : ''}`} />{st.label}</span></td>
                          <td className="px-5 py-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                            <button onClick={() => { setReplacingId(d.id); replaceRef.current?.click(); }} disabled={busy === d.id || d.status === 'procesando'} data-testid={`kb-replace-${d.id}`} title="Subir una versión nueva (la anterior queda en el historial)"
                              className="p-1.5 rounded-lg text-[color:var(--c-muted)] hover:text-[#D20A2E] hover:bg-[color:var(--c-ch100)] disabled:opacity-40">{busy === d.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}</button>
                            <button onClick={() => setVersionsDoc(d)} data-testid={`kb-versions-${d.id}`} title="Historial de versiones" className="p-1.5 rounded-lg text-[color:var(--c-muted)] hover:text-[#D20A2E] hover:bg-[color:var(--c-ch100)]"><History className="w-4 h-4" /></button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Explorador de fragmentos */}
          <section ref={explorer} className={`${card} overflow-hidden animate-fade-up scroll-mt-20`} aria-label="Explorador de fragmentos">
            <div className="px-5 py-4 border-b border-[color:var(--c-line)] space-y-3">
              <div>
                <h2 className="text-sm font-bold text-[color:var(--c-ink)] flex items-center gap-2"><Boxes className="w-4 h-4 text-[#D20A2E]" /> Explorador de fragmentos</h2>
                <p className="text-[11px] text-[color:var(--c-muted)] mt-0.5">Así quedó la documentación después de ingestarla. Es lo que el agente busca y cita al responder.</p>
              </div>
              <div className="flex flex-col md:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-[color:var(--c-faint)] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar texto dentro de la documentación…" aria-label="Buscar en los fragmentos" data-testid="kb-chunk-search"
                    className="w-full bg-white border border-[color:var(--c-line)] rounded-xl pl-9 pr-3 py-2.5 text-xs" />
                </div>
                <Select value={docId} onChange={setDocId} ariaLabel="Documento" className="md:w-72" testId="kb-doc-filter"
                  options={[{ value: '', label: 'Todos los documentos' }, ...docs.filter((d) => d.fragments > 0).map((d) => ({ value: d.id, label: d.name, hint: `${d.fragments} fragmentos` }))]} />
              </div>
              <p className="text-[11px] text-[color:var(--c-muted)]" data-testid="kb-chunk-total">
                {loadingChunks && <Loader2 className="inline w-3 h-3 animate-spin mr-1" />}
                <strong className="text-[color:var(--c-ink)] tabular-nums">{fmtInt(total)}</strong> fragmento{total === 1 ? '' : 's'}{selectedDoc ? <> de <strong className="text-[color:var(--c-ink)]">{selectedDoc.name}</strong></> : ''}{debounced ? <> que contienen «{debounced}»</> : ''}
              </p>
            </div>

            {chunks.length === 0 && !loadingChunks ? (
              <p className="py-12 text-center text-xs text-[color:var(--c-muted)]">No hay fragmentos con estos criterios.</p>
            ) : (
              <ul className="divide-y divide-[color:var(--c-line)]" data-testid="kb-chunks">
                {chunks.map((c, i) => (
                  <li key={c.id} data-fragment-id={c.id} style={{ animationDelay: `${Math.min(i, 10) * 20}ms` }} className={`px-5 py-4 animate-fade-up ${hl === c.id ? 'bg-[color:var(--c-ch50)] ring-2 ring-inset ring-[#D20A2E]' : ''}`}>
                    <div className="flex items-center gap-2 flex-wrap text-[11px] mb-1.5">
                      <span className="font-semibold text-[#D20A2E] bg-[color:var(--c-ch100)] rounded-md px-2 py-0.5">#{c.order}</span>
                      {c.page ? <span className="font-semibold text-[color:var(--c-muted)] bg-[color:var(--c-soft)] rounded-md px-2 py-0.5">p. {c.page}</span> : null}
                      <button onClick={() => setDocId(c.documentId)} className="font-semibold text-[color:var(--c-ink)] hover:text-[#D20A2E] truncate max-w-[18rem]" title={c.documentName}>{c.documentName}</button>
                      <span className="text-[color:var(--c-muted)] tabular-nums">{fmtInt(c.characters)} caracteres</span>
                      <span className={`inline-flex items-center gap-1 ${c.embedded ? 'text-[color:var(--c-gtx)]' : 'text-[color:var(--c-rtx)]'}`}><Database className="w-3 h-3" />{c.embedded ? 'con vector' : 'sin vector'}</span>
                    </div>
                    <p className="text-xs leading-relaxed text-[color:var(--c-ink)] whitespace-pre-wrap"><Highlight text={c.text} q={debounced} /></p>
                  </li>
                ))}
              </ul>
            )}

            {chunks.length < total && (
              <div className="px-5 py-3 border-t border-[color:var(--c-line)] flex justify-center">
                <button onClick={() => loadChunks(true, chunks.length)} disabled={loadingChunks} data-testid="kb-more"
                  className="px-4 py-2 rounded-xl border border-[color:var(--c-line)] bg-white text-xs font-semibold text-[color:var(--c-ink)] flex items-center gap-1.5 disabled:opacity-50">
                  {loadingChunks ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ChevronDown className="w-3.5 h-3.5" />} Cargar más ({fmtInt(total - chunks.length)} restantes)
                </button>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
};

const VersionsModal: React.FC<{ doc: KbDocument; onClose: () => void; onRestored: () => void; onError: (m?: string) => void }> = ({ doc, onClose, onRestored, onError }) => {
  const [v, setV] = useState<DocVersion[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  useEffect(() => { api.getDocVersions(doc.id).then(setV).catch(() => setV([])); }, [doc.id]);
  return (
    <Modal title="Historial de versiones" subtitle={doc.name} icon={<History className="w-5 h-5" />} onClose={onClose} width="max-w-xl" testId="kb-versions-modal">
      {!v ? <div className="py-10 flex justify-center text-[color:var(--c-muted)]"><Loader2 className="w-5 h-5 animate-spin" /></div> : (
        <ul className="rounded-xl border border-[color:var(--c-line)] divide-y divide-[color:var(--c-line)] overflow-hidden">
          {v.map((x) => (
            <li key={x.version} className={`px-4 py-3 flex items-center gap-3 ${x.current ? 'bg-[color:var(--c-ch50)]' : ''}`} data-testid={`kb-version-${x.version}`}>
              <span className="w-8 h-8 rounded-lg bg-[color:var(--c-soft)] text-[11px] font-bold text-[color:var(--c-muted)] flex items-center justify-center shrink-0">v{x.version}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold text-[color:var(--c-ink)] truncate">{x.name} {x.current && <span className="ml-1 text-[10px] font-bold text-[#D20A2E] bg-[color:var(--c-ch100)] rounded-full px-1.5 py-px">Vigente</span>}</span>
                <span className="block text-[11px] text-[color:var(--c-muted)]">{fmtDate(x.uploadedAt)} · {fmtBytes(x.sizeBytes)} · {fmtInt(x.fragments)} fragmentos</span>
              </span>
              {!x.current && (
                <button disabled={!x.restorable || busy !== null} title={x.restorable ? 'Volver a esta versión' : 'El archivo ya no está en el almacenamiento'} data-testid={`kb-restore-${x.version}`}
                  onClick={async () => { setBusy(x.version); try { await api.restoreDocVersion(doc.id, x.version); onRestored(); } catch (e) { onError(e instanceof Error ? e.message : undefined); setBusy(null); } }}
                  className="px-3 py-1.5 rounded-lg border border-[color:var(--c-line)] bg-white text-[11px] font-semibold text-[color:var(--c-ink)] hover:border-[color:var(--c-ch350)] flex items-center gap-1 disabled:opacity-40">
                  {busy === x.version ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />} Restaurar</button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[11px] text-[color:var(--c-muted)]">Restaurar no borra nada: la versión vigente pasa al historial y la elegida queda como la más nueva.</p>
    </Modal>
  );
};
