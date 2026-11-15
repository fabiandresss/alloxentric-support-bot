import React, { useEffect, useState } from 'react';
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  Bot,
  Clock,
  Building2,
  PieChart as PieIcon,
  Loader2
} from 'lucide-react';
import { Analytics } from '../types';
import { getAnalytics } from '../api/client';

const RANGES = [
  { days: 7, label: 'Últimos 7 días' },
  { days: 14, label: 'Últimos 14 días' },
  { days: 30, label: 'Últimos 30 días' },
] as const;

/** Datos reales (GET /metricas/analitica): el backend ya filtra por empresa según el rol. */
export const AnalyticsView: React.FC = () => {
  const [days, setDays] = useState<number>(14);
  const [activeBarIndex, setActiveBarIndex] = useState<number | null>(null);
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let vivo = true;
    setLoading(true);
    getAnalytics(days)
      .then((d) => {
        if (!vivo) return;
        setData(d);
        setError(null);
      })
      .catch((e) => vivo && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => vivo && setLoading(false));
    return () => {
      vivo = false;
    };
  }, [days]);

  if (!data) {
    return (
      <div className="py-24 text-center text-xs text-[color:var(--c-muted)]">
        {error ? (
          <span className="text-[color:var(--c-rtx)]">No se pudo cargar la analítica: {error}</span>
        ) : (
          <span className="inline-flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Cargando analítica…
          </span>
        )}
      </div>
    );
  }

  const totalConversations = data.totalConversations;
  const botRate = data.botRate.toFixed(1);
  const escalationRate = data.escalationRate.toFixed(1);
  const dailyData = data.daily;
  const maxDaily = Math.max(1, ...dailyData.map((d) => d.total));
  const companyAnalytics = data.companies;
  const top = [...companyAnalytics].sort((a, b) => b.totalQueries - a.totalQueries)[0];
  const delta = data.conversationsDelta;
  const labelEvery = dailyData.length > 14 ? 3 : 1; // con 30 barras se muestra una etiqueta de cada 3

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[color:var(--c-ink)]">
            {companyAnalytics.length > 1 ? 'Analítica global de soporte' : `Analítica de soporte · ${companyAnalytics[0]?.name ?? ''}`}
          </h1>
          <p className="text-xs text-[color:var(--c-muted)] mt-1">
            Rendimiento del motor RAG, volumen de consultas automatizadas y derivaciones a la mesa de ayuda Corestream.
          </p>
        </div>

        {/* Time period filter */}
        <div className="flex items-center gap-1 p-1 bg-[color:var(--c-soft)] rounded-xl self-start">
          {RANGES.map((r) => (
            <button
              key={r.days}
              onClick={() => setDays(r.days)}
              disabled={loading}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                days === r.days
                  ? 'bg-white text-[color:var(--c-ink)] shadow-xs'
                  : 'text-[color:var(--c-muted)] hover:text-[color:var(--c-ink)]'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Cross-Company High Level Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 1. Conversaciones totales */}
        <div className="bg-white rounded-xl border border-[color:var(--c-line)] p-4 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[color:var(--c-muted)]">Conversaciones totales</span>
            <div className="w-8 h-8 rounded-lg bg-[color:var(--c-ch100)] flex items-center justify-center text-[#D20A2E]">
              <BarChart3 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-[color:var(--c-ink)] tabular-nums">
              {totalConversations.toLocaleString()}
            </span>
            {delta != null && (
              <span
                className={`text-xs font-semibold flex items-center gap-0.5 ${
                  delta >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]'
                }`}
              >
                {delta >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {delta >= 0 ? '+' : ''}
                {delta}%
              </span>
            )}
          </div>
          <p className="text-[11px] text-[color:var(--c-muted)] mt-1">
            {companyAnalytics.length === 1 ? 'En tu empresa' : `En ${companyAnalytics.length} empresas cliente`}
            {delta != null ? ' · vs periodo anterior' : ''}
          </p>
        </div>

        {/* 2. % Resueltas por Bot vs Derivadas */}
        <div className="bg-white rounded-xl border border-[color:var(--c-line)] p-4 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[color:var(--c-muted)]">Resolución por Bot (RAG)</span>
            <div className="w-8 h-8 rounded-lg bg-[color:var(--c-gbg)] flex items-center justify-center text-[#22C55E]">
              <Bot className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-[#22C55E] tabular-nums">
              {botRate}%
            </span>
            <span className="text-xs text-[color:var(--c-muted)]">
              vs {escalationRate}% derivado
            </span>
          </div>
          <div className="mt-2 w-full h-1.5 bg-[color:var(--c-soft)] rounded-full overflow-hidden flex">
            <div className="h-full bg-[#22C55E]" style={{ width: `${botRate}%` }}></div>
            <div className="h-full bg-[#F59E0B]" style={{ width: `${escalationRate}%` }}></div>
          </div>
        </div>

        {/* 3. Tiempo promedio de resolución */}
        <div className="bg-white rounded-xl border border-[color:var(--c-line)] p-4 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[color:var(--c-muted)]">Tiempo prom. resolución</span>
            <div className="w-8 h-8 rounded-lg bg-[color:var(--c-ch150)] flex items-center justify-center text-[#B00825]">
              <Clock className="w-4 h-4 text-[#E8405F]" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-[color:var(--c-ink)] tabular-nums">
              {data.avgHumanResolution}
            </span>
            <span className="text-xs text-[color:var(--c-muted)]">(atención humana)</span>
          </div>
        </div>

        {/* 4. Empresa con más volumen */}
        <div className="bg-white rounded-xl border border-[color:var(--c-line)] p-4 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[color:var(--c-muted)]">Mayor volumen de tráfico</span>
            <div className="w-8 h-8 rounded-lg bg-[color:var(--c-ch100)] flex items-center justify-center text-[#D20A2E]">
              <Building2 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-xl font-bold text-[color:var(--c-ink)]">
              {top && top.totalQueries > 0 ? top.name : '—'}
            </span>
            <span className="text-xs font-semibold text-[#D20A2E] tabular-nums">
              {top && top.totalQueries > 0 ? `${top.totalQueries.toLocaleString()} cons.` : 'sin consultas'}
            </span>
          </div>
        </div>
      </div>

      {/* Main Bar Chart: Conversations per day (Stacked: Bot vs Human) */}
      <div className="bg-white rounded-2xl border border-[color:var(--c-line)] p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h3 className="text-sm font-bold text-[color:var(--c-ink)] flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-[#D20A2E]" />
              Volumen diario de conversaciones (Últimos {data.days} días)
            </h3>
            <p className="text-xs text-[color:var(--c-muted)] mt-0.5">
              Comparativa entre respuestas resueltas por el bot RAG y casos derivados a agentes Corestream.
            </p>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 text-xs font-medium">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-xs bg-[#22C55E]"></span>
              <span className="text-[color:var(--c-ink)]">Resuelto por Bot</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-xs bg-[#F59E0B]"></span>
              <span className="text-[color:var(--c-ink)]">Derivado a Humano (Corestream)</span>
            </div>
          </div>
        </div>

        {/* Stacked Bars Visualizer */}
        <div className="pt-4 pb-2">
          <div className="h-64 flex items-end justify-between gap-1 sm:gap-2 border-b border-[color:var(--c-line)] pb-2 relative overflow-hidden">
            {dailyData.map((d, index) => {
              const totalHeightPercent = (d.total / maxDaily) * 100;
              const botHeightPercent = d.total ? (d.bot / d.total) * 100 : 0;
              const humanHeightPercent = d.total ? (d.human / d.total) * 100 : 0;

              return (
                <div
                  key={d.date}
                  onMouseEnter={() => setActiveBarIndex(index)}
                  onMouseLeave={() => setActiveBarIndex(null)}
                  className="flex-1 flex flex-col items-center h-full justify-end group cursor-pointer relative"
                >
                  {/* Tooltip on hover */}
                  {activeBarIndex === index && (
                    <div className="absolute -top-20 z-20 bg-[color:var(--c-ink)] text-white p-2.5 rounded-xl shadow-xl text-[11px] whitespace-nowrap pointer-events-none animate-in fade-in zoom-in-95">
                      <div className="font-bold border-b border-white/20 pb-1 mb-1">
                        {d.date} · {d.total.toLocaleString()} total
                      </div>
                      <div className="flex items-center gap-1.5 text-[#22C55E]">
                        <span>● Bot:</span>
                        <span className="font-bold">{d.bot.toLocaleString()}</span>
                        <span>({Math.round(botHeightPercent)}%)</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[#F59E0B]">
                        <span>● Humano:</span>
                        <span className="font-bold">{d.human.toLocaleString()}</span>
                        <span>({Math.round(humanHeightPercent)}%)</span>
                      </div>
                    </div>
                  )}

                  {/* Stacked bar column */}
                  <div
                    className="w-full max-w-[36px] rounded-t-md overflow-hidden flex flex-col justify-end transition-all group-hover:brightness-110 group-hover:scale-y-[1.02]"
                    style={{ height: `${totalHeightPercent}%` }}
                  >
                    {/* Top part: Human Escalated (Amber) */}
                    <div
                      className="bg-[#F59E0B] w-full transition-all"
                      style={{ height: `${humanHeightPercent}%` }}
                    ></div>
                    {/* Bottom part: Bot Resolved (Green) */}
                    <div
                      className="bg-[#22C55E] w-full transition-all"
                      style={{ height: `${botHeightPercent}%` }}
                    ></div>
                  </div>

                  {/* X Axis Label */}
                  <span className="text-[10px] text-[color:var(--c-muted)] mt-2 block font-medium group-hover:text-[color:var(--c-ink)] whitespace-nowrap">
                    {index % labelEvery === 0 || index === dailyData.length - 1 ? d.date : '\u00A0'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Company Breakdown Section: Full Width Comparison among 5 Companies */}
      <div className="bg-white rounded-2xl border border-[color:var(--c-line)] p-6 shadow-xs">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-[color:var(--c-ink)] flex items-center gap-2">
              <PieIcon className="w-4 h-4 text-[#E8405F]" />
              Comparativa de resolución por empresa ({companyAnalytics.length} {companyAnalytics.length === 1 ? 'tenant' : 'tenants'})
            </h3>
            <p className="text-xs text-[color:var(--c-muted)] mt-0.5">
              Desglose de eficiencia del chatbot con RAG en cada organización cliente.
            </p>
          </div>
          <span className="text-xs text-[#D20A2E] font-semibold bg-[color:var(--c-ch100)] px-2.5 py-1 rounded-lg">
            Promedio: {botRate}%
          </span>
        </div>

        <div className="space-y-4">
          {companyAnalytics.map((comp) => (
            <div
              key={comp.id}
              className="p-3.5 rounded-xl border border-[color:var(--c-line)] hover:border-[color:var(--c-line2)] transition-all bg-[color:var(--c-canvas)]"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2.5">
                  <span
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: comp.brandColor }}
                  ></span>
                  <span className="text-xs font-bold text-[color:var(--c-ink)]">
                    {comp.name}
                  </span>
                  <span className="text-[10px] text-[color:var(--c-muted)]">
                    ({comp.industry})
                  </span>
                </div>

                <div className="flex items-center gap-3 text-xs">
                  <span className="text-[color:var(--c-muted)] font-mono text-[11px]">
                    {comp.totalQueries.toLocaleString()} consultas
                  </span>
                  <span className="font-bold text-[#22C55E] bg-[#22C55E]/10 px-2 py-0.5 rounded-md border border-[#22C55E]/30">
                    {comp.botRate}% Bot
                  </span>
                  <span className="font-bold text-[#F59E0B] bg-[#F59E0B]/10 px-2 py-0.5 rounded-md border border-[#F59E0B]/30">
                    {comp.escalationRate}% Humano
                  </span>
                </div>
              </div>

              {/* Progress bar */}
              <div className="w-full h-2 bg-[color:var(--c-line)] rounded-full overflow-hidden flex">
                <div
                  className="h-full bg-[#22C55E] rounded-l-full"
                  style={{ width: `${comp.botRate}%` }}
                  title={`Resuelto por bot: ${comp.botRate}%`}
                ></div>
                <div
                  className="h-full bg-[#F59E0B] rounded-r-full"
                  style={{ width: `${comp.escalationRate}%` }}
                  title={`Derivado a Corestream: ${comp.escalationRate}%`}
                ></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
