import React, { useEffect, useState } from 'react';
import { ChevronDown, HelpCircle, Loader2, Lightbulb } from 'lucide-react';
import * as api from '../api/client';
import { UnansweredGroup, UnansweredReport } from '../types';
import { fmtDate } from '../lib/format';
import { Select } from './Select';

const RAZON: Record<UnansweredGroup['reason'], { label: string; cls: string }> = {
  sin_informacion: { label: 'Sin información', cls: 'bg-[color:var(--c-rbg2)] text-[color:var(--c-rtx2)]' },
  modelo_no_sabe: { label: 'El modelo no supo', cls: 'bg-[color:var(--c-abg2)] text-[color:var(--c-atx2)]' },
  baja_valoracion: { label: 'Valorada 👎', cls: 'bg-[color:var(--c-soft)] text-[color:var(--c-muted)]' },
};

/** Preguntas que el bot no pudo resolver, agrupadas por tema: lo que le falta a la documentación. */
export const UnansweredPanel: React.FC<{ slug: string; onSearchDoc?: (name: string) => void }> = ({ slug, onSearchDoc }) => {
  const [days, setDays] = useState('30');
  const [r, setR] = useState<UnansweredReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    if (!slug) return;
    let alive = true;
    setR(null);
    setError(null);
    api.getUnanswered(slug, Number(days)).then((x) => alive && setR(x)).catch((e) => alive && setError(e instanceof Error ? e.message : 'No se pudo cargar'));
    return () => { alive = false; };
  }, [slug, days]);

  return (
    <section className="bg-white border border-[color:var(--c-line)] rounded-2xl card-glow overflow-hidden animate-fade-up" aria-label="Preguntas sin respuesta" data-testid="kb-unanswered">
      <div className="px-5 py-4 border-b border-[color:var(--c-line)] flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-[color:var(--c-ink)] flex items-center gap-2"><HelpCircle className="w-4 h-4 text-[#D20A2E]" /> Preguntas sin respuesta
            {r && <span className="text-[11px] font-medium text-[color:var(--c-muted)]">({r.totalQuestions} en {r.days} días)</span>}</h2>
          <p className="text-[11px] text-[color:var(--c-muted)] mt-0.5">Lo que los clientes preguntaron y el bot no pudo resolver, agrupado por tema. Es lo que falta documentar.</p>
        </div>
        <Select value={days} onChange={setDays} ariaLabel="Periodo" size="sm" className="w-40"
          options={[{ value: '7', label: 'Últimos 7 días' }, { value: '30', label: 'Últimos 30 días' }, { value: '90', label: 'Últimos 90 días' }]} />
      </div>
      {error && <p className="px-5 py-4 text-xs text-[color:var(--c-rtx2)]">{error}</p>}
      {!r && !error && <div className="py-10 flex justify-center text-[color:var(--c-muted)]"><Loader2 className="w-5 h-5 animate-spin" /></div>}
      {r && r.groups.length === 0 && <p className="py-10 text-center text-xs text-[color:var(--c-muted)]" data-testid="unanswered-empty">No hay preguntas sin resolver en este periodo. 🎉</p>}
      {r && r.groups.length > 0 && (
        <ul className="divide-y divide-[color:var(--c-line)]" data-testid="unanswered-list">
          {r.groups.map((g, i) => (
            <li key={i} className="px-5 py-4">
              <div className="flex items-start gap-3">
                <span className="min-w-8 h-8 px-2 rounded-lg bg-[color:var(--c-ch100)] text-[#D20A2E] text-xs font-bold flex items-center justify-center tabular-nums shrink-0" title="Veces que se preguntó">{g.count}×</span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-[color:var(--c-ink)]">{g.topic}</p>
                  <div className="mt-1 flex items-center gap-2 flex-wrap text-[11px] text-[color:var(--c-muted)]">
                    <span className={`px-2 py-0.5 rounded-full font-semibold ${RAZON[g.reason].cls}`}>{RAZON[g.reason].label}</span>
                    <span>Última: {fmtDate(g.lastAt)}</span>
                    {g.closestDocument && (
                      <button onClick={() => onSearchDoc?.(g.closestDocument!)} className="hover:text-[#D20A2E] underline-offset-2 hover:underline" title="Ver ese documento en la tabla">
                        Más cercano: {g.closestDocument}{g.closestConfidence !== undefined ? ` (${Math.round(g.closestConfidence * 100)}%)` : ''}
                      </button>
                    )}
                  </div>
                  <p className="mt-2 text-[11px] text-[color:var(--c-ink)] bg-[color:var(--c-canvas)] rounded-lg px-3 py-2 flex items-start gap-1.5"><Lightbulb className="w-3.5 h-3.5 text-[#F59E0B] shrink-0 mt-px" />{g.suggestion}</p>
                  {g.questions.length > 1 && (
                    <button onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i} className="mt-2 text-[11px] font-semibold text-[color:var(--c-muted)] hover:text-[color:var(--c-ink)] flex items-center gap-1">
                      Ver las {g.questions.length} preguntas <ChevronDown className={`w-3 h-3 transition-transform ${open === i ? 'rotate-180' : ''}`} />
                    </button>
                  )}
                  {open === i && (
                    <ul className="mt-1.5 space-y-1">
                      {g.questions.map((q, k) => <li key={k} className="text-[11px] text-[color:var(--c-muted)]">«{q.question}» <span className="text-[color:var(--c-faint)]">· {fmtDate(q.at)}</span></li>)}
                    </ul>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
