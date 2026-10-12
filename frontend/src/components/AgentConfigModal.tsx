import React, { useState, useRef, useEffect } from 'react';
import { 
  X, 
  UploadCloud, 
  FileText, 
  CheckCircle2, 
  Loader2, 
  Copy, 
  Check, 
  Code, 
  ExternalLink, 
  Sparkles, 
  Sliders, 
  Trash2, 
  Building,
  Save,
  Play,
  ArrowRight
} from 'lucide-react';
import { Company, DocumentItem, ResponseTone } from '../types';
import { uploadDocument, deleteDocument, getDocuments } from '../api/client';
import { EmbedWidgetModal } from './EmbedWidgetModal';
import { DocumentDetailModal } from './DocumentDetailModal';

interface AgentConfigModalProps {
  company: Company;
  onClose: () => void;
  onSaveCompany: (updated: Company) => void;
  onTestAgent?: (company: Company) => void;
}

export const AgentConfigModal: React.FC<AgentConfigModalProps> = ({
  company,
  onClose,
  onSaveCompany,
  onTestAgent,
}) => {
  // Form states
  const [name, setName] = useState(company.name);
  const [industry, setIndustry] = useState(company.industry);
  const [agentName, setAgentName] = useState(company.agentName);
  const [tone, setTone] = useState<ResponseTone>(company.tone);
  const [instructions, setInstructions] = useState(company.customInstructions);
  const [ragThreshold, setRagThreshold] = useState(company.ragThreshold);
  const [documents, setDocuments] = useState<DocumentItem[]>(company.documents);

  // UI helpers
  const [copiedLink, setCopiedLink] = useState(false);
  const [showEmbedCode, setShowEmbedCode] = useState(false);
  const [selectedDocForDetail, setSelectedDocForDetail] = useState<DocumentItem | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(company.webChatUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2200);
  };

  const [uploadError, setUploadError] = useState<string | null>(null);

  // Mientras haya documentos "procesando", consulta al backend hasta que terminen
  useEffect(() => {
    if (!documents.some((d) => d.status === 'procesando')) return;
    const timer = setInterval(async () => {
      try {
        const fresh = await getDocuments(company.id);
        setDocuments(fresh);
      } catch {
        /* se reintenta en el siguiente ciclo */
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [documents, company.id]);

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadError(null);
    for (const file of Array.from(files)) {
      try {
        const doc = await uploadDocument(company.id, file); // se guarda y se indexa en el backend
        setDocuments((prev) => [doc, ...prev]);
      } catch (e) {
        setUploadError(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDeleteDoc = async (docId: string) => {
    setUploadError(null);
    try {
      await deleteDocument(docId);
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : String(e));
    }
  };

  const handlePublish = () => {
    setIsPublishing(true);
    setTimeout(() => {
      setIsPublishing(false);
      const updated: Company = {
        ...company,
        name,
        industry,
        agentName,
        tone,
        customInstructions: instructions,
        ragThreshold,
        documents,
        documentsCount: documents.length,
        agentStatus: 'activo',
        lastUpdated: 'Recién actualizado',
      };
      onSaveCompany(updated);
      onClose();
    }, 800);
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#1E1B4B]/40 backdrop-blur-xs animate-in fade-in duration-200">
        <div 
          className="bg-white rounded-2xl border border-[#E2E8F0] shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-[#E2E8F0] flex items-center justify-between bg-white shrink-0">
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm tracking-wider shadow-xs"
                style={{ backgroundColor: company.brandBg, color: company.brandColor }}
              >
                {company.logoInitials}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-[#1E1B4B]">
                    Configurar Agente — {company.name}
                  </h2>
                  <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-[#22C55E]/10 text-[#22C55E] border border-[#22C55E]/30">
                    {company.agentStatus === 'activo' ? 'Activo' : 'En configuración'}
                  </span>
                </div>
                <p className="text-xs text-[#64748B]">
                  Ajusta la base de conocimiento vectorial RAG, tono conversacional y parámetros de derivación a Corestream.
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

          {/* Form Body (Scrollable) */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* 1. Datos de la empresa */}
            <div className="bg-[#F8FAFC] rounded-xl p-5 border border-[#E2E8F0] space-y-4">
              <h3 className="text-xs font-bold text-[#1E1B4B] uppercase tracking-wider flex items-center gap-2">
                <Building className="w-4 h-4 text-[#4F46E5]" />
                1. Datos de la empresa
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#1E1B4B] mb-1">
                    Nombre de la empresa
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full text-xs text-[#1E1B4B] px-3 py-2 bg-white border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#4F46E5]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1E1B4B] mb-1">
                    Rubro / Industria
                  </label>
                  <input
                    type="text"
                    value={industry}
                    onChange={(e) => setIndustry(e.target.value)}
                    className="w-full text-xs text-[#1E1B4B] px-3 py-2 bg-white border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#4F46E5]"
                  />
                </div>
              </div>
            </div>

            {/* 2. Base de conocimiento (RAG) */}
            <div className="bg-[#F8FAFC] rounded-xl p-5 border border-[#E2E8F0] space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-[#1E1B4B] uppercase tracking-wider flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[#14B8A6]" />
                  2. Base de conocimiento RAG ({documents.length} documentos)
                </h3>
                <span className="text-[11px] text-[#64748B]">
                  Formatos soportados: PDF, DOCX, TXT, CSV, FAQs
                </span>
              </div>

              {/* Zona de carga de documentos (Drag & Drop) */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  handleFileUpload(e.dataTransfer.files);
                }}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
                  isDragging
                    ? 'border-[#4F46E5] bg-[#EEF2FF]'
                    : 'border-[#CBD5E1] bg-white hover:border-[#4F46E5] hover:bg-[#F8FAFC]'
                }`}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={(e) => handleFileUpload(e.target.files)}
                  className="hidden"
                  accept=".pdf,.docx,.txt,.csv,.faq"
                />
                <div className="w-10 h-10 rounded-full bg-[#EEF2FF] text-[#4F46E5] flex items-center justify-center mx-auto mb-2">
                  <UploadCloud className="w-5 h-5" />
                </div>
                <p className="text-xs font-semibold text-[#1E1B4B]">
                  Haz clic para subir o arrastra y suelta tus archivos aquí
                </p>
                <p className="text-[11px] text-[#64748B] mt-1">
                  Los documentos se fragmentan y vectorizan automáticamente para las respuestas del bot.
                </p>
              </div>

              {uploadError && (
                <p className="text-[11px] text-[#B91C1C] bg-[#FEF2F2] border border-[#FCA5A5] rounded-lg px-3 py-2">
                  {uploadError}
                </p>
              )}

              {/* Lista de documentos ya cargados */}
              <div className="space-y-2 mt-3">
                <span className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider">
                  Documentos indexados en el corpus
                </span>

                <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                  {documents.map((doc) => (
                    <div
                      key={doc.id}
                      onClick={() => setSelectedDocForDetail(doc)}
                      className="bg-white p-2.5 rounded-lg border border-[#E2E8F0] hover:border-[#4F46E5] hover:bg-[#F8FAFC] flex items-center justify-between gap-3 text-xs cursor-pointer transition-all group"
                      title="Haz click para ver fragmentos RAG y probar búsqueda semántica"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <FileText className="w-4 h-4 text-[#4F46E5] shrink-0 group-hover:scale-105 transition-transform" />
                        <div className="min-w-0">
                          <p className="font-semibold text-[#1E1B4B] truncate group-hover:text-[#4F46E5] transition-colors">
                            {doc.name}
                          </p>
                          <div className="flex items-center gap-2 text-[10px] text-[#64748B]">
                            <span>{doc.size}</span>
                            <span>·</span>
                            <span>Subido {doc.uploadedAt}</span>
                            {doc.chunkCount > 0 && (
                              <>
                                <span>·</span>
                                <span className="text-[#0D9488] font-mono">
                                  {doc.chunkCount} embeddings
                                </span>
                              </>
                            )}
                            <span className="text-[#4F46E5] font-semibold hidden sm:inline-flex items-center gap-0.5">
                              · Ver fragmentos <ArrowRight className="w-2.5 h-2.5" />
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        {doc.status === 'procesado' ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#22C55E]">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Procesado
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0284C7] animate-pulse">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Procesando...
                          </span>
                        )}

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteDoc(doc.id);
                          }}
                          className="text-[#64748B] hover:text-[#EF4444] p-1 rounded transition-colors"
                          title="Eliminar documento"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* 3. Configuración del agente */}
            <div className="bg-[#F8FAFC] rounded-xl p-5 border border-[#E2E8F0] space-y-4">
              <h3 className="text-xs font-bold text-[#1E1B4B] uppercase tracking-wider flex items-center gap-2">
                <Sliders className="w-4 h-4 text-[#4F46E5]" />
                3. Configuración del agente conversacional
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#1E1B4B] mb-1">
                    Nombre público del agente
                  </label>
                  <input
                    type="text"
                    value={agentName}
                    onChange={(e) => setAgentName(e.target.value)}
                    className="w-full text-xs text-[#1E1B4B] px-3 py-2 bg-white border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#4F46E5]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1E1B4B] mb-1">
                    Tono de respuesta
                  </label>
                  {/* Selector: formal / cercano / tecnico */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setTone('formal')}
                      className={`px-3 py-2 text-xs font-semibold rounded-lg border transition-all text-center ${
                        tone === 'formal'
                          ? 'bg-[#4F46E5] text-white border-[#4F46E5] shadow-xs'
                          : 'bg-white text-[#64748B] border-[#E2E8F0] hover:border-[#4F46E5]'
                      }`}
                    >
                      Formal (Corporativo)
                    </button>
                    <button
                      type="button"
                      onClick={() => setTone('cercano')}
                      className={`px-3 py-2 text-xs font-semibold rounded-lg border transition-all text-center ${
                        tone === 'cercano'
                          ? 'bg-[#4F46E5] text-white border-[#4F46E5] shadow-xs'
                          : 'bg-white text-[#64748B] border-[#E2E8F0] hover:border-[#4F46E5]'
                      }`}
                    >
                      Cercano (Empático)
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#1E1B4B] mb-1">
                  Instrucciones personalizadas (System Prompt)
                </label>
                <textarea
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  rows={4}
                  className="w-full text-xs text-[#1E1B4B] p-3 bg-white border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#4F46E5] leading-relaxed font-mono resize-none"
                  placeholder="Instrucciones para el modelo RAG..."
                />
                <p className="text-[11px] text-[#64748B] mt-1">
                  Indica límites de confidencialidad y cuándo debe activarse la derivación a Corestream.
                </p>
              </div>

              {/* Slider de umbral RAG */}
              <div className="pt-2 border-t border-[#E2E8F0]">
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="font-semibold text-[#1E1B4B]">
                    Umbral de similitud semántica RAG: {Math.round(ragThreshold * 100)}%
                  </span>
                  <span className="text-[11px] text-[#64748B]">
                    {ragThreshold >= 0.8
                      ? 'Derivación proactiva (muy estricto)'
                      : 'Equilibrado (recomendado)'}
                  </span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="0.95"
                  step="0.01"
                  value={ragThreshold}
                  onChange={(e) => setRagThreshold(parseFloat(e.target.value))}
                  className="w-full accent-[#4F46E5] cursor-pointer"
                />
                <p className="text-[10px] text-[#64748B] mt-1">
                  Consultas cuya relevancia RAG sea menor al {Math.round(ragThreshold * 100)}% se derivarán automáticamente a Corestream.
                </p>
              </div>
            </div>

            {/* 4. Sección Canal */}
            <div className="bg-[#F8FAFC] rounded-xl p-5 border border-[#E2E8F0] space-y-4">
              <h3 className="text-xs font-bold text-[#1E1B4B] uppercase tracking-wider flex items-center gap-2">
                <ExternalLink className="w-4 h-4 text-[#4F46E5]" />
                4. Canal de despliegue
              </h3>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-[#1E1B4B] mb-1">
                    Enlace generado del chat web
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={company.webChatUrl}
                      className="flex-1 text-xs text-[#1E1B4B] px-3 py-2 bg-white border border-[#E2E8F0] rounded-lg font-mono"
                    />
                    <button
                      type="button"
                      onClick={handleCopyLink}
                      className="px-3.5 py-2 bg-white border border-[#E2E8F0] hover:border-[#4F46E5] text-[#1E1B4B] rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-xs"
                    >
                      {copiedLink ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-[#22C55E]" />
                          <span className="text-[#22C55E]">¡Copiado!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copiar enlace</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => setShowEmbedCode(true)}
                    className="px-3.5 py-2 bg-[#EEF2FF] hover:bg-[#E0E7FF] text-[#4F46E5] rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors border border-[#E0E7FF]"
                  >
                    <Code className="w-3.5 h-3.5" />
                    <span>Ver código del widget embebible</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Modal Footer with "Publicar agente" button */}
          <div className="px-6 py-4 bg-white border-t border-[#E2E8F0] flex items-center justify-between shrink-0">
            <span className="text-xs text-[#64748B]">
              Los cambios se guardan en el backend local.
            </span>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-white border border-[#E2E8F0] text-xs font-semibold text-[#1E1B4B] rounded-lg hover:bg-[#F1F5F9] transition-colors"
              >
                Cancelar
              </button>

              {onTestAgent && (
                <button
                  type="button"
                  onClick={() => {
                    onTestAgent(company);
                    onClose();
                  }}
                  className="px-4 py-2.5 bg-white border border-[#CBD5E1] hover:border-[#14B8A6] text-[#1E1B4B] hover:text-[#0D9488] rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all shadow-2xs hover:bg-[#F0FDFA]"
                  title="Abrir vista previa del widget de chat con la base RAG de esta empresa"
                >
                  <Play className="w-3.5 h-3.5 text-[#14B8A6] fill-[#14B8A6]" />
                  <span>Probar agente</span>
                </button>
              )}

              <button
                type="button"
                onClick={handlePublish}
                disabled={isPublishing}
                className="px-6 py-2.5 bg-[#4F46E5] hover:bg-[#4338CA] text-white rounded-lg text-xs font-bold transition-all shadow-md flex items-center gap-2"
              >
                {isPublishing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Publicando agente...</span>
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    <span>Publicar agente</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {selectedDocForDetail && (
        <DocumentDetailModal
          document={selectedDocForDetail}
          companyName={company.name}
          onClose={() => setSelectedDocForDetail(null)}
        />
      )}

      {showEmbedCode && (
        <EmbedWidgetModal company={company} onClose={() => setShowEmbedCode(false)} />
      )}
    </>
  );
};
