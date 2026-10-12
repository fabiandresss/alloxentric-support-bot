import React, { useEffect, useRef, useState } from 'react';
import { Send, Bot, User, Headphones, X, AlertTriangle, CheckCircle2, Loader2, ThumbsUp, ThumbsDown, RotateCcw } from 'lucide-react';
import { ChatMessage, PublicAgent, TicketStatus } from '../types';
import { answerSurvey, getPublicAgent, getPublicConversation, sendPublicChat } from '../api/client';

const POLL_MS = 5000; // cada cuánto se consulta si el agente humano respondió
const storeKey = (slug: string) => `alloxentric_chat_${slug}`;

/** La conversación se recuerda en este navegador para que el cliente vuelva y vea la respuesta. */
const readStored = (slug: string): string | null => {
  try {
    return localStorage.getItem(storeKey(slug));
  } catch {
    return null;
  }
};
const writeStored = (slug: string, id: string | null) => {
  try {
    if (id) localStorage.setItem(storeKey(slug), id);
    else localStorage.removeItem(storeKey(slug));
  } catch {
    /* almacenamiento no disponible: la conversación vive solo en memoria */
  }
};

/**
 * Página pública de chat (RF-29). Se abre en /chat/{slug} y también es lo que carga el iframe
 * que crea widget.min.js (con ?embed=1 muestra el botón de cerrar y ocupa todo el iframe).
 * Habla con /publico/{slug}: no usa JWT ni API key.
 */
export const PublicChat: React.FC<{ slug: string; embed: boolean }> = ({ slug, embed }) => {
  const [agent, setAgent] = useState<PublicAgent | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [ticketNumber, setTicketNumber] = useState<string | undefined>();
  const [ticketStatus, setTicketStatus] = useState<TicketStatus | undefined>();
  const agentMsgs = useRef(0); // respuestas del agente ya vistas, para avisar solo las nuevas
  const [derived, setDerived] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getPublicAgent(slug)
      .then(setAgent)
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, [slug]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  // Mezcla lo que dice el servidor con lo que ya se ve (por id) y avisa al widget si llegó algo del agente.
  const applyServer = (c: { messages: ChatMessage[]; derived: boolean; ticketNumber?: string; ticketStatus?: TicketStatus }) => {
    setMessages((prev) => {
      const vistos = new Set(prev.map((m) => m.id));
      const nuevos = c.messages.filter((m) => !vistos.has(m.id));
      return nuevos.length ? [...prev, ...nuevos] : prev;
    });
    if (c.derived) setDerived(true);
    if (c.ticketNumber) setTicketNumber(c.ticketNumber);
    setTicketStatus(c.ticketStatus);
    const delAgente = c.messages.filter((m) => m.sender === 'agent').length;
    if (delAgente > agentMsgs.current) {
      if (embed) window.parent.postMessage({ type: 'alloxentric:unread' }, '*'); // el widget muestra un punto si está cerrado
      agentMsgs.current = delAgente;
    }
  };

  // Al volver a la página: recupera la conversación guardada (si la hay)
  useEffect(() => {
    const id = readStored(slug);
    if (!id) return;
    getPublicConversation(slug, id)
      .then((c) => {
        setConversationId(c.conversationId);
        agentMsgs.current = c.messages.filter((m) => m.sender === 'agent').length;
        setMessages(c.messages);
        applyServer(c);
      })
      .catch(() => writeStored(slug, null)); // ya no existe: se empieza de cero
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  // Con el caso derivado, se consulta periódicamente si el agente respondió (solo con la pestaña visible)
  useEffect(() => {
    if (!conversationId || !derived || ticketStatus === 'cerrado' || ticketStatus === 'escalado') return;
    const t = setInterval(() => {
      if (document.hidden) return;
      getPublicConversation(slug, conversationId).then(applyServer).catch(() => undefined);
    }, POLL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, conversationId, derived, embed, ticketStatus]);

  // Encuesta de resolución: SÍ cierra el ticket (no se reabre); NO lo escala a gestión
  const answer = async (resolved: boolean) => {
    if (!conversationId || sending) return;
    setError(null);
    setSending(true);
    try {
      applyServer(await answerSurvey(slug, conversationId, resolved));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  // Caso terminado: el cliente puede iniciar una conversación nueva (el ticket cerrado no se reabre)
  const nuevaConsulta = () => {
    writeStored(slug, null);
    setMessages([]);
    setConversationId(undefined);
    setDerived(false);
    setTicketNumber(undefined);
    setTicketStatus(undefined);
    agentMsgs.current = 0;
    setError(null);
  };

  const send = async (message: string, escalate = false) => {
    if (!message.trim() || sending) return;
    setError(null);
    setSending(true);
    try {
      const res = await sendPublicChat(slug, { message, conversationId, escalate, customerName: 'Visitante web' });
      setConversationId(res.conversationId);
      writeStored(slug, res.conversationId);
      setMessages((prev) => [...prev, ...res.messages]);
      if (res.derived) {
        setDerived(true);
        setTicketNumber(res.ticketNumber);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText('');
    send(t);
  };

  const close = () => window.parent.postMessage({ type: 'alloxentric:close' }, '*');

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center text-sm text-[#64748B]">
        <div>
          <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-[#F59E0B]" />
          <p>{loadError === 'Empresa no encontrada' ? 'Este chat no existe.' : loadError}</p>
        </div>
      </div>
    );
  }
  if (!agent) {
    return (
      <div className="min-h-screen flex items-center justify-center text-[#64748B]">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  const disponible = agent.agentStatus === 'activo';
  const finalizado = ticketStatus === 'cerrado' || ticketStatus === 'escalado';

  return (
    <div className={`flex flex-col bg-white ${embed ? 'h-screen' : 'h-screen max-w-xl mx-auto sm:border-x border-[#E2E8F0]'}`}>
      <header className="p-4 text-white flex items-center justify-between shrink-0" style={{ backgroundColor: agent.brandColor }}>
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center font-black text-xs shrink-0">
            {agent.logoInitials}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold truncate">{agent.agentName}</p>
            <p className="text-[11px] text-white/80 truncate">Asistente de {agent.name}</p>
          </div>
        </div>
        {embed && (
          <button onClick={close} aria-label="Cerrar chat" className="p-1.5 rounded-lg hover:bg-white/15">
            <X className="w-5 h-5" />
          </button>
        )}
      </header>

      <main className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#F8FAFC]">
        <Bubble bot name={agent.agentName} color={agent.brandColor}>
          {disponible
            ? `¡Hola! Soy ${agent.agentName}, el asistente con IA de ${agent.name}. ¿En qué puedo ayudarte hoy?`
            : 'Este asistente aún no está disponible. Intenta nuevamente más tarde.'}
        </Bubble>
        {messages.map((m) => (
          <Bubble
            key={m.id}
            bot={m.sender !== 'user'}
            agent={m.sender === 'agent'}
            name={m.senderName}
            color={agent.brandColor}
            source={m.ragSources?.[0]}
            notice={m.isEscalationNotice}
          >
            {m.message}
          </Bubble>
        ))}
        {sending && <p className="text-xs text-[#64748B] pl-1">{agent.agentName} está escribiendo…</p>}
        {derived && !finalizado && ticketStatus !== 'esperando_cliente' && (
          <div className="p-3 rounded-xl bg-[#F0FDFA] border border-[#CCFBF1] text-xs text-[#0F766E] flex gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <p>
              Derivamos tu consulta a un agente humano{ticketNumber ? <> (ticket <b>{ticketNumber}</b>)</> : null}.
              Te responderán aquí mismo; esta ventana se actualiza sola.
            </p>
          </div>
        )}
        {ticketStatus === 'esperando_cliente' && (
          <div className="p-3.5 rounded-xl bg-white border border-[#C7D2FE] shadow-xs space-y-2.5" data-testid="survey">
            <p className="text-sm font-semibold text-[#1E1B4B]">¿Se resolvió tu consulta?</p>
            <p className="text-xs text-[#64748B]">
              Si respondes que sí, cerramos el caso{ticketNumber ? <> {ticketNumber}</> : null}. Si no, lo escalamos a la gestión de {agent.name}.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => answer(true)}
                disabled={sending}
                className="flex-1 px-3 py-2 rounded-xl text-xs font-semibold text-white bg-[#22C55E] hover:bg-[#16A34A] disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                <ThumbsUp className="w-3.5 h-3.5" /> Sí, se resolvió
              </button>
              <button
                onClick={() => answer(false)}
                disabled={sending}
                className="flex-1 px-3 py-2 rounded-xl text-xs font-semibold text-[#B91C1C] bg-[#FEF2F2] border border-[#FCA5A5] hover:bg-[#FEE2E2] disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                <ThumbsDown className="w-3.5 h-3.5" /> No, sigue sin resolverse
              </button>
            </div>
          </div>
        )}
        {finalizado && (
          <div className={`p-3 rounded-xl border text-xs space-y-2 ${
            ticketStatus === 'cerrado' ? 'bg-[#F0FDF4] border-[#BBF7D0] text-[#166534]' : 'bg-[#F5F3FF] border-[#DDD6FE] text-[#5B21B6]'
          }`}>
            <p>
              {ticketStatus === 'cerrado'
                ? <>Caso <b>{ticketNumber}</b> cerrado. ¡Gracias por avisarnos!</>
                : <>Tu caso <b>{ticketNumber}</b> fue escalado a la gestión de {agent.name}; te contactarán directamente. Ya no se responde por este chat.</>}
            </p>
            <button
              onClick={nuevaConsulta}
              className="px-3 py-1.5 rounded-lg bg-white border border-current font-semibold flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Iniciar una nueva consulta
            </button>
          </div>
        )}
        {error && <p className="text-xs text-[#B91C1C]">{error}</p>}
        <div ref={endRef} />
      </main>

      <footer className="p-3 border-t border-[#E2E8F0] shrink-0 space-y-2">
        {disponible && !derived && (
          <button
            onClick={() => send('Quiero hablar con un agente humano.', true)}
            disabled={sending}
            className="text-[11px] font-semibold text-[#64748B] hover:text-[#1E1B4B] flex items-center gap-1 disabled:opacity-50"
          >
            <Headphones className="w-3.5 h-3.5" /> Hablar con una persona
          </button>
        )}
        <form onSubmit={submit} className="flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={!disponible || sending || finalizado}
            maxLength={4000}
            placeholder={finalizado ? 'Este caso ya terminó' : disponible ? 'Escribe tu consulta…' : 'Chat no disponible'}
            className="flex-1 px-3.5 py-2.5 text-sm rounded-xl border border-[#E2E8F0] focus:outline-none focus:border-[#4F46E5] disabled:bg-[#F1F5F9]"
          />
          <button
            type="submit"
            disabled={!disponible || sending || finalizado || !text.trim()}
            aria-label="Enviar"
            className="px-3.5 rounded-xl text-white disabled:opacity-50"
            style={{ backgroundColor: agent.brandColor }}
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
        <p className="text-[10px] text-center text-[#94A3B8]">Con tecnología de Alloxentric SupportHub</p>
      </footer>
    </div>
  );
};

const Bubble: React.FC<{
  bot?: boolean;
  agent?: boolean;
  name: string;
  color: string;
  source?: string;
  notice?: boolean;
  children: React.ReactNode;
}> = ({ bot, agent, name, color, source, notice, children }) => (
  <div className={`flex gap-2 ${bot ? '' : 'flex-row-reverse'}`}>
    <div
      className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-white"
      style={{ backgroundColor: bot ? color : '#64748B' }}
    >
      {bot ? agent ? <Headphones className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" /> : <User className="w-3.5 h-3.5" />}
    </div>
    <div className={`max-w-[80%] ${bot ? '' : 'text-right'}`}>
      <p className="text-[10px] text-[#64748B] mb-0.5">{name}</p>
      <div
        className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap text-left ${
          bot ? (notice ? 'bg-[#FEF3C7] text-[#78350F]' : 'bg-white border border-[#E2E8F0]') : 'text-white'
        }`}
        style={bot ? undefined : { backgroundColor: color }}
      >
        {children}
      </div>
      {source && <p className="text-[10px] text-[#64748B] mt-1">Fuente: {source}</p>}
    </div>
  </div>
);
