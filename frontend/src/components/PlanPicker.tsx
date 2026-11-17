import React from 'react';
import { Gauge, Infinity as InfinityIcon } from 'lucide-react';
import { SpendPlan } from '../types';

/** Valor del selector (los montos van como texto para poder escribirlos con comodidad). */
export interface PlanValue {
  mode: SpendPlan['mode'];
  monthly: string;
  daily: string;
}

export const planInicial = (p?: SpendPlan): PlanValue => ({
  mode: p?.mode ?? 'sin_limite',
  monthly: p?.monthlyLimitUsd ? String(p.monthlyLimitUsd) : '100',
  daily: p?.dailyLimitUsd ? String(p.dailyLimitUsd) : '',
});

/** Convierte lo escrito en el plan a enviar al backend; `valid` dice si se puede guardar. */
export function planDe(v: PlanValue): { plan: SpendPlan; valid: boolean; monthlyInvalid: boolean; dailyInvalid: boolean } {
  if (v.mode === 'sin_limite') return { plan: { mode: 'sin_limite' }, valid: true, monthlyInvalid: false, dailyInvalid: false };
  const monthly = Number(v.monthly);
  const daily = v.daily.trim() === '' ? undefined : Number(v.daily);
  const monthlyInvalid = !Number.isFinite(monthly) || monthly < 0.01;
  const dailyInvalid = daily !== undefined && (!Number.isFinite(daily) || daily < 0.01 || daily > monthly);
  return {
    plan: { mode: 'limitado', monthlyLimitUsd: monthly, ...(daily !== undefined ? { dailyLimitUsd: daily } : {}) },
    valid: !monthlyInvalid && !dailyInvalid, monthlyInvalid, dailyInvalid,
  };
}

/** Texto corto del plan para tarjetas y avisos: «Sin límite mensual» o «Límite US$ 100 al mes». */
export const planTexto = (p?: SpendPlan) =>
  !p || p.mode === 'sin_limite' ? 'Sin límite mensual' : `Límite US$ ${p.monthlyLimitUsd?.toLocaleString('es-CL', { maximumFractionDigits: 2 })} al mes`;

/** Elección del plan de gasto del chatbot: ilimitado, o con un tope mensual (y diario opcional) en USD. */
export const PlanPicker: React.FC<{ value: PlanValue; onChange: (v: PlanValue) => void; disabled?: boolean }> = ({ value, onChange, disabled }) => {
  const { monthlyInvalid, dailyInvalid } = planDe(value);
  const opcion = (mode: SpendPlan['mode'], titulo: string, texto: string, Icon: React.ElementType) => (
    <button type="button" role="radio" aria-checked={value.mode === mode} disabled={disabled} onClick={() => onChange({ ...value, mode })} data-testid={`plan-${mode}`}
      className={`text-left flex items-start gap-3 p-3.5 rounded-xl border transition-all disabled:opacity-60 ${value.mode === mode ? 'border-[#D20A2E] bg-[color:var(--c-ch50)] ring-2 ring-[#D20A2E]/15' : 'border-[color:var(--c-line)] bg-white hover:border-[color:var(--c-ch350)]'}`}>
      <span className="w-9 h-9 rounded-xl bg-[color:var(--c-ch100)] text-[#D20A2E] flex items-center justify-center shrink-0"><Icon className="w-4 h-4" /></span>
      <span><span className="block text-xs font-semibold text-[color:var(--c-ink)]">{titulo}</span><span className="block text-[11px] text-[color:var(--c-muted)] mt-0.5 leading-snug">{texto}</span></span>
    </button>
  );
  const campo = 'w-full bg-white border border-[color:var(--c-line)] rounded-xl pl-7 pr-3 py-2.5 text-sm tabular-nums disabled:opacity-60';
  return (
    <div className="space-y-3" data-testid="plan-picker">
      <div role="radiogroup" aria-label="Plan de gasto del chatbot" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {opcion('limitado', 'Con un límite mensual', 'Fijas un tope en USD por mes. Al llegar, el chatbot sigue respondiendo con la documentación, sin IA, hasta el mes siguiente.', Gauge)}
        {opcion('sin_limite', 'Sin límite', 'El chatbot nunca se corta: se cobra lo que se consuma en el mes.', InfinityIcon)}
      </div>
      {value.mode === 'limitado' && (
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block text-xs font-semibold text-[color:var(--c-ink)]">Límite mensual (USD)
            <div className="relative mt-1.5"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--c-muted)] text-sm">$</span>
              <input type="number" min="0.01" step="0.01" value={value.monthly} disabled={disabled} onChange={(e) => onChange({ ...value, monthly: e.target.value })} data-testid="plan-amount" className={campo} /></div>
            {monthlyInvalid && <span className="block mt-1 text-[11px] font-normal text-[color:var(--c-rtx)]">Ingresa un monto de al menos $0,01.</span>}
          </label>
          <label className="block text-xs font-semibold text-[color:var(--c-ink)]">Tope diario (USD) <span className="font-normal text-[color:var(--c-muted)]">· opcional</span>
            <div className="relative mt-1.5"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--c-muted)] text-sm">$</span>
              <input type="number" min="0.01" step="0.01" value={value.daily} disabled={disabled} placeholder="Sin tope diario" onChange={(e) => onChange({ ...value, daily: e.target.value })} data-testid="plan-daily" className={campo} /></div>
            {dailyInvalid ? <span className="block mt-1 text-[11px] font-normal text-[color:var(--c-rtx)]">Debe ser de al menos $0,01 y no superar el límite mensual.</span>
              : <span className="block mt-1 text-[11px] font-normal text-[color:var(--c-muted)]">Evita que un mal día o un abuso se coma el mes.</span>}
          </label>
        </div>
      )}
      <p className="text-[11px] text-[color:var(--c-muted)]">Puedes cambiarlo cuando quieras en «Consumo y costos». El cobro automático al medio de pago se activará con la integración de pagos (aún no disponible): hoy el panel mide y aplica el límite.</p>
    </div>
  );
};
