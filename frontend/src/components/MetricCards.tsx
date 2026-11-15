import React, { useEffect, useRef, useState } from 'react';
import { Inbox, Clock, Bot, GitFork, AlertCircle, type LucideIcon } from 'lucide-react';
import { SystemMetrics } from '../types';

interface MetricCardsProps {
  metrics: SystemMetrics;
}

/** Cuenta de 0 al valor con ease-out; si el valor no es numérico lo muestra tal cual. */
const CountUp: React.FC<{ value: number | string; suffix?: string }> = ({ value, suffix = '' }) => {
  const target = typeof value === 'number' ? value : NaN;
  const [shown, setShown] = useState(Number.isNaN(target) ? 0 : 0);
  const raf = useRef<number>(0);
  useEffect(() => {
    if (Number.isNaN(target)) return;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / 700);
      setShown(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target]);
  return <>{Number.isNaN(target) ? value : shown}{suffix}</>;
};

interface StatProps {
  label: string;
  value: number | string;
  suffix?: string;
  icon: LucideIcon;
  hint: string;
  delay: number;
  hero?: boolean;
  children?: React.ReactNode;
}

const Stat: React.FC<StatProps> = ({ label, value, suffix, icon: Icon, hint, delay, hero, children }) => (
  <div
    style={{ animationDelay: `${delay}ms` }}
    className={`animate-fade-up lift relative overflow-hidden rounded-2xl p-3.5 sm:p-4 ${
      hero
        ? 'bg-gradient-to-br from-[#D20A2E] to-[#8F0720] text-white shadow-[0_18px_32px_-18px_rgba(210,10,46,0.7)]'
        : 'bg-white border border-[color:var(--c-line)] card-glow'
    }`}
  >
    {hero && (
      <svg aria-hidden className="absolute -right-4 -bottom-5 w-24 h-24 opacity-[0.13]" viewBox="0 0 32 32" fill="none">
        <g stroke="#fff" strokeWidth="7" strokeLinecap="round"><line x1="8" y1="8" x2="24" y2="24" /><line x1="24" y1="8" x2="8" y2="24" /></g>
      </svg>
    )}
    <div className="relative flex items-center justify-between">
      <span className={`text-xs font-medium ${hero ? 'text-white/80' : 'text-[color:var(--c-muted)]'}`}>{label}</span>
      <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${hero ? 'bg-white/15 text-white' : 'bg-[color:var(--c-ch100)] text-[#D20A2E]'}`}>
        <Icon className="w-4 h-4" />
      </div>
    </div>
    <div className="relative mt-3 flex items-baseline gap-2 flex-wrap">
      <span className={`text-2xl sm:text-3xl font-bold tabular-nums tracking-tight ${hero ? 'text-white' : 'text-[color:var(--c-ink)]'}`}>
        <CountUp value={value} suffix={suffix} />
      </span>
      {children}
    </div>
    <p className={`relative mt-1 text-[11px] ${hero ? 'text-white/70' : 'text-[color:var(--c-muted)]'}`}>{hint}</p>
  </div>
);

export const MetricCards: React.FC<MetricCardsProps> = ({ metrics }) => (
  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
    <Stat label="Tickets abiertos" value={metrics.openTickets} icon={Inbox} hint="En cola para intervención humana" delay={0} hero>
      <span className="text-xs font-semibold text-white flex items-center gap-0.5 bg-white/15 rounded-full px-2 py-0.5">
        <AlertCircle className="w-3 h-3" />
        {metrics.urgentTickets} urgentes
      </span>
    </Stat>

    <Stat label="Tiempo prom. de resolución" value={metrics.avgResolutionTime} icon={Clock} hint="Desde la derivación al cierre en Corestream" delay={70}>
    </Stat>

    <Stat label="Resueltas por el bot hoy" value={metrics.botResolvedToday} icon={Bot} hint={`De ${metrics.totalConversationsToday} consultas atendidas`} delay={140}>
      <span className="text-xs font-semibold text-[#D20A2E] tabular-nums bg-[color:var(--c-ch100)] rounded-full px-2 py-0.5">
        {metrics.botResolutionRate}% efectividad
      </span>
    </Stat>

    <Stat label="Tasa de derivación" value={metrics.escalationRate} suffix="%" icon={GitFork} hint="Casos transferidos a Corestream" delay={210}>
    </Stat>
  </div>
);
