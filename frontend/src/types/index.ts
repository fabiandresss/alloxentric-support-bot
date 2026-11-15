export type TenantId = 'wellq' | 'alloxentric' | 'dani-eth' | 'dani27001' | 'aprueba' | string;

/**
 * Ciclo del ticket: pendiente/urgente (cola del encargado) -> esperando_cliente (respondido, con encuesta) ->
 * cerrado (el cliente confirmó o no contestó en 72 h; final) | escalado (el cliente dijo que NO; gestión fuera del chat).
 */
export type TicketStatus = 'pendiente' | 'urgente' | 'esperando_cliente' | 'cerrado' | 'escalado';

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
  aiModel: string; // id del catálogo (GET /modelos-ia), p. ej. "haiku-5-5"
  allowedDomains: string[]; // sitios donde puede ir el widget; vacío = cualquiera
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
  assignedAgent?: string; // nombre para mostrar
  assignedAgentId?: string; // id del usuario asignado (GET /tickets/agentes)
  closeReason?: 'confirmado_cliente' | 'sin_respuesta' | 'gestion_manual' | 'migrado';
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
/** Usuario al que se puede asignar un ticket (GET /tickets/agentes). */
export interface AssignableAgent {
  id: string;
  name: string;
  role: Role;
  companyId: string;
}

/** GET /metricas/analitica: datos reales de la vista Analítica, por empresa según el rol. */
export interface AnalyticsDay {
  date: string;
  bot: number;
  human: number;
  total: number;
}
export interface AnalyticsCompany {
  id: string;
  name: string;
  industry: string;
  brandColor: string;
  totalQueries: number;
  botResolved: number;
  botRate: number;
  escalated: number;
  escalationRate: number;
}
export interface Analytics {
  days: number;
  totalConversations: number;
  botResolved: number;
  humanEscalated: number;
  botRate: number;
  escalationRate: number;
  conversationsDelta?: number | null; // % vs el periodo anterior; null si no hay base
  avgHumanResolution: string;
  daily: AnalyticsDay[];
  companies: AnalyticsCompany[];
}

/** GET /publico/{slug}/conversaciones/{id}: transcripción para que el cliente vea la respuesta del agente. */
export interface PublicConversation {
  conversationId: string;
  messages: ChatMessage[];
  derived: boolean;
  ticketNumber?: string;
  ticketStatus?: TicketStatus;
}

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

/** Modelo de IA que se puede elegir para un agente (GET /modelos-ia). */
export interface AiModelOption {
  id: string;
  name: string;
  provider: string;
  providerId: string; // anthropic | openai | amazon | deepseek | qwen (clave del logo)
  description: string;
  recommended: boolean;
}

// ---------- FinOps (consumo de IA) y registro de conversaciones ----------
export interface SpendPlan {
  mode: 'limitado' | 'sin_limite';
  monthlyLimitUsd?: number; // solo con mode = limitado
  dailyLimitUsd?: number; // tope por día (opcional, solo con mode = limitado)
}

export interface FinOpsModelRow {
  modelId: string;
  name: string;
  provider: string;
  providerId: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface FinOpsPoint {
  date: string; // primer día del tramo (AAAA-MM-DD)
  endDate: string; // último día del tramo
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/** Ciclo de cobro: el mes en curso completo y todos los modelos (lo que mide el límite del plan). */
export interface FinOpsBilling {
  month: string; // AAAA-MM
  spentUsd: number;
  usedPct?: number; // % del límite (solo plan limitado)
  limitReached: boolean;
  nearLimit: boolean;
  projectedUsd?: number;
  dailySpentUsd: number;
  dailyUsedPct?: number;
  dailyLimitReached: boolean;
}

export type FinOpsGroup = 'dia' | 'semana' | 'mes';

export interface FinOpsSummary {
  rangeFrom: string;
  rangeTo: string;
  groupBy: FinOpsGroup;
  model?: string; // filtro de modelo de los totales y el gráfico
  plan: SpendPlan;
  billing: FinOpsBilling;
  spentUsd: number; // del rango y modelo filtrados
  calls: number;
  inputTokens: number;
  outputTokens: number;
  conversations: number;
  avgCostPerConversationUsd?: number;
  byModel: FinOpsModelRow[]; // del rango, sin el filtro de modelo
  series: FinOpsPoint[];
}

export interface ConversationListItem {
  id: string;
  customerName: string;
  customerEmail?: string;
  channel: string;
  startedAt: string;
  lastActivityAt: string;
  messageCount: number;
  escalated: boolean;
  ticketNumber?: string;
  ticketStatus?: string;
  firstMessage: string;
  lastMessage: string;
  costUsd: number;
}

export interface ConversationList {
  total: number;
  items: ConversationListItem[];
}

export interface ConversationDetail {
  summary: ConversationListItem;
  messages: ChatMessage[];
  inputTokens: number;
  outputTokens: number;
  aiCalls: number;
}

// ---------- Pruebas del agente (golden sets) y base de conocimiento ----------
export interface TestCase {
  id: string;
  order: number;
  question: string;
  expectedAnswer?: string;
  expectedDocument?: string;
  shouldEscalate: boolean; // pregunta fuera de la documentación: debe derivar a un humano
  origin: 'manual' | 'ia' | 'real'; // real = nació de una conversación
  conversationId?: string;
}

export interface TestRunSummary {
  total: number;
  passed: number;
  failed: number;
  errors: number;
  passRate: number; // %
  avgScore?: number; // 0..1
  sourceAccuracy?: number; // %
  derivationAccuracy?: number; // %
  avgConfidence?: number; // %
  avgLatencyMs: number;
  p95LatencyMs: number;
  inputTokens: number;
  outputTokens: number;
  agentCostUsd: number;
  judgeCostUsd: number;
  limitReached: boolean;
}

export interface TestRunBrief {
  id: string;
  setId: string;
  setName: string;
  status: 'ejecutando' | 'completada' | 'error';
  total: number;
  completed: number;
  judgeModelId: string; // LLM as a Judge que puntuó las respuestas
  groupId?: string; // corridas lanzadas juntas para comparar modelos
  origin: 'manual' | 'automatica';
  trigger?: string; // qué la disparó (p. ej. «subir tarifas.pdf»)
  startedAt: string;
  finishedAt?: string;
  modelId: string;
  ragThreshold: number;
  kb: { documents: number; fragments: number };
  createdBy?: string;
  summary?: TestRunSummary;
}

export interface TestSetItem {
  id: string;
  name: string;
  description?: string;
  caseCount: number;
  aiCases: number;
  generatedWith?: string; // modelo de IA que propuso los casos
  autoRun: boolean; // se corre solo al ingestar, reemplazar o eliminar documentos
  createdAt: string;
  updatedAt: string;
  lastRun?: TestRunBrief;
}

export interface TestSet extends TestSetItem {
  cases: TestCase[];
}

export interface TestResult {
  id: string;
  order: number;
  question: string;
  expectedAnswer?: string;
  expectedDocument?: string;
  shouldEscalate: boolean;
  answer: string;
  escalated: boolean;
  sources: string[];
  confidence?: number; // 0..1
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  sourceOk?: boolean;
  escalationOk: boolean;
  score?: number; // 0..1
  verdict: 'aprobado' | 'fallido' | 'error';
  reason?: string;
  previousVerdict?: string;
  humanLabel?: 'correcto' | 'incorrecto'; // lo que dijo una persona, para calibrar al juez
}

export interface TestRunDetail {
  run: TestRunBrief;
  previous?: TestRunBrief;
  error?: string;
  results: TestResult[];
}

export interface KbSummary {
  documents: number;
  processed: number;
  processing: number;
  errors: number;
  fragments: number;
  characters: number;
  embeddedFragments: number;
  models: string[];
  lastUpdated?: string;
  byType: { type: string; count: number }[];
}

export interface KbDocument {
  id: string;
  name: string;
  type: string;
  sizeBytes: number;
  uploadedAt: string; // ISO
  status: 'procesando' | 'procesado' | 'error';
  fragments: number; // fragmentos que realmente existen
  characters: number;
  embeddedFragments: number;
}

export interface KbChunk {
  id: string;
  documentId: string;
  documentName: string;
  order: number;
  text: string;
  characters: number;
  embedded: boolean;
  model?: string;
}

export interface KbChunkList {
  total: number;
  items: KbChunk[];
}

// ---------- Ciclo de calidad: notificaciones, comparativas, calibración, versiones y salud de la KB ----------
export interface AppNotification {
  id: string;
  type: string; // gasto_80 | gasto_100 | gasto_dia | pruebas_bajaron | pruebas_mejoraron
  title: string;
  message: string;
  view?: string; // pantalla a la que lleva
  ref?: string; // id relacionado (p. ej. la corrida)
  createdAt: string;
  seen: boolean;
}

export interface TestComparison {
  groupId: string;
  setId: string;
  setName: string;
  judgeModelId: string;
  minQuality: number;
  runs: TestRunBrief[];
  recommendedRunId?: string;
  recommendation: string;
}

export interface LabelCounts {
  labeled: number;
  correct: number;
  incorrect: number;
  minRequired: number;
  maxUsed: number;
}

export interface CalibrationJudge {
  modelId: string;
  n: number;
  agreement: number; // %
  truePositives: number;
  trueNegatives: number;
  falsePositives: number; // el juez aprobó lo que la persona dio por incorrecto
  falseNegatives: number; // el juez rechazó lo que la persona dio por correcto
  precision?: number;
  recall?: number;
  kappa: number;
  withoutJudge: number;
  costUsd: number;
  avgScoreIfCorrect?: number;
  avgScoreIfIncorrect?: number;
}

export interface CalibrationRun {
  id: string;
  status: 'ejecutando' | 'completada' | 'error';
  judgeModelIds: string[];
  labeled: number;
  total: number;
  completed: number;
  startedAt: string;
  finishedAt?: string;
  createdBy?: string;
  error?: string;
  judges: CalibrationJudge[];
}

export interface DocVersion {
  version: number;
  name: string;
  type: string;
  sizeBytes: number;
  fragments: number;
  uploadedAt: string;
  replacedAt?: string;
  current: boolean;
  restorable: boolean;
}

export interface KbIssue {
  code: string;
  severity: 'alta' | 'media' | 'baja';
  title: string;
  detail: string;
  count: number;
  documents: string[];
}

export interface KbQuality {
  score: number; // 0 a 100
  issues: KbIssue[];
  documentsChecked: number;
  fragmentsChecked: number;
}
