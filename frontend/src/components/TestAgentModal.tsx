import React, { useState } from 'react';
import { X, Send, Bot, User, Sparkles, FileText, ExternalLink, RotateCcw } from 'lucide-react';
import { Company } from '../types';
import { probeChat } from '../api/client';

interface TestAgentModalProps {
  company: Company;
  onClose: () => void;
}

export const TestAgentModal: React.FC<TestAgentModalProps> = ({ company, onClose }) => {
  const [messages, setMessages] = useState<
    { sender: 'bot' | 'user'; text: string; time: string; source?: string }[]
  >([
    {
      sender: 'bot',
      text: `¡Hola! Soy ${company.agentName}, el asistente con IA de ${company.name}. ¿En qué puedo ayudarte hoy?`,
      time: '15:40',
      source: 'Bienvenida del sistema RAG',
    },
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);

  const [conversationId, setConversationId] = useState<string | undefined>(undefined);

  const handleSend = async () => {
    if (!input.trim() || isTyping) return;
    const userText = input.trim();
    setInput('');
    const now = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setMessages((prev) => [...prev, { sender: 'user' as const, text: userText, time: now() }]);

    setIsTyping(true);
    try {
      // Respuesta REAL del backend (motor RAG sobre los documentos de esta empresa)
      const res = await probeChat(company.id, {
        message: userText,
        conversationId,
        customerName: 'Prueba del administrador',
      });
      setConversationId(res.conversationId);
      const botMsgs = res.messages
        .filter((m) => m.sender === 'bot')
        .map((m) => ({
          sender: 'bot' as const,
          text: res.derived && res.ticketNumber && m.isEscalationNotice
            ? `${m.message}\n\n(Ticket ${res.ticketNumber} creado en Corestream.)`
            : m.message,
          time: m.timestamp,
          source: m.ragSources?.[0],
        }));
      setMessages((prev) => [...prev, ...botMsgs]);
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { sender: 'bot' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}`, time: now() },
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[color:var(--c-ink)]/40 backdrop-blur-xs animate-in fade-in duration-200">
      <div 
        className="bg-white rounded-2xl border border-[color:var(--c-line)] shadow-2xl w-full max-w-lg h-[540px] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[color:var(--c-line)] flex items-center justify-between bg-white shrink-0">
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs"
              style={{ backgroundColor: `color-mix(in srgb, company.brandColor 14%, transparent)`, color: company.brandColor }}
            >
              {company.logoInitials}
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h4 className="text-xs font-bold text-[color:var(--c-ink)]">
                  Simulador de Chat · {company.agentName}
                </h4>
                <span className="w-2 h-2 rounded-full bg-[#22C55E]"></span>
              </div>
              <p className="text-[10px] text-[color:var(--c-muted)]">
                Prueba en vivo del RAG (Tono: {company.tone})
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                setMessages([
                  {
                    sender: 'bot',
                    text: `¡Hola! Soy ${company.agentName}, el asistente con IA de ${company.name}. ¿En qué puedo ayudarte hoy?`,
                    time: '15:40',
                  },
                ]);
              }}
              className="p-1.5 text-[color:var(--c-muted)] hover:text-[color:var(--c-ink)] rounded-lg transition-colors"
              title="Reiniciar chat"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-[color:var(--c-muted)] hover:text-[color:var(--c-ink)] rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Chat Messages */}
        <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-[color:var(--c-canvas)]">
          {messages.map((m, idx) => (
            <div
              key={idx}
              className={`flex gap-2.5 ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {m.sender === 'bot' && (
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-xs font-bold"
                  style={{ backgroundColor: `color-mix(in srgb, company.brandColor 14%, transparent)`, color: company.brandColor }}
                >
                  <Bot className="w-3.5 h-3.5" />
                </div>
              )}

              <div
                className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-xs leading-relaxed ${
                  m.sender === 'user'
                    ? 'bg-[#D20A2E] text-white rounded-br-xs'
                    : 'bg-white text-[color:var(--c-ink)] border border-[color:var(--c-line)] shadow-xs rounded-bl-xs'
                }`}
              >
                <p>{m.text}</p>
                {m.source && (
                  <div className="mt-1.5 pt-1 border-t border-[color:var(--c-line)] text-[10px] text-[#B00825] flex items-center gap-1">
                    <FileText className="w-3 h-3" />
                    <span>RAG: {m.source}</span>
                  </div>
                )}
                <span className="block text-[9px] opacity-70 mt-1 text-right">
                  {m.time}
                </span>
              </div>

              {m.sender === 'user' && (
                <div className="w-6 h-6 rounded-full bg-[color:var(--c-line)] text-[color:var(--c-ink)] flex items-center justify-center shrink-0 text-xs font-semibold">
                  <User className="w-3.5 h-3.5" />
                </div>
              )}
            </div>
          ))}

          {isTyping && (
            <div className="flex items-center gap-2 text-xs text-[color:var(--c-muted)] italic pl-2">
              <Bot className="w-3.5 h-3.5 text-[#E8405F] animate-bounce" />
              <span>{company.agentName} buscando en base RAG...</span>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="p-3 bg-white border-t border-[color:var(--c-line)] flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder={`Escribe una pregunta para ${company.agentName}...`}
            className="flex-1 text-xs text-[color:var(--c-ink)] px-3 py-2 bg-[color:var(--c-canvas)] border border-[color:var(--c-line)] rounded-lg focus:outline-none focus:border-[#D20A2E] focus:bg-white transition-colors"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="p-2 bg-[#D20A2E] hover:bg-[#B00825] disabled:opacity-40 text-white rounded-lg transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
