import React, { useState } from 'react';
import { 
  Plus, 
  FileText, 
  Settings, 
  Bot, 
  Play
} from 'lucide-react';
import { Company } from '../types';
import { AgentConfigModal } from './AgentConfigModal';
import { AddCompanyModal } from './AddCompanyModal';
import { TestAgentModal } from './TestAgentModal';

interface AgentDeploymentPanelProps {
  companies: Company[];
  onUpdateCompany: (company: Company) => void;
  onAddCompany: (company: Company) => void;
  canCreateCompany?: boolean;
  onOpenWidgetPreview?: (companyId: string) => void;
}

export const AgentDeploymentPanel: React.FC<AgentDeploymentPanelProps> = ({
  companies,
  onUpdateCompany,
  onAddCompany,
  canCreateCompany = false,
  onOpenWidgetPreview,
}) => {
  const [selectedCompanyToConfig, setSelectedCompanyToConfig] = useState<Company | null>(null);
  const [showAddCompanyModal, setShowAddCompanyModal] = useState(false);
  const [testCompany, setTestCompany] = useState<Company | null>(null);

  const getStatusBadge = (status: Company['agentStatus']) => {
    switch (status) {
      case 'activo':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#22C55E]/10 text-[#22C55E] border border-[#22C55E]/30">
            <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E]"></span>
            Activo
          </span>
        );
      case 'en_configuracion':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#F59E0B]/10 text-[#F59E0B] border border-[#F59E0B]/30">
            <span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B]"></span>
            En configuración
          </span>
        );
      case 'inactivo':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#64748B]/10 text-[#64748B] border border-[#64748B]/30">
            <span className="w-1.5 h-1.5 rounded-full bg-[#64748B]"></span>
            Inactivo
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-[#1E1B4B]">
              Empresas y agentes
            </h1>
            <span className="px-2.5 py-0.5 rounded-md text-xs font-semibold bg-[#F1F5F9] text-[#64748B]">
              {companies.length} empresas registradas
            </span>
          </div>
          <p className="text-xs text-[#64748B] mt-1">
            Administra los chatbots con RAG por cada cliente SaaS, actualiza sus bases de conocimiento y gestiona los canales de atención.
          </p>
        </div>

        {canCreateCompany && <button
          onClick={() => setShowAddCompanyModal(true)}
          className="self-start sm:self-auto px-4 py-2 bg-[#4F46E5] hover:bg-[#4338CA] text-white rounded-lg text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" />
          <span>+ Agregar empresa</span>
        </button>}
      </div>

      {/* Grid of Company Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {companies.map((company) => (
          <div
            key={company.id}
            className="bg-white rounded-xl border border-[#E2E8F0] p-5 shadow-[0_1px_3px_rgba(0,0,0,0.02)] hover:shadow-md hover:border-[#4F46E5]/40 transition-all flex flex-col justify-between"
          >
            <div>
              {/* Header: Company Initials & Status */}
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-3">
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center font-bold text-sm tracking-wider shadow-xs shrink-0"
                    style={{ backgroundColor: company.brandBg, color: company.brandColor }}
                  >
                    {company.logoInitials}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-[#1E1B4B] leading-tight">
                      {company.name}
                    </h3>
                    <p className="text-[11px] text-[#64748B] mt-0.5 line-clamp-1">
                      {company.industry}
                    </p>
                  </div>
                </div>

                {getStatusBadge(company.agentStatus)}
              </div>

              {/* Empty state if company has 0 documents */}
              {company.documentsCount === 0 ? (
                <div className="p-4 bg-[#FFFBEB] rounded-xl border border-[#FDE68A] mt-4 space-y-2.5">
                  <div className="flex items-center gap-2 text-xs font-bold text-[#B45309]">
                    <FileText className="w-4 h-4 text-[#F59E0B] shrink-0" />
                    <span>Aún no hay documentos cargados</span>
                  </div>
                  <p className="text-[11px] text-[#92400E] leading-relaxed">
                    Este agente está en configuración y no cuenta con base de conocimiento RAG. Necesita al menos un archivo o FAQ para poder responder consultas.
                  </p>
                  <button
                    onClick={() => setSelectedCompanyToConfig(company)}
                    className="w-full py-2 px-3 bg-[#F59E0B] hover:bg-[#D97706] text-white text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 shadow-2xs"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Subir primer documento a Base RAG</span>
                  </button>
                </div>
              ) : (
                <>
                  {/* Agent Details */}
                  <div className="p-3 bg-[#F8FAFC] rounded-lg border border-[#E2E8F0] space-y-2 mt-4">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[#64748B] flex items-center gap-1.5">
                        <Bot className="w-3.5 h-3.5 text-[#14B8A6]" />
                        Agente IA:
                      </span>
                      <span className="font-semibold text-[#1E1B4B]">
                        {company.agentName}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[#64748B] flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-[#4F46E5]" />
                        Base de conocimiento:
                      </span>
                      <span className="font-bold text-[#4F46E5] tabular-nums">
                        {company.documentsCount} documentos/FAQ
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs pt-1 border-t border-[#E2E8F0]">
                      <span className="text-[#64748B]">Tono de respuesta:</span>
                      <span className="font-medium text-[#1E1B4B] capitalize">
                        {company.tone}
                      </span>
                    </div>
                  </div>

                  {/* Mini KPIs */}
                  <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
                    <div className="p-2 rounded-lg bg-white border border-[#E2E8F0]">
                      <span className="text-[10px] text-[#64748B] block">Consultas este mes</span>
                      <span className="font-bold text-[#1E1B4B] tabular-nums">
                        {company.monthlyQueries.toLocaleString()}
                      </span>
                    </div>

                    <div className="p-2 rounded-lg bg-white border border-[#E2E8F0]">
                      <span className="text-[10px] text-[#64748B] block">Efectividad RAG</span>
                      <span className="font-bold text-[#22C55E] tabular-nums">
                        {company.botResolutionRate > 0 ? `${company.botResolutionRate}%` : 'En calibración'}
                      </span>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Footer Buttons */}
            <div className="mt-5 pt-3 border-t border-[#E2E8F0] flex items-center justify-between gap-2">
              <button
                onClick={() => {
                  if (onOpenWidgetPreview) {
                    onOpenWidgetPreview(company.id);
                  } else {
                    setTestCompany(company);
                  }
                }}
                className="px-2.5 py-1.5 text-xs font-semibold text-[#64748B] hover:text-[#1E1B4B] hover:bg-[#F1F5F9] rounded-lg transition-colors flex items-center gap-1"
                title="Probar respuestas del bot en simulador del widget"
              >
                <Play className="w-3 h-3 text-[#14B8A6] fill-[#14B8A6]" />
                <span>Probar</span>
              </button>

              <button
                onClick={() => setSelectedCompanyToConfig(company)}
                className="px-3.5 py-1.5 bg-[#4F46E5] hover:bg-[#4338CA] text-white rounded-lg text-xs font-semibold transition-all shadow-xs flex items-center gap-1.5"
              >
                <Settings className="w-3.5 h-3.5" />
                <span>Configurar agente</span>
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Modals */}
      {selectedCompanyToConfig && (
        <AgentConfigModal
          company={selectedCompanyToConfig}
          onClose={() => setSelectedCompanyToConfig(null)}
          onTestAgent={(c) => {
            if (onOpenWidgetPreview) {
              onOpenWidgetPreview(c.id);
            }
          }}
          onSaveCompany={(updated) => {
            onUpdateCompany(updated);
            setSelectedCompanyToConfig(null);
          }}
        />
      )}

      {showAddCompanyModal && (
        <AddCompanyModal
          onClose={() => setShowAddCompanyModal(false)}
          onAddCompany={(newComp) => {
            onAddCompany(newComp);
            setShowAddCompanyModal(false);
          }}
        />
      )}

      {testCompany && (
        <TestAgentModal company={testCompany} onClose={() => setTestCompany(null)} />
      )}
    </div>
  );
};
