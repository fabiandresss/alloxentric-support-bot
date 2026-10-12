import React, { useState } from 'react';
import { 
  BarChart3, 
  TrendingUp, 
  Bot, 
  Clock, 
  Building2, 
  PieChart as PieIcon
} from 'lucide-react';
import { Company } from '../types';

interface AnalyticsViewProps {
  companies: Company[];
}

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({ companies }) => {
  const [timeRange, setTimeRange] = useState<'7d' | '14d' | '30d'>('14d');
  const [activeBarIndex, setActiveBarIndex] = useState<number | null>(null);

  // Cross-company summary figures
  const totalConversations = 34180;
  const botResolvedCount = 30454;
  const humanEscalatedCount = 3726;
  const botRate = ((botResolvedCount / totalConversations) * 100).toFixed(1);
  const escalationRate = ((humanEscalatedCount / totalConversations) * 100).toFixed(1);

  // 14 days mock trend data
  const dailyData = [
    { date: '09 Sep', bot: 1820, human: 210, total: 2030 },
    { date: '10 Sep', bot: 1940, human: 230, total: 2170 },
    { date: '11 Sep', bot: 2100, human: 260, total: 2360 },
    { date: '12 Sep', bot: 2050, human: 245, total: 2295 },
    { date: '13 Sep', bot: 1680, human: 180, total: 1860 },
    { date: '14 Sep', bot: 1450, human: 150, total: 1600 },
    { date: '15 Sep', bot: 2240, human: 270, total: 2510 },
    { date: '16 Sep', bot: 2310, human: 290, total: 2600 },
    { date: '17 Sep', bot: 2420, human: 280, total: 2700 },
    { date: '18 Sep', bot: 2390, human: 310, total: 2700 },
    { date: '19 Sep', bot: 2510, human: 295, total: 2805 },
    { date: '20 Sep', bot: 1780, human: 190, total: 1970 },
    { date: '21 Sep', bot: 1620, human: 175, total: 1795 },
    { date: 'Hoy', bot: 2640, human: 320, total: 2960 },
  ];

  const maxDaily = Math.max(...dailyData.map((d) => d.total));

  // Company comparative data
  const companyAnalytics = [
    {
      id: 'wellq',
      name: 'WellQ',
      industry: 'Salud Digital',
      brandColor: '#0284C7',
      totalQueries: 8420,
      botResolved: 7510,
      botRate: 89.2,
      escalated: 910,
      escalationRate: 10.8,
    },
    {
      id: 'alloxentric',
      name: 'Alloxentric',
      industry: 'Omnicanalidad & Voz',
      brandColor: '#4F46E5',
      totalQueries: 14210,
      botResolved: 13002,
      botRate: 91.5,
      escalated: 1208,
      escalationRate: 8.5,
    },
    {
      id: 'dani-eth',
      name: 'Dani ETH',
      industry: 'Web3 & Fintech',
      brandColor: '#7C3AED',
      totalQueries: 3820,
      botResolved: 3212,
      botRate: 84.1,
      escalated: 608,
      escalationRate: 15.9,
    },
    {
      id: 'dani27001',
      name: 'Dani27001',
      industry: 'Ciberseguridad ISO',
      brandColor: '#0D9488',
      totalQueries: 2610,
      botResolved: 2297,
      botRate: 88.0,
      escalated: 313,
      escalationRate: 12.0,
    },
    {
      id: 'aprueba',
      name: 'Aprueba',
      industry: 'EdTech & PAES',
      brandColor: '#EA580C',
      totalQueries: 5120,
      botResolved: 4424,
      botRate: 86.4,
      escalated: 696,
      escalationRate: 13.6,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#1E1B4B]">
            Analítica global de soporte
          </h1>
          <p className="text-xs text-[#64748B] mt-1">
            Rendimiento del motor RAG, volumen de consultas automatizadas y derivaciones a la mesa de ayuda Corestream.
          </p>
        </div>

        {/* Time period filter */}
        <div className="flex items-center gap-1 p-1 bg-[#F1F5F9] rounded-xl self-start">
          {(['7d', '14d', '30d'] as const).map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                timeRange === range
                  ? 'bg-white text-[#1E1B4B] shadow-xs'
                  : 'text-[#64748B] hover:text-[#1E1B4B]'
              }`}
            >
              {range === '7d' ? 'Últimos 7 días' : range === '14d' ? 'Últimos 14 días' : 'Últimos 30 días'}
            </button>
          ))}
        </div>
      </div>

      {/* Cross-Company High Level Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 1. Conversaciones totales */}
        <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[#64748B]">Conversaciones totales</span>
            <div className="w-8 h-8 rounded-lg bg-[#EEF2FF] flex items-center justify-center text-[#4F46E5]">
              <BarChart3 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-[#1E1B4B] tabular-nums">
              {totalConversations.toLocaleString()}
            </span>
            <span className="text-xs font-semibold text-[#22C55E] flex items-center gap-0.5">
              <TrendingUp className="w-3 h-3" />
              +18.4%
            </span>
          </div>
          <p className="text-[11px] text-[#64748B] mt-1">
            En 5 empresas cliente conectadas
          </p>
        </div>

        {/* 2. % Resueltas por Bot vs Derivadas */}
        <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[#64748B]">Resolución por Bot (RAG)</span>
            <div className="w-8 h-8 rounded-lg bg-[#F0FDF4] flex items-center justify-center text-[#22C55E]">
              <Bot className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-[#22C55E] tabular-nums">
              {botRate}%
            </span>
            <span className="text-xs text-[#64748B]">
              vs {escalationRate}% derivado
            </span>
          </div>
          <div className="mt-2 w-full h-1.5 bg-[#F1F5F9] rounded-full overflow-hidden flex">
            <div className="h-full bg-[#22C55E]" style={{ width: `${botRate}%` }}></div>
            <div className="h-full bg-[#F59E0B]" style={{ width: `${escalationRate}%` }}></div>
          </div>
        </div>

        {/* 3. Tiempo promedio de resolución */}
        <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[#64748B]">Tiempo prom. resolución</span>
            <div className="w-8 h-8 rounded-lg bg-[#CCFBF1] flex items-center justify-center text-[#0D9488]">
              <Clock className="w-4 h-4 text-[#14B8A6]" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-[#1E1B4B] tabular-nums">
              3m 48s
            </span>
            <span className="text-xs text-[#64748B]">
              (humano) / <strong className="text-[#0D9488]">1.6s</strong> (bot)
            </span>
          </div>
        </div>

        {/* 4. Empresa con más volumen */}
        <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[#64748B]">Mayor volumen de tráfico</span>
            <div className="w-8 h-8 rounded-lg bg-[#EEF2FF] flex items-center justify-center text-[#4F46E5]">
              <Building2 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-xl font-bold text-[#1E1B4B]">
              Alloxentric
            </span>
            <span className="text-xs font-semibold text-[#4F46E5] tabular-nums">
              14,210 cons.
            </span>
          </div>
        </div>
      </div>

      {/* Main Bar Chart: Conversations per day (Stacked: Bot vs Human) */}
      <div className="bg-white rounded-2xl border border-[#E2E8F0] p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h3 className="text-sm font-bold text-[#1E1B4B] flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-[#4F46E5]" />
              Volumen diario de conversaciones (Últimos 14 días)
            </h3>
            <p className="text-xs text-[#64748B] mt-0.5">
              Comparativa entre respuestas resueltas por el bot RAG y casos derivados a agentes Corestream.
            </p>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 text-xs font-medium">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-xs bg-[#22C55E]"></span>
              <span className="text-[#1E1B4B]">Resuelto por Bot</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-xs bg-[#F59E0B]"></span>
              <span className="text-[#1E1B4B]">Derivado a Humano (Corestream)</span>
            </div>
          </div>
        </div>

        {/* Stacked Bars Visualizer */}
        <div className="pt-4 pb-2">
          <div className="h-64 flex items-end justify-between gap-2 border-b border-[#E2E8F0] pb-2 relative">
            {dailyData.map((d, index) => {
              const totalHeightPercent = (d.total / maxDaily) * 100;
              const botHeightPercent = (d.bot / d.total) * 100;
              const humanHeightPercent = (d.human / d.total) * 100;

              return (
                <div
                  key={d.date}
                  onMouseEnter={() => setActiveBarIndex(index)}
                  onMouseLeave={() => setActiveBarIndex(null)}
                  className="flex-1 flex flex-col items-center h-full justify-end group cursor-pointer relative"
                >
                  {/* Tooltip on hover */}
                  {activeBarIndex === index && (
                    <div className="absolute -top-20 z-20 bg-[#1E1B4B] text-white p-2.5 rounded-xl shadow-xl text-[11px] whitespace-nowrap pointer-events-none animate-in fade-in zoom-in-95">
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
                  <span className="text-[10px] text-[#64748B] mt-2 block font-medium group-hover:text-[#1E1B4B]">
                    {d.date}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Company Breakdown Section: Full Width Comparison among 5 Companies */}
      <div className="bg-white rounded-2xl border border-[#E2E8F0] p-6 shadow-xs">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-[#1E1B4B] flex items-center gap-2">
              <PieIcon className="w-4 h-4 text-[#14B8A6]" />
              Comparativa de resolución por empresa (5 Tenants)
            </h3>
            <p className="text-xs text-[#64748B] mt-0.5">
              Desglose de eficiencia del chatbot con RAG en cada organización cliente.
            </p>
          </div>
          <span className="text-xs text-[#4F46E5] font-semibold bg-[#EEF2FF] px-2.5 py-1 rounded-lg">
            Promedio: 88.2%
          </span>
        </div>

        <div className="space-y-4">
          {companyAnalytics.map((comp) => (
            <div
              key={comp.id}
              className="p-3.5 rounded-xl border border-[#E2E8F0] hover:border-[#CBD5E1] transition-all bg-[#F8FAFC]"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2.5">
                  <span
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: comp.brandColor }}
                  ></span>
                  <span className="text-xs font-bold text-[#1E1B4B]">
                    {comp.name}
                  </span>
                  <span className="text-[10px] text-[#64748B]">
                    ({comp.industry})
                  </span>
                </div>

                <div className="flex items-center gap-3 text-xs">
                  <span className="text-[#64748B] font-mono text-[11px]">
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
              <div className="w-full h-2 bg-[#E2E8F0] rounded-full overflow-hidden flex">
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
