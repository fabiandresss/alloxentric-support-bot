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
  Check,
  Loader2,
  RefreshCw,
  ThumbsDown,
  ThumbsUp
} from 'lucide-react';
import { Ticket, ChatMessage, AssignableAgent, TicketSummary } from '../types';
import { regenerateTicketSummary } from '../api/client';

const URGENCIA = {
  alta: { label: 'Urgencia alta', cls: 'bg-[color:var(--c-rbg2)] text-[color:var(--c-rtx2)] border-[color:var(--c-rline)]' },
  media: { label: 'Urgencia media', cls: 'bg-[color:var(--c-abg2)] text-[color:var(--c-atx2)] border-[color:var(--c-aline)]' },
  baja: { label: 'Urgencia baja', cls: 'bg-[color:var(--c-gbg2)] text-[color:var(--c-gtx)] border-[color:var(--c-gline)]' },
} as const;

interface TicketDetailModalProps {
  ticket: Ticket;
  agents: AssignableAgent[]; // usuarios de la empresa del ticket
  currentUserName: string;
  canManageEscalated: boolean;
  onClose: () => void;
  onStatusChange: (ticketId: string, newStatus: Ticket['status']) => void;
  onSendMessage: (ticketId: string, text: string) => void;
  onReassign: (ticketId: string, agentId: string | null, agentName: string) => void;
  /** Abre el fragmento citado en la base de conocimiento (solo si el rol tiene esa vista). */
  onOpenSource?: (companyId: string, documentId: string, fragmentId?: string) => void;
}

export const TicketDetailModal: React.FC<TicketDetailModalProps> = ({
  ticket,
  agents,
  currentUserName,
  canManageEscalated,
  onClose,
  onStatusChange,
  onSendMessage,
  onReassign,
  onOpenSource,
}) => {
  const [replyText, setReplyText] = useState(ticket.aiSuggestion.draftResponse);
  const [summary, setSummary] = useState<TicketSummary | undefined>(ticket.aiSummary);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const refreshSummary = async () => {
    setSummaryBusy(true);
    setSummaryError(null);
    try {
      setSummary((await regenerateTicketSummary(ticket.id)).aiSummary);
    } catch (e) {
      setSummaryError(e instanceof Error ? e.message : 'No se pudo generar el resumen');
    } finally {
      setSummaryBusy(false);
    }
  };
  const [isCopiedSuggestion, setIsCopiedSuggestion] = useState(false);
  const [showAssignDropdown, setShowAssignDropdown] = useState(false);

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

  const abierto = ticket.status === 'pendiente' || ticket.status === 'urgente' || ticket.status === 'esperando_cliente';
  const puedeResponder = abierto;
  const motivoCierre = {
    confirmado_cliente: 'el cliente confirmó que se resolvió',
    sin_respuesta: 'el cliente no respondió la encuesta en 72 h',
    gestion_manual: 'cerrado por la gestión de la empresa tras escalarlo',
    migrado: 'cerrado antes de la encuesta de resolución',
  }[ticket.closeReason ?? 'migrado'];

  const statusBadge = {
    cerrado: { bg: 'bg-[#22C55E]/10', text: 'text-[#22C55E]', border: 'border-[#22C55E]/30', label: 'Cerrado' },
    esperando_cliente: { bg: 'bg-[#D20A2E]/10', text: 'text-[#D20A2E]', border: 'border-[#D20A2E]/30', label: 'Esperando cliente' },
    escalado: { bg: 'bg-[color:var(--c-ink2)]/10', text: 'text-[color:var(--c-ink2)]', border: 'border-[color:var(--c-ink2)]/30', label: 'Escalado a gestión' },
    pendiente: { bg: 'bg-[#F59E0B]/10', text: 'text-[#F59E0B]', border: 'border-[#F59E0B]/30', label: 'Pendiente' },
    urgente: { bg: 'bg-[#EF4444]/10', text: 'text-[#EF4444]', border: 'border-[#EF4444]/30', label: 'Urgente' },
  }[ticket.status];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[color:var(--c-ink)]/40 backdrop-blur-xs animate-in fade-in duration-200">
      <div 
        className="bg-white rounded-2xl border border-[color:var(--c-line)] shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-[color:var(--c-line)] flex items-center justify-between bg-white shrink-0">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs font-bold text-[#D20A2E] bg-[color:var(--c-ch100)] px-2.5 py-1 rounded-md border border-[color:var(--c-ch200)]">
              {ticket.ticketNumber}
            </span>
            <span
              className="text-xs font-medium px-2 py-0.5 rounded-md"
              style={{ backgroundColor: `color-mix(in srgb, ticket.companyColor 14%, transparent)`, color: ticket.companyColor }}
            >
              {ticket.companyName}
            </span>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${statusBadge.bg} ${statusBadge.text} ${statusBadge.border}`}>
              {statusBadge.label}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Quick Actions */}
            {abierto && (
            <button
              onClick={() => onStatusChange(ticket.id, 'urgente')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                ticket.status === 'urgente'
                  ? 'bg-[#EF4444] text-white'
                  : 'bg-[color:var(--c-rbg)] text-[#EF4444] border border-[#EF4444]/30 hover:bg-[#EF4444] hover:text-white'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Marcar urgente</span>
            </button>
            )}

            <div className="relative">
              <button
                onClick={() => setShowAssignDropdown(!showAssignDropdown)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[color:var(--c-canvas)] border border-[color:var(--c-line)] text-[color:var(--c-ink)] hover:border-[#D20A2E] transition-colors flex items-center gap-1.5"
              >
                <UserCheck className="w-3.5 h-3.5 text-[#D20A2E]" />
                <span>{ticket.assignedAgent || 'Reasignar'}</span>
              </button>

              {showAssignDropdown && (
                <div className="absolute right-0 mt-1 w-48 bg-white border border-[color:var(--c-line)] rounded-lg shadow-lg py-1 z-30">
                  <div className="px-3 py-1 text-[11px] font-semibold text-[color:var(--c-muted)] uppercase">
                    Asignar agente Corestream
                  </div>
                  {agents.length === 0 && (
                    <div className="px-3 py-1.5 text-xs text-[color:var(--c-muted)]">No hay agentes activos en esta empresa</div>
                  )}
                  {agents.map((ag) => (
                    <button
                      key={ag.id}
                      onClick={() => {
                        onReassign(ticket.id, ag.id, ag.name);
                        setShowAssignDropdown(false);
                      }}
                      className="w-full text-left px-3 py-1.5 text-xs text-[color:var(--c-ink)] hover:bg-[color:var(--c-ch100)] hover:text-[#D20A2E] flex items-center justify-between"
                    >
                      <span>{ag.name}</span>
                      {ticket.assignedAgentId === ag.id && <Check className="w-3.5 h-3.5 text-[#D20A2E]" />}
                    </button>
                  ))}
                  {ticket.assignedAgentId && (
                    <button
                      onClick={() => {
                        onReassign(ticket.id, null, 'Sin asignar');
                        setShowAssignDropdown(false);
                      }}
                      className="w-full text-left px-3 py-1.5 text-xs text-[color:var(--c-muted)] hover:bg-[color:var(--c-soft)] border-t border-[color:var(--c-line)] mt-1"
                    >
                      Dejar sin asignar
                    </button>
                  )}
                </div>
              )}
            </div>

            <button
              onClick={onClose}
              className="p-1.5 text-[color:var(--c-muted)] hover:text-[color:var(--c-ink)] hover:bg-[color:var(--c-soft)] rounded-lg transition-colors ml-2"
              title="Cerrar modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Subheader with Customer & Escalation Info */}
        <div className="px-6 py-3 bg-[color:var(--c-canvas)] border-b border-[color:var(--c-line)] flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
          <div className="flex items-center gap-4">
            <div>
              <span className="text-[color:var(--c-muted)]">Cliente: </span>
              <span className="font-semibold text-[color:var(--c-ink)]">{ticket.customerName}</span>
              <span className="text-[color:var(--c-faint)] ml-1">({ticket.customerEmail})</span>
            </div>
            <div className="text-[color:var(--c-muted)]">
              <span>Canal: </span>
              <span className="font-medium text-[color:var(--c-ink)]">{ticket.customerChannel}</span>
            </div>
            <div className="text-[color:var(--c-muted)] flex items-center gap-1">
              <Clock className="w-3 h-3 text-[color:var(--c-muted)]" />
              <span>{ticket.exactTimestamp} ({ticket.relativeTime})</span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-[#DC2626] font-medium bg-[color:var(--c-rbg)] px-2.5 py-1 rounded-md border border-[color:var(--c-rbg2)]">
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Motivo: {ticket.escalationReason}</span>
          </div>
        </div>

        {/* Modal Body: Split into Chat Transcript and AI Suggestion Panel */}
        <div className="flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-[color:var(--c-line)]">
          {/* Left Column: Full Chat Transcript (7 cols) */}
          <div className="lg:col-span-7 p-6 flex flex-col justify-between bg-white overflow-y-auto">
            <div>
              <div className="flex items-center justify-between pb-3 mb-4 border-b border-[color:var(--c-line)]">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-[color:var(--c-muted)]">
                  Transcripción de la Conversación
                </h4>
                <span className="text-[11px] text-[color:var(--c-muted)]">
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
                        className="my-3 p-3 rounded-xl bg-[color:var(--c-abg)] border border-[color:var(--c-aline)] text-xs text-[color:var(--c-atx2)] flex items-start gap-2.5"
                      >
                        <AlertTriangle className="w-4 h-4 text-[#D97706] shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold text-[color:var(--c-atx)]">
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
                            isAgent ? 'bg-[#D20A2E]' : 'bg-[#E8405F]'
                          }`}
                        >
                          {isAgent ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
                        </div>
                      )}

                      <div
                        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-xs leading-relaxed ${
                          isUser
                            ? 'bg-[#D20A2E] text-white rounded-br-xs'
                            : isAgent
                            ? 'bg-[color:var(--c-ch100)] text-[color:var(--c-ink)] border border-[color:var(--c-ch200)] rounded-bl-xs'
                            : 'bg-[color:var(--c-canvas)] text-[color:var(--c-ink)] border border-[color:var(--c-line)] rounded-bl-xs'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3 text-[10px] opacity-75 mb-1">
                          <span className="font-semibold">{msg.senderName}</span>
                          <span>{msg.timestamp}</span>
                        </div>
                        <p>{msg.message}</p>

                        {/* Fuentes citadas: con su fragmento se pueden abrir en la base de conocimiento */}
                        {msg.sourceDetails && msg.sourceDetails.length > 0 ? (
                          <div className="mt-2 pt-1.5 border-t border-[color:var(--c-line)] space-y-1" data-testid="msg-sources">
                            {msg.sourceDetails.map((d, i) => (
                              <div key={i} className="text-[10px] flex items-start gap-1">
                                <FileText className="w-3 h-3 mt-0.5 shrink-0 text-[#B00825]" />
                                {onOpenSource && d.documentId ? (
                                  <button onClick={() => onOpenSource(ticket.companyId, d.documentId!, d.fragmentId)} title="Abrir el fragmento en la base de conocimiento"
                                    className="text-left font-mono text-[#B00825] hover:underline">{d.documentName}{d.order !== undefined ? ` #${d.order}` : ''}{d.page ? ` · p. ${d.page}` : ''}</button>
                                ) : <span className="font-mono text-[#B00825]">{d.documentName}{d.order !== undefined ? ` #${d.order}` : ''}{d.page ? ` · p. ${d.page}` : ''}</span>}
                              </div>
                            ))}
                          </div>
                        ) : msg.ragSources && msg.ragSources.length > 0 && (
                          <div className="mt-2 pt-1.5 border-t border-[color:var(--c-line)] text-[10px] text-[#B00825] flex items-center gap-1 font-mono">
                            <FileText className="w-3 h-3" />
                            <span>Fuente: {msg.ragSources[0]}</span>
                          </div>
                        )}
                        {msg.rating && (
                          <div data-testid="msg-rating" className={`mt-1.5 inline-flex items-center gap-1 text-[10px] font-semibold ${msg.rating === 'up' ? 'text-[color:var(--c-gtx)]' : 'text-[color:var(--c-rtx2)]'}`}>
                            {msg.rating === 'up' ? <ThumbsUp className="w-3 h-3" /> : <ThumbsDown className="w-3 h-3" />}
                            El cliente {msg.rating === 'up' ? 'valoró bien' : 'valoró mal'} esta respuesta{msg.ratingComment ? `: «${msg.ratingComment}»` : ''}
                          </div>
                        )}
                      </div>

                      {isUser && (
                        <div className="w-7 h-7 rounded-full bg-[color:var(--c-line)] text-[color:var(--c-ink)] flex items-center justify-center shrink-0 text-xs font-semibold">
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
          <div className="lg:col-span-5 p-6 bg-[color:var(--c-canvas)] flex flex-col justify-between overflow-y-auto">
            <div className="space-y-4">
              {/* Resumen con IA: qué pasó, por qué se derivó y qué urgencia parece */}
              <div className="bg-white rounded-xl border border-[color:var(--c-line)] p-4 shadow-sm" data-testid="ticket-summary">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[color:var(--c-ink)]">
                    <Sparkles className="w-3.5 h-3.5 text-[#D20A2E]" /> Resumen del caso
                    {summary && <span className="text-[9px] font-semibold uppercase tracking-wide text-[color:var(--c-faint)]">{summary.source === 'ia' ? 'IA' : 'automático'}</span>}
                  </span>
                  <button onClick={refreshSummary} disabled={summaryBusy} data-testid="summary-refresh" title={summary ? 'Volver a generar el resumen' : 'Generar el resumen'}
                    className="px-2 py-1 rounded-lg border border-[color:var(--c-line)] text-[11px] font-semibold text-[color:var(--c-muted)] hover:text-[#D20A2E] flex items-center gap-1 disabled:opacity-50">
                    {summaryBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} {summary ? 'Actualizar' : 'Generar'}
                  </button>
                </div>
                {summary ? (
                  <>
                    <p className="text-xs text-[color:var(--c-ink)] leading-relaxed">{summary.summary}</p>
                    {summary.reason && <p className="mt-1.5 text-[11px] text-[color:var(--c-muted)]"><strong className="text-[color:var(--c-ink)]">Por qué una persona:</strong> {summary.reason}</p>}
                    <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                      <span data-testid="summary-urgency" className={`px-2 py-0.5 rounded-full text-[11px] font-bold border ${URGENCIA[summary.urgency].cls}`}>{URGENCIA[summary.urgency].label}</span>
                      {summary.urgency === 'alta' && ticket.status === 'pendiente' && (
                        <button onClick={() => onStatusChange(ticket.id, 'urgente')} className="text-[11px] font-semibold text-[#D20A2E] hover:underline">Marcar como urgente</button>
                      )}
                    </div>
                  </>
                ) : <p className="text-xs text-[color:var(--c-muted)]">Este caso aún no tiene resumen. Genéralo para ver en segundos qué pasó y qué urgencia parece.</p>}
                {summaryError && <p className="mt-2 text-[11px] text-[color:var(--c-rtx)]">{summaryError}</p>}
              </div>

              {/* AI Suggestion Card */}
              <div className="bg-white rounded-xl border border-[color:var(--c-ch150)] p-4 shadow-sm relative overflow-hidden">
                <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-[#E8405F]/10 to-transparent pointer-events-none rounded-bl-full"></div>

                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#E8405F]/15 text-[#B00825] border border-[#E8405F]/30">
                      <Sparkles className="w-3 h-3 text-[#E8405F]" />
                      Sugerencia de respuesta IA
                    </span>
                    <span className="text-[10px] font-mono text-[color:var(--c-muted)]">
                      {Math.round(ticket.aiSuggestion.confidence * 100)}% confianza
                    </span>
                  </div>

                  <button
                    onClick={handleUseAiSuggestion}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-[#B00825] hover:bg-[color:var(--c-ch150)]/50 rounded-lg transition-colors border border-[#E8405F]/30"
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

                <p className="text-xs text-[color:var(--c-ink)] leading-relaxed mb-2.5 italic bg-[color:var(--c-ch50)] p-2.5 rounded-lg border border-[color:var(--c-ch150)]/60">
                  "{ticket.aiSuggestion.draftResponse}"
                </p>

                <div className="text-[11px] text-[color:var(--c-muted)] flex items-start gap-1 pt-1 border-t border-[color:var(--c-line)]">
                  <FileText className="w-3.5 h-3.5 text-[#E8405F] shrink-0 mt-0.5" />
                  <span className="line-clamp-2">
                    <strong className="text-[color:var(--c-ink)]">Documento base:</strong> {ticket.aiSuggestion.sourceDoc}
                  </span>
                </div>
              </div>

              {ticket.status === 'esperando_cliente' && (
                <div className="rounded-xl border border-[color:var(--c-ch350)] bg-[color:var(--c-ch100)] p-3 text-xs text-[#3730A3]">
                  <strong>Encuesta enviada.</strong> Esperando que el cliente confirme si se resolvió. Si dice que sí, el ticket se cierra
                  y no se reabre; si dice que no, se escala a gestión; si no responde en 72 h, se cierra solo.
                </div>
              )}
              {ticket.status === 'cerrado' && (
                <div className="rounded-xl border border-[color:var(--c-gline)] bg-[color:var(--c-gbg)] p-3 text-xs text-[color:var(--c-gtx)]">
                  <strong>Ticket cerrado:</strong> {motivoCierre}. No se puede reabrir; si el cliente vuelve a escribir, se crea un ticket nuevo.
                </div>
              )}
              {ticket.status === 'escalado' && (
                <div className="rounded-xl border border-[color:var(--c-line2)] bg-[color:var(--c-soft2)] p-3 text-xs text-[color:var(--c-ink3)] space-y-2">
                  <p>
                    <strong>Escalado a gestión:</strong> el cliente indicó que su consulta no se resolvió. Ya no lo atienden el bot ni el
                    encargado de tickets; se gestiona fuera del chat (contacto directo con el cliente).
                  </p>
                  {canManageEscalated && (
                    <button
                      onClick={() => onStatusChange(ticket.id, 'cerrado')}
                      className="px-3 py-1.5 rounded-lg bg-[color:var(--c-ink2)] hover:bg-[color:var(--c-ink3)] text-white font-semibold"
                    >
                      Cerrar ticket (ya gestionado)
                    </button>
                  )}
                </div>
              )}

              {puedeResponder && (
              <div className="bg-white rounded-xl border border-[color:var(--c-line)] p-4 shadow-sm space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-[color:var(--c-ink)]">
                  <span>Respuesta del agente humano</span>
                  <span className="text-[11px] font-normal text-[color:var(--c-muted)]">
                    Canal: {ticket.customerChannel}
                  </span>
                </div>

                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Escribe la respuesta para el cliente o ajusta la sugerencia de la IA..."
                  rows={6}
                  className="w-full text-xs text-[color:var(--c-ink)] p-3 border border-[color:var(--c-line)] rounded-lg focus:outline-none focus:border-[#D20A2E] focus:ring-1 focus:ring-[#D20A2E] leading-relaxed transition-all resize-none"
                />

                <div className="flex items-center justify-between pt-1">
                  <span className="text-[11px] text-[color:var(--c-muted)]">
                    Se enviará como <strong className="text-[color:var(--c-ink)]">{currentUserName}</strong> junto con la encuesta «¿se resolvió tu consulta?»
                  </span>

                  <button
                    onClick={handleSend}
                    disabled={!replyText.trim()}
                    className="flex items-center gap-1.5 px-4 py-2 bg-[#D20A2E] hover:bg-[#B00825] disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition-all shadow-xs"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Enviar respuesta y encuesta</span>
                  </button>
                </div>
              </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
