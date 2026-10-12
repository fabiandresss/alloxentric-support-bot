import React, { useState, useEffect, useRef } from 'react';
import { 
  MessageSquare, 
  Send, 
  Sparkles, 
  AlertTriangle, 
  ArrowRight, 
  Bot, 
  User, 
  RotateCcw, 
  CheckCircle2, 
  ExternalLink,
  ChevronDown,
  Building2,
  ShieldAlert,
  Headphones,
  Paperclip,
  Smile,
  Zap,
  Info
} from 'lucide-react';
import { Company, ChatMessage } from '../types';
import { probeChat } from '../api/client';

interface WidgetPreviewProps {
  companies: Company[];
  selectedCompanyId?: string;
  onNavigateToConsole: (ticketId?: string) => void;
  onTicketCreated?: () => void;
}

interface DemoMessage {
  id: string;
  sender: 'user' | 'bot';
  text: string;
  timestamp: string;
  ragSource?: string;
  confidenceScore?: number;
  isEscalation?: boolean;
}

export const WidgetPreview: React.FC<WidgetPreviewProps> = ({
  companies,
  selectedCompanyId: initialCompanyId,
  onNavigateToConsole,
  onTicketCreated,
}) => {
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>(
    initialCompanyId || (companies[0]?.id ?? '')
  );

  const selectedCompany = companies.find((c) => c.id === selectedCompanyId) || companies[0];

  // Conversación REAL contra el backend (POST /empresas/{slug}/probar)
  const [messages, setMessages] = useState<DemoMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [linkedTicketNumber, setLinkedTicketNumber] = useState<string | undefined>(undefined);
  const [escalated, setEscalated] = useState<boolean>(false);
  const [isTyping, setIsTyping] = useState<boolean>(false);
  const [inputText, setInputText] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const welcome = (): DemoMessage[] => [
    {
      id: 'welcome',
      sender: 'bot',
      text: `¡Hola! Soy ${selectedCompany?.agentName ?? 'el asistente'}, el asistente con IA de ${
        selectedCompany?.name ?? 'la empresa'
      }. ¿En qué puedo ayudarte hoy?`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ];

  const handleReset = () => {
    setMessages(welcome());
    setConversationId(undefined);
    setLinkedTicketNumber(undefined);
    setEscalated(false);
    setIsTyping(false);
    setError(null);
  };

  // Sync selected company if prop changes
  useEffect(() => {
    if (initialCompanyId) setSelectedCompanyId(initialCompanyId);
  }, [initialCompanyId]);

  // Reiniciar la conversación al cambiar de empresa
  useEffect(() => {
    handleReset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCompanyId]);

  // Auto-scroll when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping, escalated]);

  const toDemo = (m: ChatMessage): DemoMessage => ({
    id: m.id,
    sender: m.sender === 'user' ? 'user' : 'bot',
    text: m.message,
    timestamp: m.timestamp,
    ragSource: m.ragSources?.[0],
    confidenceScore: m.confidenceScore,
    isEscalation: m.isEscalationNotice,
  });

  const send = async (text: string, escalate = false) => {
    if (!selectedCompany || !text.trim() || isTyping) return;
    setError(null);
    setIsTyping(true);
    try {
      const res = await probeChat(selectedCompany.id, {
        message: text,
        conversationId,
        escalate,
        customerName: 'Visitante (simulador)',
      });
      setConversationId(res.conversationId);
      setMessages((prev) => [...prev, ...res.messages.map(toDemo)]);
      if (res.derived) {
        setEscalated(true);
        setLinkedTicketNumber(res.ticketNumber);
        onTicketCreated?.();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsTyping(false);
    }
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    const text = inputText.trim();
    if (!text) return;
    setInputText('');
    send(text);
  };

  // El usuario pide explícitamente hablar con una persona
  const handleConnectHuman = () => send('Quiero hablar con un agente humano.', true);

  return (
    <div className="space-y-6">
      {/* Top Header & Company Selector */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-[#E2E8F0] shadow-xs">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#EEF2FF] flex items-center justify-center text-[#4F46E5]">
              <MessageSquare className="w-4 h-4" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-[#1E1B4B]">
              Vista previa del widget (Usuario final)
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#CCFBF1] text-[#0D9488] border border-[#99F6E4]">
              Simulación RAG en vivo
            </span>
          </div>
          <p className="text-xs text-[#64748B] mt-1 max-w-2xl">
            Comprueba visualmente la experiencia de un cliente final interactuando con el chatbot de cada tenant SaaS y el momento exacto en que una consulta sin respuesta en el RAG es derivada a Corestream.
          </p>
        </div>

        {/* Company Selector Chips */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-[#1E1B4B] flex items-center gap-1">
            <Building2 className="w-3.5 h-3.5 text-[#4F46E5]" />
            Empresa:
          </span>
          <div className="flex items-center gap-1.5 p-1 bg-[#F1F5F9] rounded-xl flex-wrap">
            {companies.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  setSelectedCompanyId(c.id);
                  handleReset();
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
                  selectedCompanyId === c.id
                    ? 'bg-white text-[#1E1B4B] shadow-xs font-semibold'
                    : 'text-[#64748B] hover:text-[#1E1B4B]'
                }`}
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: c.brandColor }}
                ></span>
                <span>{c.name}</span>
              </button>
            ))}
          </div>

          <button
            onClick={handleReset}
            title="Reiniciar diálogo"
            className="p-2 text-[#64748B] hover:text-[#4F46E5] hover:bg-[#EEF2FF] rounded-lg border border-[#E2E8F0] transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Preview Container: Simulated Client Website Canvas with Floating Widget */}
      <div className="relative rounded-2xl border border-[#CBD5E1] bg-gradient-to-b from-[#F8FAFC] to-[#EFF6FF] overflow-hidden min-h-[640px] shadow-sm flex flex-col justify-between">
        {/* Mock Host Website Navigation Bar */}
        <div className="bg-white/90 backdrop-blur-md border-b border-[#E2E8F0] px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center font-black text-xs shadow-xs"
              style={{ backgroundColor: selectedCompany.brandBg, color: selectedCompany.brandColor }}
            >
              {selectedCompany.logoInitials}
            </div>
            <div>
              <span className="text-xs font-bold text-[#1E1B4B]">
                {selectedCompany.name} Portal Oficial
              </span>
              <span className="text-[10px] text-[#64748B] block">
                {selectedCompany.industry}
              </span>
            </div>
          </div>

          <div className="hidden sm:flex items-center gap-6 text-xs text-[#64748B]">
            <span className="hover:text-[#1E1B4B] cursor-pointer">Servicios</span>
            <span className="hover:text-[#1E1B4B] cursor-pointer">Especialidades</span>
            <span className="hover:text-[#1E1B4B] cursor-pointer">Mi Cuenta</span>
            <span className="px-2.5 py-1 rounded-md bg-[#F1F5F9] text-[#1E1B4B] font-semibold text-[11px]">
              Sesión Iniciada: Paciente
            </span>
          </div>
        </div>

        {/* Mock Host Website Content Banner */}
        <div className="p-8 max-w-3xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-white/80 border border-[#E2E8F0] text-[#1E1B4B] shadow-2xs mb-3">
            <span className="w-2 h-2 rounded-full bg-[#22C55E]"></span>
            <span>Atención digital activa 24/7</span>
          </div>
          <h2 className="text-2xl font-black text-[#1E1B4B] tracking-tight">
            Bienvenido al portal de autoservicio de {selectedCompany.name}
          </h2>
          <p className="text-xs text-[#64748B] mt-2 leading-relaxed max-w-xl">
            Puedes realizar consultas administrativas, revisar el estado de tus coberturas y recibir orientación en tiempo real a través del asistente virtual en la esquina inferior derecha.
          </p>

          {/* Quick Mock Portal Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-6">
            <div className="bg-white/80 backdrop-blur-xs p-3.5 rounded-xl border border-[#E2E8F0] shadow-2xs">
              <span className="text-[11px] font-bold text-[#1E1B4B] block">Telemedicina HD</span>
              <span className="text-[10px] text-[#64748B]">Médicos generales y pediatría</span>
            </div>
            <div className="bg-white/80 backdrop-blur-xs p-3.5 rounded-xl border border-[#E2E8F0] shadow-2xs">
              <span className="text-[11px] font-bold text-[#1E1B4B] block">Reembolsos Isapre</span>
              <span className="text-[10px] text-[#64748B]">Descarga con código I-Med</span>
            </div>
            <div className="bg-white/80 backdrop-blur-xs p-3.5 rounded-xl border border-[#E2E8F0] shadow-2xs">
              <span className="text-[11px] font-bold text-[#1E1B4B] block">Mesa Corestream</span>
              <span className="text-[10px] text-[#22C55E] font-semibold">Guardia disponible</span>
            </div>
          </div>
        </div>

        {/* FLOATING CHAT WIDGET (Intercom / Zendesk style) */}
        <div className="self-end mr-4 mb-4 sm:mr-8 sm:mb-8 w-full max-w-[390px] bg-white rounded-2xl border border-[#CBD5E1] shadow-2xl flex flex-col overflow-hidden z-20 animate-in slide-in-from-bottom-4 duration-300">
          {/* Widget Header */}
          <div 
            className="p-4 border-b border-[#E2E8F0] text-white flex items-center justify-between shadow-xs"
            style={{ 
              backgroundColor: selectedCompany.brandColor 
            }}
          >
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-9 h-9 rounded-xl bg-white/20 backdrop-blur-xs flex items-center justify-center font-bold text-xs text-white border border-white/30">
                  {selectedCompany.logoInitials}
                </div>
                <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#22C55E] border-2 border-white"></span>
              </div>

              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-xs leading-none">
                    {selectedCompany.agentName}
                  </span>
                  {/* Teal Badge Asistente IA */}
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-[#14B8A6] text-white shadow-2xs">
                    <Sparkles className="w-2.5 h-2.5" />
                    Asistente IA
                  </span>
                </div>
                <span className="text-[10px] text-white/80 mt-0.5 block">
                  Responde en segundos con base RAG
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1 text-white/80 hover:text-white">
              <span className="text-[10px] font-mono opacity-80">{selectedCompany.version}</span>
            </div>
          </div>

          {/* Conversation History Area */}
          <div className="p-4 space-y-3.5 max-h-[380px] min-h-[340px] overflow-y-auto bg-[#F8FAFC]">
            {/* Encryption & RAG security notice */}
            <div className="text-center">
              <span className="inline-flex items-center gap-1 text-[10px] text-[#64748B] bg-white px-2.5 py-1 rounded-full border border-[#E2E8F0]">
                <Zap className="w-3 h-3 text-[#14B8A6]" />
                Conversación conectada al motor RAG de {selectedCompany.name}
              </span>
            </div>

            {/* Messages */}
            {messages.map((msg) => {
              const isUser = msg.sender === 'user';

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed shadow-2xs ${
                      isUser
                        ? 'bg-[#4F46E5] text-white rounded-br-xs'
                        : msg.isEscalation
                        ? 'bg-[#FFFBEB] text-[#92400E] border border-[#FDE68A] rounded-bl-xs'
                        : 'bg-white text-[#1E1B4B] border border-[#E2E8F0] rounded-bl-xs'
                    }`}
                  >
                    {/* Bot Escalation Warning Badge if needed */}
                    {msg.isEscalation && (
                      <div className="mb-2 pb-1.5 border-b border-[#FDE68A] flex items-center gap-1.5 text-[11px] font-bold text-[#B45309]">
                        <AlertTriangle className="w-3.5 h-3.5 text-[#F59E0B]" />
                        <span>Derivación a soporte humano requerida</span>
                      </div>
                    )}

                    <p className="whitespace-pre-line">{msg.text}</p>

                    {/* RAG Source Citation Badge */}
                    {msg.ragSource && (
                      <div className="mt-2 pt-1.5 border-t border-[#E2E8F0] flex items-center justify-between text-[10px] text-[#64748B]">
                        <span className="truncate max-w-[190px] font-mono text-[#0D9488]">
                          📄 {msg.ragSource}
                        </span>
                        {msg.confidenceScore && (
                          <span className="font-semibold text-[#14B8A6] ml-2">
                            {Math.round(msg.confidenceScore * 100)}% RAG
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Message timestamp */}
                  <span className="text-[10px] text-[#94A3B8] mt-1 px-1">
                    {msg.timestamp}
                  </span>

                  {/* If this is the escalation message, show the action CTA */}
                  {msg.isEscalation && (
                    <div className="w-full mt-2 p-3 bg-white rounded-xl border border-[#FCD34D] shadow-sm space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-[#1E1B4B] flex items-center gap-1.5">
                          <Headphones className="w-3.5 h-3.5 text-[#F59E0B]" />
                          Mesa de ayuda Corestream
                        </span>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#FEF3C7] text-[#D97706]">
                          Prioridad Alta
                        </span>
                      </div>

                      <p className="text-[11px] text-[#64748B] leading-relaxed">
                        Un operador humano recibirá el historial completo de esta conversación para continuar tu atención sin que tengas que repetir tus datos.
                      </p>

                      <div className="space-y-2 pt-1 border-t border-[#E2E8F0]">
                        <div className="flex items-center gap-2 text-xs font-bold text-[#22C55E]">
                          <CheckCircle2 className="w-4 h-4 text-[#22C55E]" />
                          <span>¡Ticket {linkedTicketNumber} derivado a Corestream!</span>
                        </div>
                        <p className="text-[11px] text-[#64748B]">
                          Caso ingresado en la cola de agentes humanos con transcript íntegro.
                        </p>

                        <button
                          onClick={() => onNavigateToConsole(linkedTicketNumber)}
                          className="w-full py-2 px-3 bg-[#EEF2FF] hover:bg-[#E0E7FF] text-[#4F46E5] text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 border border-[#C7D2FE]"
                        >
                          <span>Ver este ticket en la Consola de Soporte</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Typing Indicator */}
            {isTyping && (
              <div className="flex items-center gap-2 text-[#64748B] text-xs py-1">
                <div className="w-6 h-6 rounded-full bg-[#EEF2FF] text-[#4F46E5] flex items-center justify-center">
                  <Bot className="w-3.5 h-3.5" />
                </div>
                <div className="flex items-center gap-1 px-3 py-2 bg-white rounded-2xl border border-[#E2E8F0] shadow-2xs">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#4F46E5] animate-bounce"></span>
                  <span className="w-1.5 h-1.5 rounded-full bg-[#14B8A6] animate-bounce [animation-delay:0.2s]"></span>
                  <span className="w-1.5 h-1.5 rounded-full bg-[#4F46E5] animate-bounce [animation-delay:0.4s]"></span>
                  <span className="text-[11px] text-[#64748B] ml-1.5 font-medium">
                    {selectedCompany.agentName} escribiendo...
                  </span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {error && (
            <div className="px-3 py-2 bg-[#FEF2F2] border-t border-[#FCA5A5] text-[11px] text-[#991B1B]">
              {error}
            </div>
          )}
          {!escalated && messages.length > 1 && (
            <div className="px-3 pt-2 bg-white border-t border-[#F1F5F9]">
              <button
                type="button"
                onClick={handleConnectHuman}
                disabled={isTyping}
                className="text-[11px] font-semibold text-[#B45309] hover:text-[#92400E] flex items-center gap-1.5 disabled:opacity-50"
              >
                <Headphones className="w-3.5 h-3.5" />
                ¿Prefieres hablar con una persona?
              </button>
            </div>
          )}

          {/* Widget Input Area */}
          <form
            onSubmit={handleSendMessage}
            className="p-3 bg-white border-t border-[#E2E8F0] flex items-center gap-2"
          >
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Escribe tu mensaje para el asistente..."
              className="flex-1 text-xs py-2 px-3 bg-[#F8FAFC] border border-[#CBD5E1] rounded-xl focus:outline-none focus:border-[#4F46E5] focus:bg-white text-[#1E1B4B] placeholder:text-[#94A3B8]"
            />
            <button
              type="submit"
              disabled={!inputText.trim()}
              className={`p-2 rounded-xl text-white transition-all ${
                inputText.trim()
                  ? 'bg-[#4F46E5] hover:bg-[#4338CA] cursor-pointer shadow-xs'
                  : 'bg-[#CBD5E1] cursor-not-allowed'
              }`}
            >
              <Send className="w-4 h-4" />
            </button>
          </form>

          {/* Footer branding */}
          <div className="px-3 py-1.5 bg-[#F8FAFC] border-t border-[#F1F5F9] text-center text-[10px] text-[#94A3B8] flex items-center justify-center gap-1">
            <span>Powered by</span>
            <span className="font-bold text-[#4F46E5]">Alloxentric RAG Gateway</span>
            <span>·</span>
            <span>Corestream</span>
          </div>
        </div>
      </div>
    </div>
  );
};
