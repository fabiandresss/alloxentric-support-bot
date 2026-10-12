export type TenantId = 'wellq' | 'alloxentric' | 'dani-eth' | 'dani27001' | 'aprueba' | string;

export type TicketStatus = 'pendiente' | 'urgente' | 'resuelto';

export type AgentStatus = 'activo' | 'en_configuracion' | 'inactivo';

export type ResponseTone = 'formal' | 'cercano' | 'tecnico';

export interface DocumentItem {
  id: string;
  name: string;
  type: 'pdf' | 'docx' | 'txt' | 'faq' | 'csv';
  size: string;
  uploadedAt: string;
  status: 'procesado' | 'procesando' | 'error';
  chunkCount: number;
}

export interface Company {
  id: TenantId;
  name: string;
  slug: string;
  industry: string;
  logoInitials: string;
  brandColor: string;
  brandBg: string;
  agentName: string;
  agentStatus: AgentStatus;
  documentsCount: number;
  documents: DocumentItem[];
  tone: ResponseTone;
  customInstructions: string;
  webChatUrl: string;
  monthlyQueries: number;
  botResolutionRate: number;
  ragThreshold: number; // 0.1 to 1.0
  lastUpdated: string;
  version: string;
  apiKey?: string; // solo viene al crear la empresa o al regenerar la clave
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'bot' | 'agent';
  senderName: string;
  message: string;
  timestamp: string;
  isEscalationNotice?: boolean;
  ragSources?: string[];
  confidenceScore?: number;
}

export interface AiSuggestion {
  confidence: number;
  sourceDoc: string;
  summary: string;
  draftResponse: string;
}

export interface Ticket {
  id: string;
  ticketNumber: string; // e.g. COR-8921
  companyId: TenantId;
  companyName: string;
  companyColor: string;
  companyBg: string;
  status: TicketStatus;
  userQueryExcerpt: string;
  escalationReason: string;
  relativeTime: string;
  exactTimestamp: string;
  customerName: string;
  customerEmail: string;
  customerChannel: 'Web Chat' | 'WhatsApp API' | 'Portal Clientes';
  transcript: ChatMessage[];
  aiSuggestion: AiSuggestion;
  assignedAgent?: string;
  isLive?: boolean;
}

export interface SystemMetrics {
  openTickets: number;
  urgentTickets: number;
  avgResolutionTime: string;
  botResolvedToday: number;
  botResolutionRate: number;
  escalationRate: number;
  totalConversationsToday: number;
}

// ---- Tipos de la API (backend FastAPI) que no existían en el prototipo ----
/** Lo que expone GET /publico/{slug}: solo marca y disponibilidad del agente. */
export interface PublicAgent {
  name: string;
  agentName: string;
  logoInitials: string;
  brandColor: string;
  brandBg: string;
  agentStatus: AgentStatus;
}

export interface ChatResponse {
  conversationId: string;
  messages: ChatMessage[];
  derived: boolean;
  ticketNumber?: string;
}

export interface ChunkOut {
  id: string;
  order: number;
  text: string;
}

// ---- Autenticación y roles (RF-28) ----
export type Role = 'superadmin' | 'admin_empresa' | 'encargado_tickets' | 'encargado_agente';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  companyId: string | null; // slug de la empresa; null = superadmin
  active: boolean;
}

export interface TokenResponse {
  accessToken: string;
  tokenType: string;
  user: AuthUser;
}
