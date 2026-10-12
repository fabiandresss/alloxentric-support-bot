import React, { useState, useEffect } from 'react';
import { 
  X, 
  FileText, 
  Search, 
  Sparkles, 
  CheckCircle2, 
  Hash, 
  Cpu, 
  Database,
  Calendar,
  Layers,
  ArrowRight
} from 'lucide-react';
import { DocumentItem } from '../types';
import { getDocumentChunks } from '../api/client';

interface DocumentDetailModalProps {
  document: DocumentItem;
  companyName: string;
  onClose: () => void;
}

interface Chunk {
  id: string;
  index: number;
  tokens: number;
  content: string;
}

export const DocumentDetailModal: React.FC<DocumentDetailModalProps> = ({
  document,
  companyName,
  onClose,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fragmentos REALES guardados en la base de datos para este documento
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getDocumentChunks(document.id)
      .then((rows) => {
        if (cancelled) return;
        setChunks(
          rows.map((r) => ({
            id: r.id,
            index: r.order + 1,
            tokens: Math.max(1, Math.round(r.text.length / 4)), // estimación: ~4 caracteres por token
            content: r.text,
          }))
        );
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [document.id]);

  // Coincidencia léxica (% de palabras de la búsqueda presentes en el fragmento).
  // La búsqueda vectorial real se activará cuando el motor RAG genere los embeddings.
  const getChunkSimilarity = (chunk: Chunk): number => {
    const words = searchQuery.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    if (words.length === 0) return 0;
    const text = chunk.content.toLowerCase();
    return (words.filter((w) => text.includes(w)).length / words.length) * 100;
  };

  const highestScoringChunkIndex = searchQuery.trim()
    ? chunks.reduce((best, curr, idx) => {
        const score = getChunkSimilarity(curr);
        return score > best.score ? { idx, score } : best;
      }, { idx: -1, score: 0 }).idx
    : -1;

  return (
    <div 
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-[#1E1B4B]/50 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div 
        className="bg-white rounded-2xl border border-[#E2E8F0] shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#E2E8F0] flex items-center justify-between bg-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#EEF2FF] flex items-center justify-center text-[#4F46E5] shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-[#1E1B4B]">
                  {document.name}
                </h3>
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#22C55E] bg-[#22C55E]/10 px-2 py-0.5 rounded-full border border-[#22C55E]/30">
                  <CheckCircle2 className="w-3 h-3" />
                  Indexado RAG
                </span>
              </div>
              <p className="text-[11px] text-[#64748B]">
                Base documental de {companyName}
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

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Metadata Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 bg-[#F8FAFC] rounded-xl border border-[#E2E8F0]">
              <span className="text-[10px] text-[#64748B] uppercase tracking-wider block font-semibold">
                Tamaño del archivo
              </span>
              <span className="text-xs font-bold text-[#1E1B4B] mt-0.5 block">
                {document.size}
              </span>
            </div>

            <div className="p-3 bg-[#F8FAFC] rounded-xl border border-[#E2E8F0]">
              <span className="text-[10px] text-[#64748B] uppercase tracking-wider block font-semibold">
                Fecha de carga
              </span>
              <span className="text-xs font-bold text-[#1E1B4B] mt-0.5 block">
                {document.uploadedAt}
              </span>
            </div>

            <div className="p-3 bg-[#F8FAFC] rounded-xl border border-[#E2E8F0]">
              <span className="text-[10px] text-[#64748B] uppercase tracking-wider block font-semibold">
                Fragmentos (Chunks)
              </span>
              <span className="text-xs font-bold text-[#4F46E5] mt-0.5 block tabular-nums">
                {chunks.length || document.chunkCount} fragmentos
              </span>
            </div>

            <div className="p-3 bg-[#F8FAFC] rounded-xl border border-[#E2E8F0]">
              <span className="text-[10px] text-[#64748B] uppercase tracking-wider block font-semibold">
                Dimensiones
              </span>
              <span className="text-xs font-bold text-[#0D9488] mt-0.5 block font-mono">
                384-D Vector
              </span>
            </div>
          </div>

          {/* Semantic Search Sandbox */}
          <div className="p-4 bg-gradient-to-br from-[#F8FAFC] to-[#F0FDFA] rounded-xl border border-[#CCFBF1] space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#14B8A6]" />
                <span className="text-xs font-bold text-[#1E1B4B]">
                  Buscar en los fragmentos de este documento
                </span>
              </div>
              <span className="text-[10px] text-[#0D9488] font-semibold bg-white px-2 py-0.5 rounded-md border border-[#99F6E4]">
                Coincidencia por palabras
              </span>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-[#94A3B8] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Escribe una pregunta para ver qué fragmento coincide (ej. reembolsos)..."
                className="w-full text-xs pl-9 pr-4 py-2.5 bg-white border border-[#CBD5E1] rounded-lg focus:outline-none focus:border-[#14B8A6] focus:ring-1 focus:ring-[#14B8A6] text-[#1E1B4B] placeholder:text-[#94A3B8]"
              />
            </div>

            {/* Quick Prompts */}
            <div className="flex items-center gap-2 flex-wrap">
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="text-[11px] text-[#EF4444] hover:underline ml-auto font-medium"
                >
                  Limpiar búsqueda
                </button>
              )}
            </div>
          </div>

          {/* Chunks List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-[#1E1B4B] uppercase tracking-wider flex items-center gap-2">
                <Database className="w-3.5 h-3.5 text-[#4F46E5]" />
                Fragmentos indexados (Chunks) en la base vectorial
              </h4>
              <span className="text-[11px] text-[#64748B]">
                Chunking por párrafos (~800 caracteres)
              </span>
            </div>

            <div className="space-y-3">
              {loading && <p className="text-xs text-[#64748B] py-6 text-center">Cargando fragmentos…</p>}
              {error && <p className="text-xs text-[#B91C1C] py-6 text-center">{error}</p>}
              {!loading && !error && chunks.length === 0 && (
                <p className="text-xs text-[#64748B] py-6 text-center">
                  Este documento no tiene fragmentos guardados (por ejemplo, los documentos de ejemplo del seed
                  o uno aún en proceso). Sube un archivo real para ver su contenido fragmentado.
                </p>
              )}
              {chunks.map((chunk, idx) => {
                const similarity = getChunkSimilarity(chunk);
                const isBestMatch = idx === highestScoringChunkIndex && similarity > 60;

                return (
                  <div
                    key={chunk.id}
                    className={`p-4 rounded-xl border transition-all ${
                      isBestMatch
                        ? 'bg-[#F0FDFA] border-[#14B8A6] ring-2 ring-[#14B8A6]/20 shadow-xs'
                        : 'bg-white border-[#E2E8F0] hover:border-[#CBD5E1]'
                    }`}
                  >
                    {/* Chunk Card Header */}
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#EEF2FF] text-[#4F46E5]">
                          Chunk #{chunk.index}
                        </span>
                        <span className="text-[11px] text-[#64748B] tabular-nums">
                          {chunk.tokens} tokens
                        </span>
                      </div>

                      {searchQuery.trim() && (
                        <div className="flex items-center gap-1.5">
                          {isBestMatch && (
                            <span className="text-[10px] font-bold text-[#0D9488] bg-[#CCFBF1] px-2 py-0.5 rounded-full flex items-center gap-1">
                              <Sparkles className="w-3 h-3" />
                              Mejor coincidencia
                            </span>
                          )}
                          <span
                            className={`text-xs font-bold px-2 py-0.5 rounded-md tabular-nums ${
                              similarity > 80
                                ? 'bg-[#22C55E]/15 text-[#22C55E]'
                                : similarity > 50
                                ? 'bg-[#F59E0B]/15 text-[#F59E0B]'
                                : 'bg-[#64748B]/10 text-[#64748B]'
                            }`}
                          >
                            {similarity.toFixed(0)}% coincidencia
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Chunk Text Content */}
                    <p className="text-xs text-[#1E1B4B] leading-relaxed bg-[#F8FAFC] p-3 rounded-lg border border-[#E2E8F0] font-sans">
                      {chunk.content}
                    </p>

                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-[#F8FAFC] border-t border-[#E2E8F0] flex items-center justify-between shrink-0">
          <span className="text-[11px] text-[#64748B]">
            Hoy la búsqueda es por coincidencia de palabras; la búsqueda vectorial (pgvector + HNSW) se activa cuando el motor RAG genere los embeddings.
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-white border border-[#E2E8F0] text-xs font-semibold text-[#1E1B4B] rounded-lg hover:bg-[#F1F5F9] transition-colors"
          >
            Cerrar detalle
          </button>
        </div>
      </div>
    </div>
  );
};
