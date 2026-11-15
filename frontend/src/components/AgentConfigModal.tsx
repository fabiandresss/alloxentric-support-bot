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
import { ModelPicker } from './ModelPicker';
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
  const [aiModel, setAiModel] = useState(company.aiModel);
  const [domains, setDomains] = useState<string[]>(company.allowedDomains ?? []);
  const [domainInput, setDomainInput] = useState('');
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
        aiModel,
        allowedDomains: domains,
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
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[color:var(--c-ink)]/40 backdrop-blur-xs animate-in fade-in duration-200">
        <div 
          className="bg-white rounded-2xl border border-[color:var(--c-line)] shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-[color:var(--c-line)] flex items-center justify-between bg-white shrink-0">
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm tracking-wider shadow-xs"
                style={{ backgroundColor: `color-mix(in srgb, company.brandColor 14%, transparent)`, color: company.brandColor }}
              >
                {company.logoInitials}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-[color:var(--c-ink)]">
                    Configurar Agente — {company.name}
                  </h2>
                  <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-[#22C55E]/10 text-[#22C55E] border border-[#22C55E]/30">
                    {company.agentStatus === 'activo' ? 'Activo' : 'En configuración'}
                  </span>
                </div>
                <p className="text-xs text-[color:var(--c-muted)]">
                  Ajusta la base de conocimiento vectorial RAG, tono conversacional y parámetros de derivación a Corestream.
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 text-[color:var(--c-muted)] hover:text-[color:var(--c-ink)] hover:bg-[color:var(--c-soft)] rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Form Body (Scrollable) */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* 1. Datos de la empresa */}
            <div className="bg-[color:var(--c-canvas)] rounded-xl p-5 border border-[color:var(--c-line)] space-y-4">
              <h3 className="text-xs font-bold text-[color:var(--c-ink)] uppercase tracking-wider flex items-center gap-2">
                <Building className="w-4 h-4 text-[#D20A2E]" />
                1. Datos de la empresa
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[color:var(--c-ink)] mb-1">
                    Nombre de la empresa
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full text-xs text-[color:var(--c-ink)] px-3 py-2 bg-white border border-[color:var(--c-line)] rounded-lg focus:outline-none focus:border-[#D20A2E]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[color:var(--c-ink)] mb-1">
                    Rubro / Industria
                  </label>
                  <input
                    type="text"
                    value={industry}
                    onChange={(e) => setIndustry(e.target.value)}
                    className="w-full text-xs text-[color:var(--c-ink)] px-3 py-2 bg-white border border-[color:var(--c-line)] rounded-lg focus:outline-none focus:border-[#D20A2E]"
                  />
                </div>
              </div>
            </div>

            {/* 2. Base de conocimiento (RAG) */}
            <div className="bg-[color:var(--c-canvas)] rounded-xl p-5 border border-[color:var(--c-line)] space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-[color:var(--c-ink)] uppercase tracking-wider flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[#E8405F]" />
                  2. Base de conocimiento RAG ({documents.length} documentos)
                </h3>
                <span className="text-[11px] text-[color:var(--c-muted)]">
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
                    ? 'border-[#D20A2E] bg-[color:var(--c-ch100)]'
                    : 'border-[color:var(--c-line2)] bg-white hover:border-[#D20A2E] hover:bg-[color:var(--c-canvas)]'
                }`}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={(e) => handleFileUpload(e.target.files)}
                  className="hidden"
                  accept=".pdf,.docx,.txt,.csv,.faq"
                />
                <div className="w-10 h-10 rounded-full bg-[color:var(--c-ch100)] text-[#D20A2E] flex items-center justify-center mx-auto mb-2">
                  <UploadCloud className="w-5 h-5" />
                </div>
                <p className="text-xs font-semibold text-[color:var(--c-ink)]">
                  Haz clic para subir o arrastra y suelta tus archivos aquí
                </p>
                <p className="text-[11px] text-[color:var(--c-muted)] mt-1">
                  Los documentos se fragmentan y vectorizan automáticamente para las respuestas del bot.
                </p>
              </div>

              {uploadError && (
                <p className="text-[11px] text-[color:var(--c-rtx)] bg-[color:var(--c-rbg)] border border-[color:var(--c-rline)] rounded-lg px-3 py-2">
                  {uploadError}
                </p>
              )}

              {/* Lista de documentos ya cargados */}
              <div className="space-y-2 mt-3">
                <span className="text-[11px] font-semibold text-[color:var(--c-muted)] uppercase tracking-wider">
                  Documentos indexados en el corpus
                </span>

                <div className="space-y-2">
                  {documents.map((doc) => (
                    <div
                      key={doc.id}
                      onClick={() => setSelectedDocForDetail(doc)}
                      className="bg-white p-2.5 rounded-lg border border-[color:var(--c-line)] hover:border-[#D20A2E] hover:bg-[color:var(--c-canvas)] flex items-center justify-between gap-3 text-xs cursor-pointer transition-all group"
                      title="Haz click para ver fragmentos RAG y probar búsqueda semántica"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <FileText className="w-4 h-4 text-[#D20A2E] shrink-0 group-hover:scale-105 transition-transform" />
                        <div className="min-w-0">
                          <p className="font-semibold text-[color:var(--c-ink)] truncate group-hover:text-[#D20A2E] transition-colors">
                            {doc.name}
                          </p>
                          <div className="flex items-center gap-2 text-[10px] text-[color:var(--c-muted)]">
                            <span>{doc.size}</span>
                            <span>·</span>
                            <span>Subido {doc.uploadedAt}</span>
                            {doc.chunkCount > 0 && (
                              <>
                                <span>·</span>
                                <span className="text-[#B00825] font-mono">
                                  {doc.chunkCount} embeddings
                                </span>
                              </>
                            )}
                            <span className="text-[#D20A2E] font-semibold hidden sm:inline-flex items-center gap-0.5">
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
                          className="text-[color:var(--c-muted)] hover:text-[#EF4444] p-1 rounded transition-colors"
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
            <div className="bg-[color:var(--c-canvas)] rounded-xl p-5 border border-[color:var(--c-line)] space-y-4">
              <h3 className="text-xs font-bold text-[color:var(--c-ink)] uppercase tracking-wider flex items-center gap-2">
                <Sliders className="w-4 h-4 text-[#D20A2E]" />
                3. Configuración del agente conversacional
              </h3>

              <ModelPicker value={aiModel} onChange={setAiModel} />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-[color:var(--c-line)]">
                <div>
                  <label className="block text-xs font-semibold text-[color:var(--c-ink)] mb-1">
                    Nombre público del agente
                  </label>
                  <input
                    type="text"
                    value={agentName}
                    onChange={(e) => setAgentName(e.target.value)}
                    className="w-full text-xs text-[color:var(--c-ink)] px-3 py-2 bg-white border border-[color:var(--c-line)] rounded-lg focus:outline-none focus:border-[#D20A2E]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[color:var(--c-ink)] mb-1">
                    Tono de respuesta
                  </label>
                  {/* Selector: formal / cercano / tecnico */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setTone('formal')}
                      className={`px-3 py-2 text-xs font-semibold rounded-lg border transition-all text-center ${
                        tone === 'formal'
                          ? 'bg-[#D20A2E] text-white border-[#D20A2E] shadow-xs'
                          : 'bg-white text-[color:var(--c-muted)] border-[color:var(--c-line)] hover:border-[#D20A2E]'
                      }`}
                    >
                      Formal (Corporativo)
                    </button>
                    <button
                      type="button"
                      onClick={() => setTone('cercano')}
                      className={`px-3 py-2 text-xs font-semibold rounded-lg border transition-all text-center ${
                        tone === 'cercano'
                          ? 'bg-[#D20A2E] text-white border-[#D20A2E] shadow-xs'
                          : 'bg-white text-[color:var(--c-muted)] border-[color:var(--c-line)] hover:border-[#D20A2E]'
                      }`}
                    >
                      Cercano (Empático)
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[color:var(--c-ink)] mb-1">
                  Instrucciones personalizadas (System Prompt)
                </label>
                <textarea
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  rows={4}
                  className="w-full text-xs text-[color:var(--c-ink)] p-3 bg-white border border-[color:var(--c-line)] rounded-lg focus:outline-none focus:border-[#D20A2E] leading-relaxed font-mono resize-none"
                  placeholder="Instrucciones para el modelo RAG..."
                />
                <p className="text-[11px] text-[color:var(--c-muted)] mt-1">
                  Indica límites de confidencialidad y cuándo debe activarse la derivación a Corestream.
                </p>
              </div>

              {/* Slider de umbral RAG */}
              <div className="pt-2 border-t border-[color:var(--c-line)]">
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="font-semibold text-[color:var(--c-ink)]">
                    Umbral de similitud semántica RAG: {Math.round(ragThreshold * 100)}%
                  </span>
                  <span className="text-[11px] text-[color:var(--c-muted)]">
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
                  className="w-full accent-[#D20A2E] cursor-pointer"
                />
                <p className="text-[10px] text-[color:var(--c-muted)] mt-1">
                  Consultas cuya relevancia RAG sea menor al {Math.round(ragThreshold * 100)}% se derivarán automáticamente a Corestream.
                </p>
              </div>
            </div>

            {/* 4. Sección Canal */}
            <div className="bg-[color:var(--c-canvas)] rounded-xl p-5 border border-[color:var(--c-line)] space-y-4">
              <h3 className="text-xs font-bold text-[color:var(--c-ink)] uppercase tracking-wider flex items-center gap-2">
                <ExternalLink className="w-4 h-4 text-[#D20A2E]" />
                4. Canal de despliegue
              </h3>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-[color:var(--c-ink)] mb-1">
                    Enlace generado del chat web
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={company.webChatUrl}
                      className="flex-1 text-xs text-[color:var(--c-ink)] px-3 py-2 bg-white border border-[color:var(--c-line)] rounded-lg font-mono"
                    />
                    <button
                      type="button"
                      onClick={handleCopyLink}
                      className="px-3.5 py-2 bg-white border border-[color:var(--c-line)] hover:border-[#D20A2E] text-[color:var(--c-ink)] rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-xs"
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

                <div data-testid="domains-box">
                  <label className="block text-xs font-semibold text-[color:var(--c-ink)] mb-1">Sitios autorizados para el widget</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text" value={domainInput} data-testid="domain-input" placeholder="midominio.cl o *.midominio.cl"
                      onChange={(e) => setDomainInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const v = domainInput.trim().toLowerCase(); if (v && !domains.includes(v)) setDomains([...domains, v]); setDomainInput(''); } }}
                      className="flex-1 text-xs text-[color:var(--c-ink)] px-3 py-2 bg-white border border-[color:var(--c-line)] rounded-lg"
                    />
                    <button type="button" data-testid="domain-add" disabled={!domainInput.trim()}
                      onClick={() => { const v = domainInput.trim().toLowerCase(); if (v && !domains.includes(v)) setDomains([...domains, v]); setDomainInput(''); }}
                      className="px-3.5 py-2 bg-white border border-[color:var(--c-line)] hover:border-[#D20A2E] text-[color:var(--c-ink)] rounded-lg text-xs font-semibold disabled:opacity-40">Agregar</button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5" data-testid="domain-list">
                    {domains.length === 0 && <span className="text-[11px] text-[color:var(--c-muted)]">Sin restricción: el widget funciona en cualquier sitio.</span>}
                    {domains.map((d) => (
                      <span key={d} className="inline-flex items-center gap-1 rounded-full bg-[color:var(--c-ch100)] text-[#D20A2E] text-[11px] font-semibold pl-2.5 pr-1 py-0.5">
                        {d}<button type="button" aria-label={`Quitar ${d}`} onClick={() => setDomains(domains.filter((x) => x !== d))} className="w-4 h-4 rounded-full hover:bg-[#D20A2E]/15 flex items-center justify-center text-[11px] leading-none">×</button>
                      </span>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[10px] text-[color:var(--c-muted)]">Si agregas sitios, el widget solo responde donde esté incrustado en uno de ellos. Evita que copien tu snippet; no reemplaza al límite de gasto.</p>
                </div>

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => setShowEmbedCode(true)}
                    className="px-3.5 py-2 bg-[color:var(--c-ch100)] hover:bg-[color:var(--c-ch200)] text-[#D20A2E] rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors border border-[color:var(--c-ch200)]"
                  >
                    <Code className="w-3.5 h-3.5" />
                    <span>Ver código del widget embebible</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Modal Footer with "Publicar agente" button */}
          <div className="px-6 py-4 bg-white border-t border-[color:var(--c-line)] flex items-center justify-between shrink-0">
            <span className="text-xs text-[color:var(--c-muted)]">
              Los cambios se guardan en el backend local.
            </span>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-white border border-[color:var(--c-line)] text-xs font-semibold text-[color:var(--c-ink)] rounded-lg hover:bg-[color:var(--c-soft)] transition-colors"
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
                  className="px-4 py-2.5 bg-white border border-[color:var(--c-line2)] hover:border-[#E8405F] text-[color:var(--c-ink)] hover:text-[#B00825] rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all shadow-2xs hover:bg-[color:var(--c-ch50)]"
                  title="Abrir vista previa del widget de chat con la base RAG de esta empresa"
                >
                  <Play className="w-3.5 h-3.5 text-[#E8405F] fill-[#E8405F]" />
                  <span>Probar agente</span>
                </button>
              )}

              <button
                type="button"
                onClick={handlePublish}
                disabled={isPublishing}
                className="px-6 py-2.5 bg-[#D20A2E] hover:bg-[#B00825] text-white rounded-lg text-xs font-bold transition-all shadow-md flex items-center gap-2"
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
