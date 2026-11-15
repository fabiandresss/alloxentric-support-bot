import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Bell, CheckCheck, FlaskConical, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import * as api from '../api/client';
import { AppNotification } from '../types';

/** Avisos de la empresa (alertas de gasto, cambios en las pruebas): se consulta cada 20 s mientras la pestaña está abierta. */
export function useNotifications(slug: string | null) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const refresh = useCallback(async () => {
    if (!slug) { setItems([]); return; }
    try { setItems(await api.getNotifications(slug)); } catch { /* sin permiso o sin conexión: la campana queda vacía */ }
  }, [slug]);
  useEffect(() => {
    refresh();
    if (!slug) return;
    const t = setInterval(refresh, 20000);
    return () => clearInterval(t);
  }, [slug, refresh]);
  const markSeen = useCallback(async (n: AppNotification) => {
    if (!slug || n.seen) return;
    setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, seen: true } : x)));
    try { await api.markNotificationSeen(slug, n.id); } catch { refresh(); }
  }, [slug, refresh]);
  const markAll = useCallback(async () => {
    if (!slug) return;
    setItems((prev) => prev.map((x) => ({ ...x, seen: true })));
    try { await api.markAllNotificationsSeen(slug); } catch { refresh(); }
  }, [slug, refresh]);
  return { items, markSeen, markAll, refresh };
}

const ICON: Record<string, { icon: React.ElementType; cls: string }> = {
  gasto_80: { icon: Wallet, cls: 'bg-[color:var(--c-abg2)] text-[color:var(--c-atx2)]' },
  gasto_100: { icon: Wallet, cls: 'bg-[color:var(--c-rbg2)] text-[color:var(--c-rtx2)]' },
  gasto_dia: { icon: Wallet, cls: 'bg-[color:var(--c-rbg2)] text-[color:var(--c-rtx2)]' },
  pruebas_bajaron: { icon: TrendingDown, cls: 'bg-[color:var(--c-rbg2)] text-[color:var(--c-rtx2)]' },
  pruebas_mejoraron: { icon: TrendingUp, cls: 'bg-[color:var(--c-gbg2)] text-[color:var(--c-gtx)]' },
};

const hace = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 1) return 'ahora';
  if (m < 60) return `hace ${m} min`;
  if (m < 1440) return `hace ${Math.round(m / 60)} h`;
  return `hace ${Math.round(m / 1440)} d`;
};

interface BellProps {
  items: AppNotification[];
  onOpen: (n: AppNotification) => void;
  onMarkAll: () => void;
}

export const NotificationBell: React.FC<BellProps> = ({ items, onOpen, onMarkAll }) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const nuevas = items.filter((n) => !n.seen).length;

  const place = useCallback(() => {
    const r = btn.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) });
  }, []);

  useEffect(() => {
    if (!open) return;
    place();
    const fuera = (e: MouseEvent) => { if (!btn.current?.contains(e.target as Node) && !panel.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', fuera);
    window.addEventListener('keydown', esc);
    window.addEventListener('resize', place);
    return () => { document.removeEventListener('mousedown', fuera); window.removeEventListener('keydown', esc); window.removeEventListener('resize', place); };
  }, [open, place]);

  return (
    <>
      <button
        ref={btn} type="button" onClick={() => setOpen((o) => !o)} aria-label={nuevas ? `Notificaciones (${nuevas} nuevas)` : 'Notificaciones'} aria-expanded={open} data-testid="notif-bell"
        className="relative w-9 h-9 shrink-0 rounded-xl border border-[color:var(--c-line)] bg-white text-[color:var(--c-muted)] hover:text-[#D20A2E] hover:border-[color:var(--c-ch350)] flex items-center justify-center transition-colors"
      >
        <Bell className={`w-4 h-4 ${nuevas ? 'origin-top animate-ring' : ''}`} />
        {nuevas > 0 && (
          <span data-testid="notif-count" className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#D20A2E] text-white text-[10px] font-bold flex items-center justify-center tabular-nums ring-2 ring-white">{nuevas > 9 ? '9+' : nuevas}</span>
        )}
      </button>
      {createPortal(
        <AnimatePresence>
          {open && pos && (
            <motion.div
              ref={panel} role="dialog" aria-label="Notificaciones" data-testid="notif-panel"
              initial={{ opacity: 0, y: -8, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.12 } }}
              transition={{ type: 'spring', stiffness: 520, damping: 34 }}
              style={{ position: 'fixed', top: pos.top, right: pos.right, zIndex: 80, transformOrigin: 'top right' }}
              className="w-[22rem] max-w-[calc(100vw-1rem)] rounded-2xl border border-[color:var(--c-line)] bg-[color:var(--c-surface)] shadow-[0_18px_40px_-12px_rgba(31,27,26,0.35)] overflow-hidden"
            >
              <div className="px-4 py-3 border-b border-[color:var(--c-line)] flex items-center justify-between">
                <p className="text-xs font-bold text-[color:var(--c-ink)]">Notificaciones</p>
                {nuevas > 0 && <button onClick={onMarkAll} data-testid="notif-all" className="text-[11px] font-semibold text-[#D20A2E] hover:underline flex items-center gap-1"><CheckCheck className="w-3.5 h-3.5" /> Marcar todas como vistas</button>}
              </div>
              {items.length === 0 ? (
                <div className="py-10 text-center px-6">
                  <span className="w-11 h-11 rounded-2xl bg-[color:var(--c-ch100)] text-[#D20A2E] inline-flex items-center justify-center mb-2"><FlaskConical className="w-5 h-5" /></span>
                  <p className="text-xs font-semibold text-[color:var(--c-ink)]">Todo en orden</p>
                  <p className="text-[11px] text-[color:var(--c-muted)] mt-1">Aquí aparecen las alertas de gasto y los cambios en las pruebas del agente.</p>
                </div>
              ) : (
                <ul className="max-h-96 overflow-y-auto divide-y divide-[color:var(--c-line)]">
                  {items.map((n) => {
                    const ic = ICON[n.type] ?? ICON.gasto_80;
                    const Icon = ic.icon;
                    return (
                      <li key={n.id}>
                        <button onClick={() => { setOpen(false); onOpen(n); }} data-testid={`notif-${n.id}`}
                          className={`w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-[color:var(--c-canvas)] transition-colors ${n.seen ? '' : 'bg-[color:var(--c-ch50)]'}`}>
                          <span className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${ic.cls}`}><Icon className="w-4 h-4" /></span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-start justify-between gap-2"><span className={`text-xs ${n.seen ? 'font-medium' : 'font-bold'} text-[color:var(--c-ink)]`}>{n.title}</span>{!n.seen && <span className="w-2 h-2 rounded-full bg-[#D20A2E] shrink-0 mt-1" />}</span>
                            <span className="block text-[11px] text-[color:var(--c-muted)] mt-0.5 leading-snug line-clamp-3">{n.message}</span>
                            <span className="block text-[10px] text-[color:var(--c-faint)] mt-1">{hace(n.createdAt)}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
};
