import React, { useCallback, useEffect, useState } from 'react';
import { Bot, CheckCircle2, ChevronLeft, ChevronRight, FileText, FlaskConical, Loader2, MessageSquare, Search, ThumbsDown, ThumbsUp, Ticket, UserRound, X } from 'lucide-react';
import * as api from '../api/client';
import { AuthUser, Company, ConversationDetail, ConversationList, ConversationListItem, DocumentItem, TestSetItem } from '../types';
import { fmtDateTime, fmtInt, fmtTokens, fmtUsd } from '../lib/format';
import { Modal } from './Modal';
import { Select } from './Select';

interface ConversationsViewProps {
  me: AuthUser;
  companies: Company[];
  onOpenSource?: (companyId: string, documentId: string, fragmentId?: string) => void;
}

const PAGE = 25;
const CANALES = ['Web Chat', 'WhatsApp API', 'Portal Clientes'];
const card = 'bg-white border border-[color:var(--c-line)] rounded-2xl card-glow';

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';

const TICKET_LABEL: Record<string, string> = {
  pendiente: 'Pendiente', urgente: 'Urgente', esperando_cliente: 'Esperando cliente', cerrado: 'Cerrado', escalado: 'Escalado a gestión',
};

/** Estado de la conversación: la resolvió el bot, o se derivó a un humano (con su ticket). */
const StatusChip: React.FC<{ c: ConversationListItem }> = ({ c }) =>
  c.escalated || c.ticketNumber ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[color:var(--c-ch100)] text-[#D20A2E] whitespace-nowrap">
      <Ticket className="w-3 h-3" /> {c.ticketNumber ?? 'Derivada'}{c.ticketStatus ? ` · ${TICKET_LABEL[c.ticketStatus] ?? c.ticketStatus}` : ''}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[color:var(--c-gbg2)] text-[color:var(--c-gtx)] whitespace-nowrap">
      <Bot className="w-3 h-3" /> Resuelta por el bot
    </span>
  );

export const ConversationsView: React.FC<ConversationsViewProps> = ({ me, companies, onOpenSource }) => {
  const isSuper = me.role === 'superadmin';
  const [slug, setSlug] = useState<string>(isSuper ? companies[0]?.id ?? '' : me.companyId ?? '');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [ticket, setTicket] = useState<'' | 'con' | 'sin'>('');
  const [canal, setCanal] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [soloAbajo, setSoloAbajo] = useState(false);   // solo conversaciones con alguna respuesta valorada 👎
  const [page, setPage] = useState(0);
  const [data, setData] = useState<ConversationList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => { const t = setTimeout(() => setDebounced(q), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => { setPage(0); }, [debounced, ticket, canal, desde, hasta, slug, soloAbajo]);

  const load = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    setError(null);
    try {
      setData(await api.getConversations(slug, { q: debounced, ticket: ticket || undefined, canal, desde, hasta, valoracion: soloAbajo ? 'abajo' : undefined, limit: PAGE, offset: page * PAGE }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar las conversaciones');
    } finally {
      setLoading(false);
    }
  }, [slug, debounced, ticket, canal, desde, hasta, soloAbajo, page]);

  useEffect(() => { load(); }, [load]);

  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const company = companies.find((c) => c.id === slug);
  const field = 'bg-white border border-[color:var(--c-line)] rounded-xl px-3 py-2 text-xs text-[color:var(--c-ink)]';

  return (
    <div className="space-y-6" data-testid="conversations-view">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[color:var(--c-ink)]">Registro de conversaciones</h1>
          <p className="text-xs text-[color:var(--c-muted)] mt-1">
            Todas las conversaciones del chatbot{company ? ` de ${company.name}` : ''}, tengan ticket o no.
          </p>
        </div>
        {isSuper && (
          <Select value={slug} onChange={setSlug} ariaLabel="Empresa" size="sm" className="w-52"
            options={companies.map((c) => ({ value: c.id, label: c.name }))} />
        )}
      </div>

      {/* Filtros */}
      <div className={`${card} p-4 flex flex-col gap-3`}>
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-[color:var(--c-faint)] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={q} onChange={(e) => setQ(e.target.value)} data-testid="conv-search"
              placeholder="Buscar por cliente, correo, ticket o texto del mensaje…"
              className={`${field} w-full pl-9`}
            />
          </div>
          <div role="radiogroup" aria-label="Filtrar por ticket" className="flex p-1 rounded-xl bg-[color:var(--c-soft)] text-xs font-semibold shrink-0">
            {([['', 'Todas'], ['sin', 'Sin ticket'], ['con', 'Con ticket']] as const).map(([v, label]) => (
              <button
                key={v} role="radio" aria-checked={ticket === v} onClick={() => setTicket(v)} data-testid={`conv-filter-${v || 'todas'}`}
                className={`px-3 py-1.5 rounded-lg transition-colors ${ticket === v ? 'bg-[#D20A2E] text-white shadow-sm' : 'text-[color:var(--c-muted)] hover:text-[color:var(--c-ink)]'}`}
              >{label}</button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Select value={canal} onChange={setCanal} ariaLabel="Canal" size="sm" className="w-48"
            options={[{ value: '', label: 'Todos los canales' }, ...CANALES.map((c) => ({ value: c, label: c }))]} />
          <label className="flex items-center gap-2 text-xs text-[color:var(--c-muted)]">Desde
            <input type="date" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} className={field} />
          </label>
          <label className="flex items-center gap-2 text-xs text-[color:var(--c-muted)]">Hasta
            <input type="date" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} className={field} />
          </label>
          <button onClick={() => setSoloAbajo(!soloAbajo)} aria-pressed={soloAbajo} data-testid="conv-filter-down"
            className={`px-3 py-2 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-colors ${soloAbajo ? 'bg-[color:var(--c-rbg2)] border-[color:var(--c-rline)] text-[color:var(--c-rtx2)]' : 'bg-white border-[color:var(--c-line)] text-[color:var(--c-muted)] hover:text-[color:var(--c-ink)]'}`}>
            <ThumbsDown className="w-3.5 h-3.5" /> Valoradas 👎
          </button>
          {(q || ticket || canal || desde || hasta || soloAbajo) && (
            <button onClick={() => { setQ(''); setTicket(''); setCanal(''); setDesde(''); setHasta(''); setSoloAbajo(false); }} className="text-xs font-semibold text-[#D20A2E] hover:underline">Limpiar filtros</button>
          )}
          <span className="ml-auto text-xs text-[color:var(--c-muted)]" data-testid="conv-total">
            {loading && <Loader2 className="inline w-3.5 h-3.5 animate-spin mr-1" />}<strong className="text-[color:var(--c-ink)] tabular-nums">{fmtInt(total)}</strong> conversaciones
          </span>
        </div>
      </div>

      {error && <div className="p-4 rounded-xl border border-[color:var(--c-rline)] bg-[color:var(--c-rbg)] text-xs text-[color:var(--c-rtx2)]">{error}</div>}

      {/* Lista */}
      <div className={`${card} overflow-hidden`}>
        {data && data.items.length === 0 && !loading ? (
          <div className="py-16 text-center">
            <span className="w-12 h-12 rounded-full bg-[color:var(--c-ch100)] text-[#D20A2E] inline-flex items-center justify-center mb-3"><MessageSquare className="w-6 h-6" /></span>
            <p className="text-sm font-semibold text-[color:var(--c-ink)]">No hay conversaciones con estos criterios</p>
            <p className="text-xs text-[color:var(--c-muted)] mt-1">Prueba con otro texto o quita algún filtro.</p>
          </div>
        ) : (
          <ul className="divide-y divide-[color:var(--c-line)]" data-testid="conv-list">
            {(data?.items ?? []).map((c, i) => (
              <li key={c.id} style={{ animationDelay: `${Math.min(i, 10) * 25}ms` }} className="animate-fade-up">
                <button
                  onClick={() => setOpenId(c.id)} data-testid={`conv-row-${c.id}`}
                  className="w-full text-left px-4 sm:px-5 py-3.5 flex items-start gap-3 hover:bg-[color:var(--c-canvas)] transition-colors group"
                >
                  <span className="w-9 h-9 rounded-full bg-[color:var(--c-ch100)] text-[#D20A2E] text-xs font-bold flex items-center justify-center shrink-0">{initials(c.customerName)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-[color:var(--c-ink)]">{c.customerName}</span>
                      <StatusChip c={c} />
                      <span className="text-[11px] text-[color:var(--c-muted)]">{c.channel}</span>
                      {c.thumbsUp > 0 && <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-[color:var(--c-gtx)]"><ThumbsUp className="w-3 h-3" />{c.thumbsUp}</span>}
                      {c.thumbsDown > 0 && <span data-testid="conv-down" className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-[color:var(--c-rtx2)]"><ThumbsDown className="w-3 h-3" />{c.thumbsDown}</span>}
                    </span>
                    <span className="block text-xs text-[color:var(--c-ink)] mt-1 line-clamp-1 group-hover:text-[#D20A2E] transition-colors">{c.firstMessage || '—'}</span>
                    {c.lastMessage && c.lastMessage !== c.firstMessage && <span className="block text-[11px] text-[color:var(--c-muted)] mt-0.5 line-clamp-1">Último: {c.lastMessage}</span>}
                  </span>
                  <span className="hidden sm:flex flex-col items-end gap-1 shrink-0 text-[11px] text-[color:var(--c-muted)] tabular-nums">
                    <span>{fmtDateTime(c.lastActivityAt)}</span>
                    <span>{c.messageCount} mensajes{c.costUsd > 0 ? ` · ${fmtUsd(c.costUsd)}` : ''}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {data && total > PAGE && (
          <div className="px-5 py-3 border-t border-[color:var(--c-line)] flex items-center justify-between text-xs text-[color:var(--c-muted)]">
            <span className="tabular-nums">Página {page + 1} de {pages}</span>
            <div className="flex gap-2">
              <button disabled={page === 0} onClick={() => setPage(page - 1)} className="px-3 py-1.5 rounded-lg border border-[color:var(--c-line)] bg-white font-semibold text-[color:var(--c-ink)] disabled:opacity-40 flex items-center gap-1"><ChevronLeft className="w-3.5 h-3.5" /> Anterior</button>
              <button disabled={page + 1 >= pages} onClick={() => setPage(page + 1)} className="px-3 py-1.5 rounded-lg border border-[color:var(--c-line)] bg-white font-semibold text-[color:var(--c-ink)] disabled:opacity-40 flex items-center gap-1">Siguiente <ChevronRight className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        )}
      </div>

      {openId && <ConversationModal id={openId} slug={slug} onClose={() => setOpenId(null)} onOpenSource={onOpenSource} />}
    </div>
  );
};

const ConversationModal: React.FC<{ id: string; slug: string; onClose: () => void; onOpenSource?: (companyId: string, documentId: string, fragmentId?: string) => void }> = ({ id, slug, onClose, onOpenSource }) => {
  const [d, setD] = useState<ConversationDetail | null>(null);
  const [adding, setAdding] = useState(false);
  const [seedQuestion, setSeedQuestion] = useState<string | undefined>(undefined);   // 👎: la pregunta del cliente que originó la respuesta
  const [added, setAdded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.getConversation(id).then((x) => alive && setD(x)).catch((e) => alive && setError(e instanceof Error ? e.message : 'No se pudo cargar'));
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !adding && onClose();
    window.addEventListener('keydown', esc);
    return () => { alive = false; window.removeEventListener('keydown', esc); };
  }, [id, onClose, adding]);

  const s = d?.summary;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#1F1B1A]/45 backdrop-blur-xs animate-in" onClick={onClose} role="dialog" aria-modal="true" aria-label="Conversación">
      <div className="bg-white rounded-2xl border border-[color:var(--c-line)] shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()} data-testid="conv-modal">
        <div className="px-5 py-4 border-b border-[color:var(--c-line)] flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-bold text-[color:var(--c-ink)]">{s?.customerName ?? 'Conversación'}</h2>
              {s && <StatusChip c={s} />}
            </div>
            {s && <p className="text-[11px] text-[color:var(--c-muted)] mt-1">{s.channel} · {fmtDateTime(s.startedAt)}{s.customerEmail ? ` · ${s.customerEmail}` : ''}</p>}
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="p-1.5 rounded-lg text-[color:var(--c-muted)] hover:text-[color:var(--c-ink)] hover:bg-[color:var(--c-canvas)]"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3 bg-[color:var(--c-canvas)]">
          {!d && !error && <div className="py-12 flex justify-center text-[color:var(--c-muted)]"><Loader2 className="w-5 h-5 animate-spin" /></div>}
          {error && <p className="text-xs text-[color:var(--c-rtx)]">{error}</p>}
          {d?.messages.map((m, idx) => {
            const mine = m.sender === 'user';
            const preguntaPrevia = [...d.messages.slice(0, idx)].reverse().find((x) => x.sender === 'user')?.message;
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed ${mine ? 'bg-[#D20A2E] text-white rounded-br-sm' : m.isEscalationNotice ? 'bg-[color:var(--c-abg)] border border-[color:var(--c-aline)] text-[color:var(--c-atx2)] rounded-bl-sm' : 'bg-white border border-[color:var(--c-line)] text-[color:var(--c-ink)] rounded-bl-sm'}`}>
                  <p className={`flex items-center gap-1 text-[10px] font-semibold mb-0.5 ${mine ? 'text-white/80' : 'text-[color:var(--c-muted)]'}`}>
                    {m.sender === 'user' ? <UserRound className="w-3 h-3" /> : m.sender === 'bot' ? <Bot className="w-3 h-3" /> : <MessageSquare className="w-3 h-3" />}
                    {m.senderName} · {m.timestamp}
                  </p>
                  <p className="whitespace-pre-wrap">{m.message}</p>
                  {m.sourceDetails && m.sourceDetails.length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5" data-testid="conv-sources">
                      {m.sourceDetails.map((s, i) => onOpenSource && s.documentId ? (
                        <button key={i} onClick={() => onOpenSource(slug, s.documentId!, s.fragmentId)} title="Abrir el fragmento en la base de conocimiento"
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[color:var(--c-soft)] text-[10px] font-medium text-[color:var(--c-ink)] hover:text-[#D20A2E]"><FileText className="w-3 h-3" />{s.documentName}{s.order !== undefined ? ` #${s.order}` : ''}</button>
                      ) : <span key={i} className="text-[10px] text-[color:var(--c-muted)]">{s.documentName}</span>)}
                      {m.confidenceScore !== undefined && <span className="text-[10px] text-[color:var(--c-muted)]">confianza {Math.round(m.confidenceScore * 100)}%</span>}
                    </div>
                  ) : m.ragSources && m.ragSources.length > 0 && <p className="mt-1.5 text-[10px] text-[color:var(--c-muted)]">Fuentes: {m.ragSources.join(', ')}{m.confidenceScore !== undefined ? ` · confianza ${Math.round(m.confidenceScore * 100)}%` : ''}</p>}
                  {m.rating && (
                    <div data-testid={`conv-rating-${m.rating}`} className={`mt-1.5 flex items-start gap-1.5 text-[10px] font-semibold ${m.rating === 'up' ? 'text-[color:var(--c-gtx)]' : 'text-[color:var(--c-rtx2)]'}`}>
                      {m.rating === 'up' ? <ThumbsUp className="w-3 h-3 mt-px" /> : <ThumbsDown className="w-3 h-3 mt-px" />}
                      <span>El cliente {m.rating === 'up' ? 'valoró bien' : 'valoró mal'} esta respuesta{m.ratingComment ? `: «${m.ratingComment}»` : ''}
                        {m.rating === 'down' && preguntaPrevia && (
                          <button onClick={() => { setSeedQuestion(preguntaPrevia); setAdding(true); }} data-testid="conv-down-to-case" className="ml-2 underline underline-offset-2 hover:text-[#D20A2E]">Crear caso de prueba</button>
                        )}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {d && s && (
          <div className="px-5 py-3 border-t border-[color:var(--c-line)] flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-[color:var(--c-muted)] tabular-nums" data-testid="conv-usage">
            <span>{s.messageCount} mensajes</span>
            <span>{d.aiCalls} llamadas a IA</span>
            <span>{fmtTokens(d.inputTokens)} tokens de entrada</span>
            <span>{fmtTokens(d.outputTokens)} de salida</span>
            <span className="font-semibold text-[color:var(--c-ink)]">{fmtUsd(s.costUsd)}</span>
          </div>
        )}
        {d && (
          <div className="px-5 py-3 border-t border-[color:var(--c-line)] flex items-center justify-between gap-3 flex-wrap bg-[color:var(--c-canvas)]">
            {added ? <span className="text-xs font-semibold text-[color:var(--c-gtx)] flex items-center gap-1.5" data-testid="conv-added"><CheckCircle2 className="w-4 h-4" /> Agregado a «{added}»</span>
              : <span className="text-[11px] text-[color:var(--c-muted)]">¿Un buen caso para vigilar? Conviértelo en una prueba del agente.</span>}
            <button onClick={() => setAdding(true)} data-testid="conv-add-golden" className="px-3.5 py-2 rounded-xl border border-[color:var(--c-line)] bg-white text-xs font-semibold text-[color:var(--c-ink)] flex items-center gap-1.5 hover:border-[color:var(--c-ch350)]"><FlaskConical className="w-3.5 h-3.5 text-[#D20A2E]" /> Agregar al golden set</button>
          </div>
        )}
        {adding && d && <AddToGoldenModal slug={slug} detail={d} seedQuestion={seedQuestion} onClose={() => { setAdding(false); setSeedQuestion(undefined); }} onDone={(nombre) => { setAdding(false); setSeedQuestion(undefined); setAdded(nombre); }} />}
      </div>
    </div>
  );
};

/** Convierte una conversación real en un caso de prueba: la pregunta del cliente y, si la hubo, la respuesta correcta que dio una persona. */
const AddToGoldenModal: React.FC<{ slug: string; detail: ConversationDetail; seedQuestion?: string; onClose: () => void; onDone: (setName: string) => void }> = ({ slug, detail, seedQuestion, onClose, onDone }) => {
  const msgs = detail.messages;
  const primera = msgs.find((m) => m.sender === 'user')?.message ?? '';
  const humano = seedQuestion ? '' : [...msgs].reverse().find((m) => m.sender === 'agent')?.message ?? '';   // un 👎 no trae respuesta correcta: se escribe
  const sinRespuestaHumana = !seedQuestion && detail.summary.escalated && !humano;
  const [sets, setSets] = useState<TestSetItem[] | null>(null);
  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [setId, setSetId] = useState('');
  const [nuevo, setNuevo] = useState('Casos reales');
  const [question, setQuestion] = useState(seedQuestion ?? primera);
  const [escalate, setEscalate] = useState(sinRespuestaHumana);
  const [answer, setAnswer] = useState(humano);
  const [doc, setDoc] = useState(detail.messages.find((m) => m.ragSources?.length)?.ragSources?.[0] ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.getTestSets(slug), api.getDocuments(slug)]).then(([s, d]) => { setSets(s); setDocs(d.filter((x) => x.status === 'procesado')); setSetId(s[0]?.id ?? '__nuevo__'); }).catch(() => { setSets([]); setSetId('__nuevo__'); });
  }, [slug]);

  const guardar = async () => {
    setBusy(true); setErr(null);
    try {
      let id = setId;
      let nombre = sets?.find((s) => s.id === setId)?.name ?? '';
      if (setId === '__nuevo__') { const s = await api.createTestSet(slug, { name: nuevo.trim() }); id = s.id; nombre = s.name; }
      await api.createTestCase(slug, id, { question: question.trim(), shouldEscalate: escalate, expectedAnswer: escalate ? null : answer.trim() || null, expectedDocument: escalate ? null : doc || null, conversationId: detail.summary.id });
      onDone(nombre);
    } catch (e) { setErr(e instanceof Error ? e.message : 'No se pudo agregar'); setBusy(false); }
  };
  const input = 'w-full bg-white border border-[color:var(--c-line)] rounded-xl px-3.5 py-2.5 text-xs text-[color:var(--c-ink)]';
  return (
    <Modal title="Agregar al golden set" subtitle="La pregunta del cliente pasa a ser un caso de prueba; revisa lo esperado antes de guardar." icon={<FlaskConical className="w-5 h-5" />} onClose={busy ? () => undefined : onClose} width="max-w-xl" testId="conv-golden-modal"
      footer={<><button onClick={onClose} disabled={busy} className="px-4 py-2.5 rounded-xl border border-[color:var(--c-line)] bg-white text-xs font-semibold text-[color:var(--c-ink)]">Cancelar</button>
        <button onClick={guardar} disabled={busy || !sets || question.trim().length < 3 || (setId === '__nuevo__' && !nuevo.trim())} data-testid="conv-golden-save" className="px-4 py-2.5 rounded-xl bg-[#D20A2E] hover:bg-[#B00825] text-white text-xs font-semibold disabled:opacity-50 flex items-center gap-1.5">{busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Agregar caso</button></>}>
      {!sets ? <div className="py-10 flex justify-center text-[color:var(--c-muted)]"><Loader2 className="w-5 h-5 animate-spin" /></div> : (
        <div className="space-y-4">
          <div className="text-xs font-semibold text-[color:var(--c-ink)]">Conjunto
            <div className="mt-1.5"><Select value={setId} onChange={setSetId} ariaLabel="Conjunto" testId="conv-golden-set" options={[...sets.map((s) => ({ value: s.id, label: s.name, hint: `${s.caseCount} casos` })), { value: '__nuevo__', label: 'Crear un conjunto nuevo…' }]} /></div>
            {setId === '__nuevo__' && <input value={nuevo} onChange={(e) => setNuevo(e.target.value)} maxLength={120} placeholder="Nombre del conjunto" className={`${input} mt-2`} />}</div>
          <label className="block text-xs font-semibold text-[color:var(--c-ink)]">Pregunta del cliente
            <textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={2} maxLength={1000} data-testid="conv-golden-question" className={`${input} mt-1.5 resize-none`} /></label>
          <button type="button" role="switch" aria-checked={escalate} onClick={() => setEscalate(!escalate)} className={`w-full flex items-start gap-3 p-3 rounded-xl border text-left transition-all ${escalate ? 'border-[#D20A2E] bg-[color:var(--c-ch50)]' : 'border-[color:var(--c-line)] bg-white'}`}>
            <span className={`mt-0.5 w-9 h-5 rounded-full p-0.5 shrink-0 transition-colors ${escalate ? 'bg-[#D20A2E]' : 'bg-[color:var(--c-line2)]'}`}><span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform ${escalate ? 'translate-x-4' : ''}`} /></span>
            <span><span className="block text-xs font-semibold text-[color:var(--c-ink)]">Debe derivar a un humano</span><span className="block text-[11px] text-[color:var(--c-muted)] mt-0.5">{sinRespuestaHumana ? 'Esta conversación se derivó y nadie respondió por el chat: se sugiere como caso que debe derivar.' : 'Actívalo si la respuesta no está en la documentación.'}</span></span>
          </button>
          {!escalate && (
            <>
              <label className="block text-xs font-semibold text-[color:var(--c-ink)]">Respuesta esperada
                <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={3} maxLength={2000} className={`${input} mt-1.5 resize-none`} />
                <span className="block mt-1 text-[11px] font-normal text-[color:var(--c-muted)]">{humano ? 'Viene de la respuesta del agente humano en esta conversación: revísala.' : 'No hubo respuesta de una persona: escribe la respuesta correcta.'}</span></label>
              <div className="text-xs font-semibold text-[color:var(--c-ink)]">Documento que debería citar <span className="font-normal text-[color:var(--c-muted)]">(opcional)</span>
                <div className="mt-1.5"><Select value={doc} onChange={setDoc} ariaLabel="Documento esperado" options={[{ value: '', label: 'Cualquiera (no revisar la fuente)' }, ...docs.map((d) => ({ value: d.name, label: d.name }))]} /></div></div>
            </>
          )}
          {err && <p role="alert" className="text-xs text-[color:var(--c-rtx2)] bg-[color:var(--c-rbg)] border border-[color:var(--c-rline)] rounded-xl px-3 py-2">{err}</p>}
        </div>
      )}
    </Modal>
  );
};
