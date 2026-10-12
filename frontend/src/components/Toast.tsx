import React from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export interface ToastMessage {
  id: string;
  type: 'success' | 'warning' | 'info';
  title: string;
  description?: string;
}

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto bg-white rounded-xl border border-[#E2E8F0] shadow-lg p-3.5 flex items-start gap-3 animate-in slide-in-from-bottom-2 duration-200"
        >
          {t.type === 'success' && <CheckCircle2 className="w-4 h-4 text-[#22C55E] shrink-0 mt-0.5" />}
          {t.type === 'warning' && <AlertCircle className="w-4 h-4 text-[#EF4444] shrink-0 mt-0.5" />}
          {t.type === 'info' && <Info className="w-4 h-4 text-[#4F46E5] shrink-0 mt-0.5" />}

          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-[#1E1B4B]">{t.title}</p>
            {t.description && <p className="text-[11px] text-[#64748B] mt-0.5">{t.description}</p>}
          </div>

          <button
            onClick={() => onDismiss(t.id)}
            className="text-[#64748B] hover:text-[#1E1B4B] p-0.5 rounded transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
};
