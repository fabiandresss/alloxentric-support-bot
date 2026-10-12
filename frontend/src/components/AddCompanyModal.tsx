import React, { useState } from 'react';
import { X, Building2, Plus, Sparkles, Check } from 'lucide-react';
import { Company, ResponseTone } from '../types';

interface AddCompanyModalProps {
  onClose: () => void;
  onAddCompany: (company: Company) => void;
}

export const AddCompanyModal: React.FC<AddCompanyModalProps> = ({ onClose, onAddCompany }) => {
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [agentName, setAgentName] = useState('');
  const [tone, setTone] = useState<ResponseTone>('formal');
  const [instructions, setInstructions] = useState('');

  const brandColors = [
    { color: '#4F46E5', bg: '#EEF2FF', name: 'Índigo' },
    { color: '#0284C7', bg: '#E0F2FE', name: 'Celeste' },
    { color: '#7C3AED', bg: '#F5F3FF', name: 'Púrpura' },
    { color: '#0D9488', bg: '#CCFBF1', name: 'Teal' },
    { color: '#EA580C', bg: '#FFEDD5', name: 'Naranja' },
    { color: '#16A34A', bg: '#DCFCE7', name: 'Verde' },
  ];
  const [selectedColor, setSelectedColor] = useState(brandColors[0]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const initials = name
      .split(' ')
      .map((w) => w.charAt(0))
      .join('')
      .slice(0, 2)
      .toUpperCase();

    const newCompany: Company = {
      id: slug,
      name,
      slug,
      industry: industry || 'Software as a Service (SaaS)',
      logoInitials: initials || 'CO',
      brandColor: selectedColor.color,
      brandBg: selectedColor.bg,
      agentName: agentName || `${name} Assistant`,
      agentStatus: 'en_configuracion',
      documentsCount: 0,
      tone,
      customInstructions:
        instructions ||
        `Eres el asistente inteligente de ${name}. Responde con precisión a consultas de usuarios y deriva a Corestream si falta información en la base RAG.`,
      webChatUrl: `https://soporte.alloxentric.com/${slug}`,
      monthlyQueries: 0,
      botResolutionRate: 0,
      ragThreshold: 0.8,
      lastUpdated: 'Recién creada',
      version: 'v1.0.0',
      documents: [],
    };

    onAddCompany(newCompany);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#1E1B4B]/40 backdrop-blur-xs animate-in fade-in duration-200">
      <div 
        className="bg-white rounded-2xl border border-[#E2E8F0] shadow-2xl w-full max-w-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#EEF2FF] flex items-center justify-center text-[#4F46E5]">
              <Building2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#1E1B4B]">
                Agregar nueva empresa cliente
              </h3>
              <p className="text-[11px] text-[#64748B]">
                Crea un nuevo tenant multi-tenant con su propio chatbot RAG e integración a Corestream.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[#64748B] hover:text-[#1E1B4B] hover:bg-[#F1F5F9] rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[#1E1B4B] mb-1">
              Nombre de la empresa *
            </label>
            <input
              type="text"
              required
              placeholder="Ej. Khipu, Fintual, NotCo..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full text-xs text-[#1E1B4B] px-3 py-2 bg-white border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#4F46E5]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#1E1B4B] mb-1">
              Rubro / Sector
            </label>
            <input
              type="text"
              placeholder="Ej. Fintech, Logística, HealthTech..."
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              className="w-full text-xs text-[#1E1B4B] px-3 py-2 bg-white border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#4F46E5]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-[#1E1B4B] mb-1">
                Nombre del bot
              </label>
              <input
                type="text"
                placeholder="Ej. Bot Asistente"
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                className="w-full text-xs text-[#1E1B4B] px-3 py-2 bg-white border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#4F46E5]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1E1B4B] mb-1">
                Tono conversacional
              </label>
              <select
                value={tone}
                onChange={(e) => setTone(e.target.value as ResponseTone)}
                className="w-full text-xs text-[#1E1B4B] px-3 py-2 bg-white border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#4F46E5]"
              >
                <option value="formal">Formal</option>
                <option value="cercano">Cercano</option>
                <option value="tecnico">Técnico</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#1E1B4B] mb-1">
              Color identificador de marca
            </label>
            <div className="flex items-center gap-2">
              {brandColors.map((bc) => (
                <button
                  type="button"
                  key={bc.color}
                  onClick={() => setSelectedColor(bc)}
                  className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                    selectedColor.color === bc.color ? 'ring-2 ring-offset-2 ring-[#4F46E5]' : ''
                  }`}
                  style={{ backgroundColor: bc.color }}
                  title={bc.name}
                >
                  {selectedColor.color === bc.color && <Check className="w-3.5 h-3.5 text-white" />}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#1E1B4B] mb-1">
              Instrucciones base (opcional)
            </label>
            <textarea
              rows={2}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Directrices de atención y límites del bot..."
              className="w-full text-xs text-[#1E1B4B] p-2.5 bg-white border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#4F46E5] resize-none"
            />
          </div>

          <div className="pt-3 border-t border-[#E2E8F0] flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-white border border-[#E2E8F0] text-xs font-semibold text-[#1E1B4B] rounded-lg hover:bg-[#F1F5F9] transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-[#4F46E5] hover:bg-[#4338CA] text-white rounded-lg text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Crear empresa</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
