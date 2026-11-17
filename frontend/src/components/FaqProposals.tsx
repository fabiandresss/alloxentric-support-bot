import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Loader2, MessageCircleQuestion, Trash2 } from 'lucide-react';
import * as api from '../api/client';
import { FaqProposal, FaqProposalList } from '../types';
import { fmtDate } from '../lib/format';

const card = 'bg-white border border-[color:var(--c-line)] rounded-2xl card-glow';
const campo = 'w-full bg-white border border-[color:var(--c-line)] rounded-xl px-3 py-2 text-xs text-[color:var(--c-ink)] resize-none';

const Propuesta: React.FC<{ p: FaqProposal; slug: string; onDone: (msg: string) => void; onError: (m: string) => void }> = ({ p, slug, onDone, onError }) => {
  const [q, setQ] = useState(p.question);
  const [a, setA] = useState(p.answer);
  const [busy, setBusy] = useState<'aceptar' | 'descartar' | null>(null);
  const valido = q.trim().length >= 3 && a.trim().length >= 10;
  const aceptar = async () => {
    setBusy('aceptar');
    try { await api.acceptFaqProposal(slug, p.id, { question: q.trim(), answer: a.trim() }); onDone('FAQ agregada a la base de conocimiento'); }
    catch (e) { onError(e instanceof Error ? e.message : 'No se pudo agregar'); setBusy(null); }
  };
  const descartar = async () => {
    setBusy('descartar');
    try { await api.discardFaqProposal(slug, p.id); onDone('Propuesta descartada'); }
    catch (e) { onError(e instanceof Error ? e.message : 'No se pudo descartar'); setBusy(null); }
  };
  return (
    <li className="px-5 py-4 space-y-2.5" data-testid={`faq-${p.id}`}>
      <p className="text-[11px] text-[color:var(--c-muted)]">Del ticket <span className="font-mono font-semibold text-[color:var(--c-ink)]">{p.ticketNumber}</span> · {fmtDate(p.createdAt)}</p>
      <label className="block text-[11px] font-semibold text-[color:var(--c-ink)]">Pregunta
        <textarea value={q} onChange={(e) => setQ(e.target.value)} rows={2} maxLength={500} className={`${campo} mt-1`} aria-label="Pregunta de la FAQ" /></label>
      <label className="block text-[11px] font-semibold text-[color:var(--c-ink)]">Respuesta
        <textarea value={a} onChange={(e) => setA(e.target.value)} rows={3} maxLength={2000} className={`${campo} mt-1`} aria-label="Respuesta de la FAQ" /></label>
      <div className="flex items-center gap-2">
        <button onClick={aceptar} disabled={!valido || busy !== null} data-testid={`faq-accept-${p.id}`}
          className="px-3.5 py-2 rounded-xl bg-[#D20A2E] hover:bg-[#B00825] text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50">
          {busy === 'aceptar' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} Agregar a la base
        </button>
        <button onClick={descartar} disabled={busy !== null} className="px-3.5 py-2 rounded-xl border border-[color:var(--c-line)] bg-white text-xs font-semibold text-[color:var(--c-muted)] hover:text-[color:var(--c-ink)] flex items-center gap-1.5 disabled:opacity-50">
          {busy === 'descartar' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} Descartar
        </button>
      </div>
    </li>
  );
};

/** Lo que respondió un agente humano en los tickets, propuesto como FAQ. Una persona lo revisa y lo edita antes de sumarlo a la base. */
export const FaqProposals: React.FC<{ slug: string; onAdded: () => void; onToast: (type: 'success' | 'warning' | 'info', title: string, description?: string) => void }> = ({ slug, onAdded, onToast }) => {
  const [data, setData] = useState<FaqProposalList | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!slug) return;
    api.getFaqProposals(slug).then((x) => { setData(x); setError(null); }).catch((e) => setError(e instanceof Error ? e.message : 'No se pudo cargar'));
  }, [slug]);
  useEffect(() => { setData(null); load(); }, [load]);

  return (
    <section className={`${card} overflow-hidden animate-fade-up`} aria-label="Propuestas de FAQ" data-testid="kb-faq-proposals">
      <div className="px-5 py-4 border-b border-[color:var(--c-line)]">
        <h2 className="text-sm font-bold text-[color:var(--c-ink)] flex items-center gap-2"><MessageCircleQuestion className="w-4 h-4 text-[#D20A2E]" /> Propuestas de FAQ
          {data && <span className="text-[11px] font-medium text-[color:var(--c-muted)]">({data.pending.length} pendientes · {data.accepted} agregadas)</span>}</h2>
        <p className="text-[11px] text-[color:var(--c-muted)] mt-0.5">Lo que respondió una persona en los tickets, para que el bot lo sepa la próxima vez. Revisa y edita: puede traer nombres o datos del caso.</p>
      </div>
      {error && <p className="px-5 py-4 text-xs text-[color:var(--c-rtx2)]">{error}</p>}
      {!data && !error && <div className="py-8 flex justify-center text-[color:var(--c-muted)]"><Loader2 className="w-5 h-5 animate-spin" /></div>}
      {data && data.pending.length === 0 && <p className="py-8 text-center text-xs text-[color:var(--c-muted)]" data-testid="faq-empty">No hay respuestas de agentes pendientes de revisar.</p>}
      {data && data.pending.length > 0 && (
        <ul className="divide-y divide-[color:var(--c-line)]">
          {data.pending.map((p) => (
            <Propuesta key={p.id} p={p} slug={slug} onError={(m) => onToast('warning', 'No se pudo completar', m)}
              onDone={(msg) => { onToast('success', msg, 'Se está procesando; el bot lo usará en unos segundos.'); load(); onAdded(); }} />
          ))}
        </ul>
      )}
    </section>
  );
};
