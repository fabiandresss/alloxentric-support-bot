import React, { useState } from 'react';
import { 
  X, 
  Sparkles, 
  Send, 
  CheckCircle, 
  AlertTriangle, 
  UserCheck, 
  Clock, 
  Bot, 
  User, 
  FileText, 
  ShieldAlert, 
  ArrowUpRight,
  Copy,
  Check
} from 'lucide-react';
import { Ticket, ChatMessage } from '../types';

interface TicketDetailModalProps {
  ticket: Ticket;
  onClose: () => void;
  onStatusChange: (ticketId: string, newStatus: Ticket['status']) => void;
  onSendMessage: (ticketId: string, text: string) => void;
  onReassign: (ticketId: string, agentName: string) => void;
}

export const TicketDetailModal: React.FC<TicketDetailModalProps> = ({
  ticket,
  onClose,
  onStatusChange,
  onSendMessage,
  onReassign,
}) => {
  const [replyText, setReplyText] = useState(ticket.aiSuggestion.draftResponse);
  const [isCopiedSuggestion, setIsCopiedSuggestion] = useState(false);
  const [showAssignDropdown, setShowAssignDropdown] = useState(false);

  const availableAgents = ['Felipe Armijo', 'Carla Fuentes', 'Tomás Vergara', 'Mesa Nivel 3'];

  const handleUseAiSuggestion = () => {
    setReplyText(ticket.aiSuggestion.draftResponse);
    setIsCopiedSuggestion(true);
    setTimeout(() => setIsCopiedSuggestion(false), 2000);
  };

  const handleSend = () => {
    if (!replyText.trim()) return;
    onSendMessage(ticket.id, replyText);
    setReplyText('');
  };

  const statusBadge = {
    resuelto: { bg: 'bg-[#22C55E]/10', text: 'text-[#22C55E]', border: 'border-[#22C55E]/30', label: 'Resuelto' },
    pendiente: { bg: 'bg-[#F59E0B]/10', text: 'text-[#F59E0B]', border: 'border-[#F59E0B]/30', label: 'Pendiente' },
    urgente: { bg: 'bg-[#EF4444]/10', text: 'text-[#EF4444]', border: 'border-[#EF4444]/30', label: 'Urgente' },
  }[ticket.status];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#1E1B4B]/40 backdrop-blur-xs animate-in fade-in duration-200">
      <div 
        className="bg-white rounded-2xl border border-[#E2E8F0] shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-[#E2E8F0] flex items-center justify-between bg-white shrink-0">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs font-bold text-[#4F46E5] bg-[#EEF2FF] px-2.5 py-1 rounded-md border border-[#E0E7FF]">
              {ticket.ticketNumber}
            </span>
            <span
              className="text-xs font-medium px-2 py-0.5 rounded-md"
              style={{ backgroundColor: ticket.companyBg, color: ticket.companyColor }}
            >
              {ticket.companyName}
            </span>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${statusBadge.bg} ${statusBadge.text} ${statusBadge.border}`}>
              {statusBadge.label}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Quick Actions */}
            <button
              onClick={() => onStatusChange(ticket.id, 'resuelto')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                ticket.status === 'resuelto'
                  ? 'bg-[#22C55E] text-white'
                  : 'bg-[#F0FDF4] text-[#22C55E] border border-[#22C55E]/30 hover:bg-[#22C55E] hover:text-white'
              }`}
            >
              <CheckCircle className="w-3.5 h-3.5" />
              <span>{ticket.status === 'resuelto' ? 'Resuelto' : 'Marcar como resuelto'}</span>
            </button>

            <button
              onClick={() => onStatusChange(ticket.id, 'urgente')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                ticket.status === 'urgente'
                  ? 'bg-[#EF4444] text-white'
                  : 'bg-[#FEF2F2] text-[#EF4444] border border-[#EF4444]/30 hover:bg-[#EF4444] hover:text-white'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Escalar</span>
            </button>

            <div className="relative">
              <button
                onClick={() => setShowAssignDropdown(!showAssignDropdown)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#F8FAFC] border border-[#E2E8F0] text-[#1E1B4B] hover:border-[#4F46E5] transition-colors flex items-center gap-1.5"
              >
                <UserCheck className="w-3.5 h-3.5 text-[#4F46E5]" />
                <span>{ticket.assignedAgent || 'Reasignar'}</span>
              </button>

              {showAssignDropdown && (
                <div className="absolute right-0 mt-1 w-48 bg-white border border-[#E2E8F0] rounded-lg shadow-lg py-1 z-30">
                  <div className="px-3 py-1 text-[11px] font-semibold text-[#64748B] uppercase">
                    Asignar agente Corestream
                  </div>
                  {availableAgents.map((ag) => (
                    <button
                      key={ag}
                      onClick={() => {
                        onReassign(ticket.id, ag);
                        setShowAssignDropdown(false);
                      }}
                      className="w-full text-left px-3 py-1.5 text-xs text-[#1E1B4B] hover:bg-[#EEF2FF] hover:text-[#4F46E5] flex items-center justify-between"
                    >
                      <span>{ag}</span>
                      {ticket.assignedAgent === ag && <Check className="w-3.5 h-3.5 text-[#4F46E5]" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={onClose}
              className="p-1.5 text-[#64748B] hover:text-[#1E1B4B] hover:bg-[#F1F5F9] rounded-lg transition-colors ml-2"
              title="Cerrar modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Subheader with Customer & Escalation Info */}
        <div className="px-6 py-3 bg-[#F8FAFC] border-b border-[#E2E8F0] flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
          <div className="flex items-center gap-4">
            <div>
              <span className="text-[#64748B]">Cliente: </span>
              <span className="font-semibold text-[#1E1B4B]">{ticket.customerName}</span>
              <span className="text-[#94A3B8] ml-1">({ticket.customerEmail})</span>
            </div>
            <div className="text-[#64748B]">
              <span>Canal: </span>
              <span className="font-medium text-[#1E1B4B]">{ticket.customerChannel}</span>
            </div>
            <div className="text-[#64748B] flex items-center gap-1">
              <Clock className="w-3 h-3 text-[#64748B]" />
              <span>{ticket.exactTimestamp} ({ticket.relativeTime})</span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-[#DC2626] font-medium bg-[#FEF2F2] px-2.5 py-1 rounded-md border border-[#FEE2E2]">
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Motivo: {ticket.escalationReason}</span>
          </div>
        </div>

        {/* Modal Body: Split into Chat Transcript and AI Suggestion Panel */}
        <div className="flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-[#E2E8F0]">
          {/* Left Column: Full Chat Transcript (7 cols) */}
          <div className="lg:col-span-7 p-6 flex flex-col justify-between bg-white overflow-y-auto">
            <div>
              <div className="flex items-center justify-between pb-3 mb-4 border-b border-[#E2E8F0]">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-[#64748B]">
                  Transcripción de la Conversación
                </h4>
                <span className="text-[11px] text-[#64748B]">
                  Chatbot RAG + Derivación
                </span>
              </div>

              {/* Messages list */}
              <div className="space-y-4">
                {ticket.transcript.map((msg) => {
                  const isUser = msg.sender === 'user';
                  const isAgent = msg.sender === 'agent';
                  const isBot = msg.sender === 'bot';

                  if (msg.isEscalationNotice) {
                    return (
                      <div
                        key={msg.id}
                        className="my-3 p-3 rounded-xl bg-[#FFFBEB] border border-[#FDE68A] text-xs text-[#92400E] flex items-start gap-2.5"
                      >
                        <AlertTriangle className="w-4 h-4 text-[#D97706] shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold text-[#B45309]">
                            {msg.senderName} · {msg.timestamp}
                          </p>
                          <p className="mt-0.5">{msg.message}</p>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={msg.id}
                      className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
                    >
                      {!isUser && (
                        <div
                          className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-white text-xs ${
                            isAgent ? 'bg-[#4F46E5]' : 'bg-[#14B8A6]'
                          }`}
                        >
                          {isAgent ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
                        </div>
                      )}

                      <div
                        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-xs leading-relaxed ${
                          isUser
                            ? 'bg-[#4F46E5] text-white rounded-br-xs'
                            : isAgent
                            ? 'bg-[#EEF2FF] text-[#1E1B4B] border border-[#E0E7FF] rounded-bl-xs'
                            : 'bg-[#F8FAFC] text-[#1E1B4B] border border-[#E2E8F0] rounded-bl-xs'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3 text-[10px] opacity-75 mb-1">
                          <span className="font-semibold">{msg.senderName}</span>
                          <span>{msg.timestamp}</span>
                        </div>
                        <p>{msg.message}</p>

                        {/* RAG Source cite if bot message */}
                        {msg.ragSources && msg.ragSources.length > 0 && (
                          <div className="mt-2 pt-1.5 border-t border-[#E2E8F0] text-[10px] text-[#0D9488] flex items-center gap-1 font-mono">
                            <FileText className="w-3 h-3" />
                            <span>Fuente: {msg.ragSources[0]}</span>
                          </div>
                        )}
                      </div>

                      {isUser && (
                        <div className="w-7 h-7 rounded-full bg-[#E2E8F0] text-[#1E1B4B] flex items-center justify-center shrink-0 text-xs font-semibold">
                          {ticket.customerName.charAt(0)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right Column: AI Suggestion & Human Reply Box (5 cols) */}
          <div className="lg:col-span-5 p-6 bg-[#F8FAFC] flex flex-col justify-between overflow-y-auto">
            <div className="space-y-4">
              {/* AI Suggestion Card */}
              <div className="bg-white rounded-xl border border-[#CCFBF1] p-4 shadow-sm relative overflow-hidden">
                <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-[#14B8A6]/10 to-transparent pointer-events-none rounded-bl-full"></div>

                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#14B8A6]/15 text-[#0D9488] border border-[#14B8A6]/30">
                      <Sparkles className="w-3 h-3 text-[#14B8A6]" />
                      Sugerencia de respuesta IA
                    </span>
                    <span className="text-[10px] font-mono text-[#64748B]">
                      {Math.round(ticket.aiSuggestion.confidence * 100)}% confianza
                    </span>
                  </div>

                  <button
                    onClick={handleUseAiSuggestion}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-[#0D9488] hover:bg-[#CCFBF1]/50 rounded-lg transition-colors border border-[#14B8A6]/30"
                  >
                    {isCopiedSuggestion ? (
                      <>
                        <Check className="w-3 h-3 text-[#22C55E]" />
                        <span className="text-[#22C55E]">Aplicada</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Usar esta respuesta</span>
                      </>
                    )}
                  </button>
                </div>

                <p className="text-xs text-[#1E1B4B] leading-relaxed mb-2.5 italic bg-[#F0FDFA] p-2.5 rounded-lg border border-[#CCFBF1]/60">
                  "{ticket.aiSuggestion.draftResponse}"
                </p>

                <div className="text-[11px] text-[#64748B] flex items-start gap-1 pt-1 border-t border-[#E2E8F0]">
                  <FileText className="w-3.5 h-3.5 text-[#14B8A6] shrink-0 mt-0.5" />
                  <span className="line-clamp-2">
                    <strong className="text-[#1E1B4B]">Documento base:</strong> {ticket.aiSuggestion.sourceDoc}
                  </span>
                </div>
              </div>

              {/* Editable Response Area */}
              <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 shadow-sm space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-[#1E1B4B]">
                  <span>Respuesta del agente humano</span>
                  <span className="text-[11px] font-normal text-[#64748B]">
                    Canal: {ticket.customerChannel}
                  </span>
                </div>

                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Escribe la respuesta para el cliente o ajusta la sugerencia de la IA..."
                  rows={6}
                  className="w-full text-xs text-[#1E1B4B] p-3 border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#4F46E5] focus:ring-1 focus:ring-[#4F46E5] leading-relaxed transition-all resize-none"
                />

                <div className="flex items-center justify-between pt-1">
                  <span className="text-[11px] text-[#64748B]">
                    Se enviará como <strong className="text-[#1E1B4B]">Felipe Armijo (Agente Corestream)</strong>
                  </span>

                  <button
                    onClick={handleSend}
                    disabled={!replyText.trim()}
                    className="flex items-center gap-1.5 px-4 py-2 bg-[#4F46E5] hover:bg-[#4338CA] disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition-all shadow-xs"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Enviar respuesta</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
