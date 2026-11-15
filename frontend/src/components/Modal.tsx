import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Ancho máximo del cuadro (clase de Tailwind). */
  width?: string;
  testId?: string;
}

/** Cuadro de diálogo estándar: fondo atenuado, entra con animación, se cierra con Esc o al hacer clic fuera. */
export const Modal: React.FC<ModalProps> = ({ title, subtitle, icon, onClose, children, footer, width = 'max-w-lg', testId }) => {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#1F1B1A]/45 backdrop-blur-xs animate-in" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className={`bg-white rounded-2xl border border-[color:var(--c-line)] shadow-2xl w-full ${width} max-h-[90vh] flex flex-col overflow-hidden`} onClick={(e) => e.stopPropagation()} data-testid={testId}>
        <div className="px-5 py-4 border-b border-[color:var(--c-line)] flex items-start justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {icon && <span className="w-10 h-10 rounded-xl bg-[color:var(--c-ch100)] text-[#D20A2E] flex items-center justify-center shrink-0">{icon}</span>}
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-[color:var(--c-ink)]">{title}</h2>
              {subtitle && <p className="text-[11px] text-[color:var(--c-muted)] mt-0.5">{subtitle}</p>}
            </div>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="p-1.5 rounded-lg text-[color:var(--c-muted)] hover:text-[color:var(--c-ink)] hover:bg-[color:var(--c-canvas)] shrink-0"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <div className="px-5 py-3.5 border-t border-[color:var(--c-line)] bg-[color:var(--c-canvas)] flex items-center justify-end gap-2 shrink-0">{footer}</div>}
      </div>
    </div>
  );
};
