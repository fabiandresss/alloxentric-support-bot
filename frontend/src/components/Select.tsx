import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Check, ChevronDown } from 'lucide-react';

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  /** Texto secundario bajo la etiqueta (opcional). */
  hint?: string;
  /** Icono o logo a la izquierda (opcional). */
  icon?: React.ReactNode;
}

interface SelectProps<T extends string = string> {
  value: T;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
  /** 'md' = campos de formulario; 'sm' = filtros y barras de herramientas. */
  size?: 'sm' | 'md';
  className?: string;
  /** Clase del ancho del menú; por defecto es al menos el ancho del botón. */
  menuClassName?: string;
  /** Se usa para los ids de prueba: `${testId}` en el botón y `${testId}-option-${value}` en cada opción. */
  testId?: string;
}

/**
 * Menú desplegable propio (reemplaza al <select> nativo): animado, accesible y con teclado (flechas, Inicio/Fin, Enter, Esc).
 * El menú se dibuja en un portal con posición fija, así no lo recorta ningún contenedor con scroll o overflow (tablas, modales).
 */
export function Select<T extends string = string>({
  value, onChange, options, ariaLabel, placeholder = 'Seleccionar', disabled, size = 'md', className = '', menuClassName = '', testId,
}: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const id = useId();
  const selected = options.findIndex((o) => o.value === value);
  const current = selected >= 0 ? options[selected] : null;

  const place = useCallback(() => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const alto = Math.min(options.length * 44 + 12, 288);
    const up = window.innerHeight - r.bottom < alto + 16 && r.top > alto + 16;   // sin espacio abajo y con espacio arriba: se abre hacia arriba
    setPos({ left: r.left, top: up ? r.top - 6 : r.bottom + 6, width: r.width, up });
  }, [options.length]);

  const abrir = () => { if (disabled) return; place(); setActive(Math.max(0, selected)); setOpen(true); };
  const cerrar = (devolverFoco = true) => { setOpen(false); if (devolverFoco) btn.current?.focus(); };
  const elegir = (i: number) => { const o = options[i]; if (!o) return; onChange(o.value); cerrar(); };

  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const fuera = (e: MouseEvent) => {
      if (!btn.current?.contains(e.target as Node) && !menu.current?.contains(e.target as Node)) setOpen(false);
    };
    const mover = (e: Event) => { const t = e.target; if (!(t instanceof Node) || !menu.current?.contains(t)) place(); };   // el menú acompaña al botón si la página se desplaza
    document.addEventListener('mousedown', fuera);
    window.addEventListener('resize', mover);
    window.addEventListener('scroll', mover, true);
    return () => { document.removeEventListener('mousedown', fuera); window.removeEventListener('resize', mover); window.removeEventListener('scroll', mover, true); };
  }, [open, place]);

  useEffect(() => {   // mantiene visible la opción activa al navegar con el teclado
    if (open && active >= 0) menu.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const onKey = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); abrir(); }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % options.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + options.length) % options.length); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(options.length - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); elegir(active); }
    else if (e.key === 'Tab') setOpen(false);
  };

  const pad = size === 'sm' ? 'px-3 py-2 text-xs' : 'px-3.5 py-2.5 text-xs';

  return (
    <>
      <button
        ref={btn} type="button" disabled={disabled} onClick={() => (open ? cerrar(false) : abrir())} onKeyDown={onKey}
        role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined} aria-label={ariaLabel}
        data-testid={testId}
        className={`group w-full min-w-0 flex items-center justify-between gap-2 rounded-xl border bg-white text-left font-medium transition-all
          ${pad} ${open ? 'border-[#D20A2E] ring-[3px] ring-[#D20A2E]/15' : 'border-[color:var(--c-line)] hover:border-[color:var(--c-ch350)]'}
          ${disabled ? 'opacity-60 cursor-not-allowed bg-[color:var(--c-canvas)]' : 'cursor-pointer'} ${className}`}
      >
        <span className="flex items-center gap-2 min-w-0">
          {current?.icon}
          <span className={`truncate ${current ? 'text-[color:var(--c-ink)]' : 'text-[color:var(--c-faint)]'}`}>{current ? current.label : placeholder}</span>
        </span>
        <ChevronDown className={`w-4 h-4 shrink-0 text-[color:var(--c-muted)] transition-transform duration-200 ${open ? 'rotate-180 text-[#D20A2E]' : ''}`} />
      </button>

      {createPortal(
        <AnimatePresence>
          {open && pos && (
            <motion.ul
              ref={menu} id={id} role="listbox" aria-label={ariaLabel} tabIndex={-1}
              initial={{ opacity: 0, y: pos.up ? 6 : -6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: pos.up ? 4 : -4, scale: 0.98, transition: { duration: 0.12 } }}
              transition={{ type: 'spring', stiffness: 520, damping: 34 }}
              style={{ position: 'fixed', left: pos.left, minWidth: pos.width, ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }), transformOrigin: pos.up ? 'bottom' : 'top', zIndex: 80 }}
              className={`max-h-72 overflow-y-auto p-1.5 rounded-2xl border border-[color:var(--c-line)] bg-[color:var(--c-surface)] shadow-[0_18px_40px_-12px_rgba(31,27,26,0.35)] ${menuClassName}`}
            >
              {options.map((o, i) => {
                const sel = i === selected;
                return (
                  <motion.li
                    key={o.value} role="option" aria-selected={sel} data-testid={testId ? `${testId}-option-${o.value}` : undefined}
                    initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i, 8) * 0.018, duration: 0.14 }}
                    onMouseEnter={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => elegir(i)}
                    className={`flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs cursor-pointer transition-colors
                      ${i === active ? 'bg-[color:var(--c-ch100)]' : ''} ${sel ? 'text-[#D20A2E] font-semibold' : 'text-[color:var(--c-ink)] font-medium'}`}
                  >
                    {o.icon}
                    <span className="flex-1 min-w-0">
                      <span className="block truncate">{o.label}</span>
                      {o.hint && <span className="block text-[11px] font-normal text-[color:var(--c-muted)] truncate">{o.hint}</span>}
                    </span>
                    {sel && <Check className="w-3.5 h-3.5 shrink-0" strokeWidth={2.75} />}
                  </motion.li>
                );
              })}
            </motion.ul>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
