import React, { useEffect, useRef, useState } from 'react';
import { Send, Bot, User, Headphones, X, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { ChatMessage, PublicAgent } from '../types';
import { getPublicAgent, sendPublicChat } from '../api/client';

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

  const send = async (message: string, escalate = false) => {
    if (!message.trim() || sending) return;
    setError(null);
    setSending(true);
    try {
      const res = await sendPublicChat(slug, { message, conversationId, escalate, customerName: 'Visitante web' });
      setConversationId(res.conversationId);
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
        {derived && (
          <div className="p-3 rounded-xl bg-[#F0FDFA] border border-[#CCFBF1] text-xs text-[#0F766E] flex gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <p>
              Derivamos tu consulta a un agente humano{ticketNumber ? <> (ticket <b>{ticketNumber}</b>)</> : null}.
              Te responderán a la brevedad.
            </p>
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
            disabled={!disponible || sending}
            maxLength={4000}
            placeholder={disponible ? 'Escribe tu consulta…' : 'Chat no disponible'}
            className="flex-1 px-3.5 py-2.5 text-sm rounded-xl border border-[#E2E8F0] focus:outline-none focus:border-[#4F46E5] disabled:bg-[#F1F5F9]"
          />
          <button
            type="submit"
            disabled={!disponible || sending || !text.trim()}
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
