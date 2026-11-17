import React, { useEffect, useRef, useState } from 'react';
import { Send, Bot, User, Headphones, X, AlertTriangle, CheckCircle2, Loader2, ThumbsUp, ThumbsDown, RotateCcw, ChevronDown, FileText, Clock } from 'lucide-react';
import { ChatMessage, PublicAgent, SourceDetail, TicketStatus } from '../types';
import { ApiError, answerSurvey, forgetVisitor, getPublicAgent, getPublicConversation, rateMessage, sendPublicChat, streamPublicChat } from '../api/client';

const POLL_MS = 5000; // cada cuánto se consulta si el agente humano respondió
const storeKey = (slug: string) => `alloxentric_chat_${slug}`;
const visitorKey = (slug: string) => `alloxentric_visitor_${slug}`;

/** Identificador anónimo de este navegador para esta empresa: le permite al chatbot recordar el nombre y las últimas consultas de quien vuelve. */
const readVisitor = (slug: string, renovar = false): string => {
  try {
    const guardado = localStorage.getItem(visitorKey(slug));
    if (guardado && !renovar) return guardado;
    const nuevo = crypto.randomUUID();
    localStorage.setItem(visitorKey(slug), nuevo);
    return nuevo;
  } catch {
    return crypto.randomUUID(); // sin almacenamiento: vale solo para esta visita
  }
};

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
  const [commentFor, setCommentFor] = useState<string | null>(null); // respuesta a la que se le está dejando un comentario 👎
  const [pendingUser, setPendingUser] = useState<string | null>(null); // mensaje del cliente ya enviado, esperando la respuesta
  const [streamText, setStreamText] = useState<string | null>(null); // lo que el modelo lleva escrito (null = no hay respuesta en curso)
  const [info, setInfo] = useState<string | null>(null);
  const [commentText, setCommentText] = useState('');

  useEffect(() => {
    getPublicAgent(slug)
      .then(setAgent)
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, [slug]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending, streamText]);

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
    setPendingUser(message);
    setStreamText('');
    const payload = { message, conversationId, escalate, customerName: 'Visitante web', visitorId: readVisitor(slug) };
    try {
      let res;
      try {
        // la respuesta aparece a medida que el modelo la escribe; el texto final (ya filtrado) la reemplaza
        res = await streamPublicChat(slug, payload, (t) => setStreamText((prev) => (prev ?? '') + t));
      } catch (e) {
        if (!(e instanceof ApiError) || e.status !== 0) throw e;   // solo si el streaming no se pudo abrir se reintenta sin él
        res = await sendPublicChat(slug, payload);
      }
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
      setPendingUser(null);
      setStreamText(null);
    }
  };

  // «Olvídame»: el chatbot borra lo que recordaba de este navegador (nombre y últimas consultas) y empieza con un identificador nuevo
  const olvidarme = async () => {
    if (!window.confirm('¿Quieres que el asistente olvide tu nombre y tus consultas anteriores?')) return;
    try {
      await forgetVisitor(slug, readVisitor(slug));
      readVisitor(slug, true);
      setInfo('Listo: el asistente olvidó lo que recordaba de ti.');
      setTimeout(() => setInfo(null), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // 👍/👎 a una respuesta del bot (volver a tocar la misma la quita). Un 👎 abre un campo opcional «¿qué faltó?».
  const rate = async (m: ChatMessage, rating: 'up' | 'down', comment?: string) => {
    if (!conversationId) return;
    const quitar = m.rating === rating && comment === undefined;
    try {
      const upd = await rateMessage(slug, conversationId, m.id, quitar ? null : rating, comment);
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, rating: upd.rating, ratingComment: upd.ratingComment } : x)));
      setCommentFor(!quitar && rating === 'down' && comment === undefined ? m.id : null);
      setCommentText('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
      <div className="min-h-screen flex items-center justify-center p-6 text-center text-sm text-[color:var(--c-muted)]">
        <div>
          <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-[#F59E0B]" />
          <p>{loadError === 'Empresa no encontrada' ? 'Este chat no existe.' : loadError}</p>
        </div>
      </div>
    );
  }
  if (!agent) {
    return (
      <div className="min-h-screen flex items-center justify-center text-[color:var(--c-muted)]">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  const disponible = agent.agentStatus === 'activo';
  const finalizado = ticketStatus === 'cerrado' || ticketStatus === 'escalado';

  return (
    <div className={`flex flex-col bg-white ${embed ? 'h-screen' : 'h-screen max-w-xl mx-auto sm:border-x border-[color:var(--c-line)]'}`}>
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

      {agent.humanSupport?.enabled && (
        <div data-testid="human-support" className={`px-4 py-2 text-[11px] flex items-center gap-2 border-b ${agent.humanSupport.open
          ? 'bg-[color:var(--c-gbg)] border-[color:var(--c-gline)] text-[color:var(--c-gtx)]' : 'bg-[color:var(--c-abg)] border-[color:var(--c-aline)] text-[color:var(--c-atx2)]'}`}>
          <Clock className="w-3.5 h-3.5 shrink-0" />
          <span className="min-w-0">
            <b>{agent.humanSupport.open ? 'Atención humana disponible ahora' : 'Fuera del horario de atención humana'}</b>
            {agent.humanSupport.schedule ? <> · {agent.humanSupport.schedule}</> : null}
            {!agent.humanSupport.open && agent.humanSupport.message ? <span className="block opacity-90">{agent.humanSupport.message}</span> : null}
          </span>
        </div>
      )}

      <main className="flex-1 overflow-y-auto p-4 space-y-3 bg-[color:var(--c-canvas)]">
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
            details={m.sourceDetails}
            notice={m.isEscalationNotice}
            feedback={m.sender === 'bot' && !m.isEscalationNotice && conversationId ? {
              rating: m.rating,
              onRate: (r) => rate(m, r),
              commenting: commentFor === m.id,
              comment: commentText,
              onComment: setCommentText,
              onSend: () => rate(m, 'down', commentText.trim()),
              onSkip: () => setCommentFor(null),
            } : undefined}
          >
            {m.message}
          </Bubble>
        ))}
        {pendingUser && <Bubble name="Tú" color={agent.brandColor}>{pendingUser}</Bubble>}
        {sending && streamText ? <Bubble bot name={agent.agentName} color={agent.brandColor}>{streamText}</Bubble>
          : sending && <p className="text-xs text-[color:var(--c-muted)] pl-1">{agent.agentName} está escribiendo…</p>}
        {derived && !finalizado && ticketStatus !== 'esperando_cliente' && (
          <div className="p-3 rounded-xl bg-[color:var(--c-ch50)] border border-[color:var(--c-ch150)] text-xs text-[#8F0720] flex gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <p>
              Derivamos tu consulta a un agente humano{ticketNumber ? <> (ticket <b>{ticketNumber}</b>)</> : null}.
              Te responderán aquí mismo; esta ventana se actualiza sola.
            </p>
          </div>
        )}
        {ticketStatus === 'esperando_cliente' && (
          <div className="p-3.5 rounded-xl bg-white border border-[color:var(--c-ch350)] shadow-xs space-y-2.5" data-testid="survey">
            <p className="text-sm font-semibold text-[color:var(--c-ink)]">¿Se resolvió tu consulta?</p>
            <p className="text-xs text-[color:var(--c-muted)]">
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
                className="flex-1 px-3 py-2 rounded-xl text-xs font-semibold text-[color:var(--c-rtx)] bg-[color:var(--c-rbg)] border border-[color:var(--c-rline)] hover:bg-[color:var(--c-rbg2)] disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                <ThumbsDown className="w-3.5 h-3.5" /> No, sigue sin resolverse
              </button>
            </div>
          </div>
        )}
        {finalizado && (
          <div className={`p-3 rounded-xl border text-xs space-y-2 ${
            ticketStatus === 'cerrado' ? 'bg-[color:var(--c-gbg)] border-[color:var(--c-gline)] text-[color:var(--c-gtx)]' : 'bg-[color:var(--c-soft2)] border-[color:var(--c-line2)] text-[color:var(--c-ink3)]'
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
        {error && <p className="text-xs text-[color:var(--c-rtx)]">{error}</p>}
        {info && <p role="status" className="text-xs text-[color:var(--c-gtx)]">{info}</p>}
        <div ref={endRef} />
      </main>

      <footer className="p-3 border-t border-[color:var(--c-line)] shrink-0 space-y-2">
        {disponible && !derived && (
          <button
            onClick={() => send('Quiero hablar con un agente humano.', true)}
            disabled={sending}
            className="text-[11px] font-semibold text-[color:var(--c-muted)] hover:text-[color:var(--c-ink)] flex items-center gap-1 disabled:opacity-50"
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
            className="flex-1 px-3.5 py-2.5 text-sm rounded-xl border border-[color:var(--c-line)] focus:outline-none focus:border-[#D20A2E] disabled:bg-[color:var(--c-soft)]"
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
        <p className="text-[10px] text-center text-[color:var(--c-faint)]">Con tecnología de Alloxentric SupportHub · <button type="button" onClick={olvidarme} data-testid="forget-me" className="underline underline-offset-2 hover:text-[color:var(--c-ink)]">Olvidar mis datos</button></p>
      </footer>
    </div>
  );
};

interface Feedback {
  rating?: 'up' | 'down';
  onRate: (r: 'up' | 'down') => void;
  commenting: boolean;
  comment: string;
  onComment: (t: string) => void;
  onSend: () => void;
  onSkip: () => void;
}

/** Fuentes de la respuesta: con extracto (la empresa lo permite) se despliegan; solo con nombre se muestra una línea. */
const Sources: React.FC<{ details: SourceDetail[]; color: string }> = ({ details, color }) => {
  const [open, setOpen] = useState(false);
  const conExtracto = details.some((d) => d.excerpt);
  if (!conExtracto) return <p className="text-[10px] text-[color:var(--c-muted)] mt-1">Fuente: {details.map((d) => d.documentName).join(', ')}</p>;
  return (
    <div className="mt-1" data-testid="sources">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="text-[10px] font-semibold text-[color:var(--c-muted)] hover:text-[color:var(--c-ink)] flex items-center gap-1">
        <FileText className="w-3 h-3" /> Fuentes ({details.length}) <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ul className="mt-1.5 space-y-1.5">
          {details.map((d, i) => (
            <li key={i} className="text-[11px] rounded-lg bg-white border border-[color:var(--c-line)] p-2 text-left" style={{ borderLeft: `3px solid ${color}` }}>
              <p className="font-semibold text-[color:var(--c-ink)] truncate">{d.documentName}{d.page ? <span className="font-normal text-[color:var(--c-muted)]"> · p. {d.page}</span> : null}</p>
              {d.excerpt && <p className="mt-0.5 text-[color:var(--c-muted)] leading-snug">«{d.excerpt}{d.excerpt.length >= 240 ? '…' : ''}»</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const Bubble: React.FC<{
  bot?: boolean;
  agent?: boolean;
  name: string;
  color: string;
  source?: string;
  details?: SourceDetail[];
  feedback?: Feedback;
  notice?: boolean;
  children: React.ReactNode;
}> = ({ bot, agent, name, color, source, details, feedback, notice, children }) => (
  <div className={`flex gap-2 ${bot ? '' : 'flex-row-reverse'}`}>
    <div
      className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-white"
      style={{ backgroundColor: bot ? color : '#6B6562' }}
    >
      {bot ? agent ? <Headphones className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" /> : <User className="w-3.5 h-3.5" />}
    </div>
    <div className={`max-w-[80%] ${bot ? '' : 'text-right'}`}>
      <p className="text-[10px] text-[color:var(--c-muted)] mb-0.5">{name}</p>
      <div
        className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap text-left ${
          bot ? (notice ? 'bg-[color:var(--c-abg2)] text-[color:var(--c-atx3)]' : 'bg-white border border-[color:var(--c-line)]') : 'text-white'
        }`}
        style={bot ? undefined : { backgroundColor: color }}
      >
        {children}
      </div>
      {details?.length ? <Sources details={details} color={color} /> : source && <p className="text-[10px] text-[color:var(--c-muted)] mt-1">Fuente: {source}</p>}
      {feedback && (
        <div className="mt-1.5" data-testid="feedback">
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-[color:var(--c-faint)] mr-0.5">¿Te sirvió?</span>
            <button onClick={() => feedback.onRate('up')} aria-label="Me sirvió" aria-pressed={feedback.rating === 'up'} data-testid="rate-up"
              className={`p-1 rounded-md transition-colors ${feedback.rating === 'up' ? 'bg-[color:var(--c-gbg2)] text-[color:var(--c-gtx)]' : 'text-[color:var(--c-faint)] hover:text-[color:var(--c-ink)] hover:bg-[color:var(--c-soft)]'}`}>
              <ThumbsUp className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => feedback.onRate('down')} aria-label="No me sirvió" aria-pressed={feedback.rating === 'down'} data-testid="rate-down"
              className={`p-1 rounded-md transition-colors ${feedback.rating === 'down' ? 'bg-[color:var(--c-rbg2)] text-[color:var(--c-rtx2)]' : 'text-[color:var(--c-faint)] hover:text-[color:var(--c-ink)] hover:bg-[color:var(--c-soft)]'}`}>
              <ThumbsDown className="w-3.5 h-3.5" />
            </button>
          </div>
          {feedback.commenting && (
            <form onSubmit={(e) => { e.preventDefault(); feedback.onSend(); }} className="mt-1.5 flex gap-1.5" data-testid="rate-comment">
              <input value={feedback.comment} onChange={(e) => feedback.onComment(e.target.value)} maxLength={500} placeholder="¿Qué faltó? (opcional)" aria-label="Comentario"
                className="flex-1 min-w-0 px-2.5 py-1.5 text-[11px] rounded-lg border border-[color:var(--c-line)] focus:outline-none focus:border-[#D20A2E]" />
              <button type="submit" className="px-2.5 rounded-lg text-[11px] font-semibold text-white" style={{ backgroundColor: color }}>Enviar</button>
              <button type="button" onClick={feedback.onSkip} className="px-2 text-[11px] text-[color:var(--c-muted)]">Omitir</button>
            </form>
          )}
        </div>
      )}
    </div>
  </div>
);
