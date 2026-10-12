import React from 'react';
import { 
  Inbox, 
  Clock, 
  Bot, 
  GitFork, 
  TrendingUp, 
  TrendingDown, 
  AlertCircle 
} from 'lucide-react';
import { SystemMetrics } from '../types';

interface MetricCardsProps {
  metrics: SystemMetrics;
}

export const MetricCards: React.FC<MetricCardsProps> = ({ metrics }) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {/* 1. Tickets abiertos */}
      <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 shadow-[0_1px_3px_rgba(0,0,0,0.02)] hover:border-[#4F46E5]/40 transition-colors">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-[#64748B]">Tickets abiertos</span>
          <div className="w-8 h-8 rounded-lg bg-[#EEF2FF] flex items-center justify-center text-[#4F46E5]">
            <Inbox className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl font-bold text-[#1E1B4B] tabular-nums">
            {metrics.openTickets}
          </span>
          <span className="text-xs font-semibold text-[#EF4444] flex items-center gap-0.5">
            <AlertCircle className="w-3 h-3" />
            {metrics.urgentTickets} urgentes
          </span>
        </div>
        <p className="mt-1 text-[11px] text-[#64748B]">
          En cola para intervención humana
        </p>
      </div>

      {/* 2. Tiempo promedio de resolución */}
      <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 shadow-[0_1px_3px_rgba(0,0,0,0.02)] hover:border-[#4F46E5]/40 transition-colors">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-[#64748B]">Tiempo prom. de resolución</span>
          <div className="w-8 h-8 rounded-lg bg-[#F0FDF4] flex items-center justify-center text-[#22C55E]">
            <Clock className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl font-bold text-[#1E1B4B] tabular-nums">
            {metrics.avgResolutionTime}
          </span>
          <span className="text-xs font-medium text-[#22C55E] flex items-center gap-0.5">
            <TrendingDown className="w-3 h-3" />
            -32s hoy
          </span>
        </div>
        <p className="mt-1 text-[11px] text-[#64748B]">
          Desde la derivación al cierre en Corestream
        </p>
      </div>

      {/* 3. Conversaciones resueltas por el bot hoy */}
      <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 shadow-[0_1px_3px_rgba(0,0,0,0.02)] hover:border-[#14B8A6]/40 transition-colors">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-[#64748B]">Resueltas por el bot hoy</span>
          <div className="w-8 h-8 rounded-lg bg-[#CCFBF1] flex items-center justify-center text-[#0D9488]">
            <Bot className="w-4 h-4 text-[#14B8A6]" />
          </div>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl font-bold text-[#1E1B4B] tabular-nums">
            {metrics.botResolvedToday}
          </span>
          <span className="text-xs font-semibold text-[#14B8A6] tabular-nums">
            {metrics.botResolutionRate}% efectividad
          </span>
        </div>
        <p className="mt-1 text-[11px] text-[#64748B]">
          De {metrics.totalConversationsToday} consultas atendidas
        </p>
      </div>

      {/* 4. Tasa de derivación a humano */}
      <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 shadow-[0_1px_3px_rgba(0,0,0,0.02)] hover:border-[#4F46E5]/40 transition-colors">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-[#64748B]">Tasa de derivación</span>
          <div className="w-8 h-8 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] flex items-center justify-center text-[#64748B]">
            <GitFork className="w-4 h-4 text-[#4F46E5]" />
          </div>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl font-bold text-[#1E1B4B] tabular-nums">
            {metrics.escalationRate}%
          </span>
          <span className="text-xs font-medium text-[#22C55E] flex items-center gap-0.5">
            <TrendingDown className="w-3 h-3" />
            -1.8% vs ayer
          </span>
        </div>
        <p className="mt-1 text-[11px] text-[#64748B]">
          Casos transferidos a Corestream
        </p>
      </div>
    </div>
  );
};
