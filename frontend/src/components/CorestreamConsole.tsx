import React, { useState } from 'react';
import { 
  Inbox, 
  Clock, 
  AlertCircle, 
  CheckCircle2, 
  ArrowRight, 
  ShieldAlert, 
  Sparkles, 
  Filter,
  RefreshCw,
  Search,
  MessageSquare
} from 'lucide-react';
import { Ticket, SystemMetrics, AssignableAgent } from '../types';
import { TicketDetailModal } from './TicketDetailModal';

interface CorestreamConsoleProps {
  tickets: Ticket[];
  agents: AssignableAgent[];
  currentUserName: string;
  metrics?: SystemMetrics;
  onUpdateTicketStatus: (ticketId: string, status: Ticket['status']) => void;
  onSendAgentReply: (ticketId: string, text: string) => void;
  onReassignAgent: (ticketId: string, agentId: string | null, agentName: string) => void;
  selectedTenantFilter: string;
  searchQuery: string;
  onResetFilters: () => void;
}

export const CorestreamConsole: React.FC<CorestreamConsoleProps> = ({
  tickets,
  agents,
  currentUserName,
  onUpdateTicketStatus,
  onSendAgentReply,
  onReassignAgent,
  selectedTenantFilter,
  searchQuery,
  onResetFilters,
}) => {
  const [statusFilter, setStatusFilter] = useState<'all' | 'urgente' | 'pendiente' | 'resuelto'>('all');
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);

  // Filter logic
  const filteredTickets = tickets.filter((ticket) => {
    // Tenant filter
    if (selectedTenantFilter !== 'all' && ticket.companyId !== selectedTenantFilter) {
      return false;
    }

    // Status filter
    if (statusFilter !== 'all' && ticket.status !== statusFilter) {
      return false;
    }

    // Search query filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchNumber = ticket.ticketNumber.toLowerCase().includes(q);
      const matchCustomer = ticket.customerName.toLowerCase().includes(q);
      const matchExcerpt = ticket.userQueryExcerpt.toLowerCase().includes(q);
      const matchReason = ticket.escalationReason.toLowerCase().includes(q);
      const matchCompany = ticket.companyName.toLowerCase().includes(q);
      return matchNumber || matchCustomer || matchExcerpt || matchReason || matchCompany;
    }

    return true;
  });

  const pendingCount = tickets.filter((t) => t.status === 'pendiente' || t.status === 'urgente').length;

  const getStatusBadge = (status: Ticket['status']) => {
    switch (status) {
      case 'resuelto':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#22C55E]/10 text-[#22C55E] border border-[#22C55E]/30">
            <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E]"></span>
            Resuelto
          </span>
        );
      case 'urgente':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#EF4444]/10 text-[#EF4444] border border-[#EF4444]/30 animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-[#EF4444]"></span>
            Urgente
          </span>
        );
      case 'pendiente':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#F59E0B]/10 text-[#F59E0B] border border-[#F59E0B]/30">
            <span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B]"></span>
            Pendiente
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#1E1B4B]">
            Consola de soporte
          </h1>
          <p className="text-xs text-[#64748B] mt-1">
            Gestión y resolución humana de consultas derivadas por el chatbot con RAG a través de la ticketera Corestream.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {selectedTenantFilter !== 'all' && (
            <button
              onClick={onResetFilters}
              className="text-xs text-[#4F46E5] hover:underline font-medium px-2 py-1"
            >
              Limpiar filtro ({selectedTenantFilter})
            </button>
          )}
        </div>
      </div>

      {/* Main Status Filters Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-[#E2E8F0]">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-[#1E1B4B] flex items-center gap-1.5 mr-1">
            <Filter className="w-3.5 h-3.5 text-[#4F46E5]" />
            Estado:
          </span>
          {(['all', 'urgente', 'pendiente', 'resuelto'] as const).map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-all ${
                statusFilter === st
                  ? 'bg-[#1E1B4B] text-white shadow-xs font-semibold'
                  : 'bg-white text-[#64748B] hover:bg-[#F8FAFC] border border-[#E2E8F0] hover:text-[#1E1B4B]'
              }`}
            >
              {st === 'all' ? 'Todos' : st.charAt(0).toUpperCase() + st.slice(1)}
              {st === 'urgente' && (
                <span className="ml-1.5 px-1.5 py-0.2 rounded-full text-[10px] bg-[#EF4444]/20 text-[#EF4444] font-bold">
                  {tickets.filter((t) => t.status === 'urgente').length}
                </span>
              )}
              {st === 'pendiente' && (
                <span className="ml-1.5 px-1.5 py-0.2 rounded-full text-[10px] bg-[#F59E0B]/20 text-[#F59E0B] font-bold">
                  {tickets.filter((t) => t.status === 'pendiente').length}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="text-xs text-[#64748B]">
          Mostrando <span className="font-semibold text-[#1E1B4B]">{filteredTickets.length}</span> tickets
        </div>
      </div>

      {/* Ticket List Cards */}
      {filteredTickets.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-12 text-center">
          <div className="w-12 h-12 rounded-full bg-[#EEF2FF] text-[#4F46E5] flex items-center justify-center mx-auto mb-3">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-semibold text-[#1E1B4B]">
            No hay tickets que coincidan con estos criterios
          </h3>
          <p className="text-xs text-[#64748B] mt-1 max-w-sm mx-auto">
            Todos los casos bajo este filtro han sido resueltos o no se encontraron coincidencias en la búsqueda.
          </p>
          <button
            onClick={() => {
              setStatusFilter('all');
              onResetFilters();
            }}
            className="mt-4 px-3.5 py-1.5 text-xs font-semibold text-[#4F46E5] bg-[#EEF2FF] rounded-lg hover:bg-[#E0E7FF] transition-colors"
          >
            Restablecer todos los filtros
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredTickets.map((ticket) => (
            <div
              key={ticket.id}
              onClick={() => setSelectedTicket(ticket)}
              className="bg-white rounded-xl border border-[#E2E8F0] p-5 shadow-[0_1px_3px_rgba(0,0,0,0.02)] hover:shadow-md hover:border-[#4F46E5]/50 transition-all cursor-pointer flex flex-col justify-between group relative overflow-hidden"
            >
              {/* Top Accent Line for Urgent */}
              {ticket.status === 'urgente' && (
                <div className="absolute top-0 left-0 right-0 h-1 bg-[#EF4444]"></div>
              )}

              <div>
                {/* Header of Card */}
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Badge de empresa */}
                    <span
                      className="text-xs font-semibold px-2.5 py-0.5 rounded-md"
                      style={{ backgroundColor: ticket.companyBg, color: ticket.companyColor }}
                    >
                      {ticket.companyName}
                    </span>

                    {/* ID del ticket */}
                    <span className="font-mono text-xs font-bold text-[#64748B]">
                      {ticket.ticketNumber}
                    </span>
                  </div>

                  {/* Estado del ticket */}
                  {getStatusBadge(ticket.status)}
                </div>

                {/* Extracto de la consulta del usuario */}
                <h3 className="text-xs font-semibold text-[#1E1B4B] group-hover:text-[#4F46E5] transition-colors line-clamp-2 leading-snug">
                  "{ticket.userQueryExcerpt}"
                </h3>

                {/* Motivo de la derivación */}
                <div className="mt-3 p-2.5 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] text-xs text-[#64748B] flex items-start gap-2">
                  <ShieldAlert className="w-3.5 h-3.5 text-[#F59E0B] shrink-0 mt-0.5" />
                  <p className="line-clamp-2 leading-relaxed">
                    <strong className="text-[#1E1B4B]">Motivo de derivación: </strong>
                    {ticket.escalationReason}
                  </p>
                </div>
              </div>

              {/* Footer of Card */}
              <div className="mt-4 pt-3 border-t border-[#E2E8F0] flex items-center justify-between text-[11px] text-[#64748B]">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-[#1E1B4B]">{ticket.customerName}</span>
                  <span>·</span>
                  <span className="text-[#94A3B8]">{ticket.customerChannel}</span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1 tabular-nums">
                    <Clock className="w-3 h-3 text-[#94A3B8]" />
                    {ticket.relativeTime}
                  </span>
                  <span className="text-[#4F46E5] font-semibold group-hover:translate-x-0.5 transition-transform flex items-center">
                    Atender <ArrowRight className="w-3 h-3 ml-0.5" />
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Ticket Detail Modal */}
      {selectedTicket && (
        <TicketDetailModal
          ticket={selectedTicket}
          agents={agents.filter((a) => a.companyId === selectedTicket.companyId)}
          onClose={() => setSelectedTicket(null)}
          onStatusChange={(id, newStatus) => {
            onUpdateTicketStatus(id, newStatus);
            setSelectedTicket((prev) => (prev && prev.id === id ? { ...prev, status: newStatus } : prev));
          }}
          onSendMessage={(id, text) => {
            onSendAgentReply(id, text);
            // Append message locally to transcript in modal
            setSelectedTicket((prev) => {
              if (!prev || prev.id !== id) return prev;
              const newMsg = {
                id: `msg-${Date.now()}`,
                sender: 'agent' as const,
                senderName: currentUserName,
                message: text,
                timestamp: 'Ahora',
              };
              return {
                ...prev,
                transcript: [...prev.transcript, newMsg],
              };
            });
          }}
          onReassign={(id, agentId, agentName) => {
            onReassignAgent(id, agentId, agentName);
            setSelectedTicket((prev) =>
              prev && prev.id === id
                ? { ...prev, assignedAgent: agentId ? agentName : 'Sin asignar', assignedAgentId: agentId ?? undefined }
                : prev
            );
          }}
        />
      )}
    </div>
  );
};
