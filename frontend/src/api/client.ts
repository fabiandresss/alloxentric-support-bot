import {
  Company,
  Ticket,
  TicketStatus,
  SystemMetrics,
  DocumentItem,
  ChatResponse,
  ChunkOut,
  ResponseTone,
  AgentStatus,
  AuthUser,
  Role,
  TokenResponse,
  PublicAgent,
  PublicConversation,
  AssignableAgent,
  Analytics,
  AiModelOption,
  SpendPlan,
  FinOpsSummary,
  FinOpsGroup,
  ConversationList,
  ConversationDetail,
  TestSet,
  TestSetItem,
  TestResult,
  TestCase,
  TestRunBrief,
  TestRunDetail,
  KbSummary,
  KbChunkList,
  KbDocument,
  AppNotification,
  TestComparison,
  LabelCounts,
  CalibrationRun,
  DocVersion,
  KbQuality,
  SecurityConfig,
  Schedule,
  SecurityOverview,
  UnansweredReport,
  ChatMessage,
  FaqProposalList,
  KbDocument as KbDoc,
  Performance,
} from '../types';

export const API_URL: string =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? 'http://localhost:8000';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// ---------- sesión (JWT) ----------
const TOKEN_KEY = 'alloxentric_token';
let token: string | null = null;
try {
  token = sessionStorage.getItem(TOKEN_KEY);
} catch {
  /* storage no disponible: la sesión vive solo en memoria */
}
let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: (() => void) | null) => {
  onUnauthorized = fn;
};
export const hasToken = () => !!token;
export const setToken = (t: string | null) => {
  token = t;
  try {
    if (t) sessionStorage.setItem(TOKEN_KEY, t);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  const headers = new Headers(init.headers);
  if (token && !headers.has('X-API-Key') && !path.startsWith('/publico/')) headers.set('Authorization', `Bearer ${token}`);
  if (path.startsWith('/publico/')) {
    // el widget incrustado le avisa al backend en qué sitio está (para los dominios autorizados de la empresa)
    try { const host = new URLSearchParams(window.location.search).get('host'); if (host) headers.set('X-Embed-Host', host); } catch { /* sin location */ }
  }
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(`No se pudo conectar con el backend en ${API_URL}`, 0);
  }
  if (!res.ok) {
    let detail = `Error ${res.status}`;
    try {
      const body = await res.json();
      if (typeof body.detail === 'string') detail = body.detail;
      else if (Array.isArray(body.detail)) detail = body.detail.map((d: { msg: string }) => d.msg).join('; ');
    } catch {
      /* respuesta sin JSON */
    }
    if (res.status === 401 && token && !path.startsWith('/auth/login')) {
      setToken(null);
      onUnauthorized?.();
    }
    throw new ApiError(detail, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// ---------- empresas ----------
export interface CompanyCreatePayload {
  name: string;
  industry?: string;
  agentName?: string;
  tone?: ResponseTone;
  customInstructions?: string;
  brandColor?: string;
  brandBg?: string;
  logoInitials?: string;
}

export interface CompanyUpdatePayload {
  name?: string;
  industry?: string;
  agentName?: string;
  agentStatus?: AgentStatus;
  tone?: ResponseTone;
  customInstructions?: string;
  ragThreshold?: number;
  aiModel?: string;
  allowedDomains?: string[];
  security?: SecurityConfig;
  schedule?: Schedule;
  brandColor?: string;
  brandBg?: string;
  logoInitials?: string;
}

export const getAiModels = () => request<AiModelOption[]>('/modelos-ia');

// ---------- FinOps y registro de conversaciones ----------
export interface FinOpsFilters {
  desde?: string; // AAAA-MM-DD (junto con hasta); sin rango = mes en curso
  hasta?: string;
  modelo?: string;
  agrupar?: FinOpsGroup;
}
export const getFinOps = (slug: string, f: FinOpsFilters = {}) => {
  const qs = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => v && qs.set(k, String(v)));
  return request<FinOpsSummary>(`/empresas/${slug}/finops${qs.toString() ? `?${qs}` : ''}`);
};
export const updateSpendPlan = (slug: string, p: { mode: SpendPlan['mode']; monthlyLimitUsd?: number; dailyLimitUsd?: number }) =>
  request<SpendPlan>(`/empresas/${slug}/plan`, json('PATCH', p));
export interface ConversationFilters {
  q?: string;
  ticket?: 'con' | 'sin';
  valoracion?: 'abajo' | 'arriba'; // abajo = con alguna respuesta valorada 👎
  canal?: string;
  desde?: string;
  hasta?: string;
  limit?: number;
  offset?: number;
}
export const getConversations = (slug: string, f: ConversationFilters = {}) => {
  const qs = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => v !== undefined && v !== '' && qs.set(k, String(v)));
  return request<ConversationList>(`/empresas/${slug}/conversaciones${qs.toString() ? `?${qs}` : ''}`);
};
export const getConversation = (id: string) => request<ConversationDetail>(`/conversaciones/${id}`);
export const getCompanies = () => request<Company[]>('/empresas');
export const createCompany = (p: CompanyCreatePayload) => request<Company>('/empresas', json('POST', p));
export const updateCompany = (slug: string, p: CompanyUpdatePayload) =>
  request<Company>(`/empresas/${slug}`, json('PATCH', p));
/** Genera una API key nueva (la anterior deja de funcionar). Se muestra una sola vez. */
export const rotateApiKey = (slug: string) => request<Company>(`/empresas/${slug}/api-key`, { method: 'POST' });

// ---------- documentos ----------
export const getDocuments = (slug: string) => request<DocumentItem[]>(`/empresas/${slug}/documentos`);
export const uploadDocument = (slug: string, file: File) => {
  const form = new FormData();
  form.append('archivo', file);
  return request<DocumentItem>(`/empresas/${slug}/documentos`, { method: 'POST', body: form });
};
export const deleteDocument = (docId: string) => request<void>(`/documentos/${docId}`, { method: 'DELETE' });
export const getDocumentChunks = (docId: string) => request<ChunkOut[]>(`/documentos/${docId}/fragmentos`);

// ---------- tickets ----------
export const getTickets = () => request<Ticket[]>('/tickets');
/** assignedAgentId: id de un usuario de la empresa del ticket; null = dejar sin asignar. */
export const updateTicket = (id: string, p: { status?: TicketStatus; assignedAgentId?: string | null }) =>
  request<Ticket>(`/tickets/${id}`, json('PATCH', p));
/** El remitente lo pone el backend con el usuario autenticado. */
export const replyTicket = (id: string, text: string) =>
  request<Ticket>(`/tickets/${id}/respuesta`, json('POST', { text }));
export const getAssignableAgents = () => request<AssignableAgent[]>('/tickets/agentes');

// ---------- métricas ----------
export const getMetrics = () => request<SystemMetrics>('/metricas');
export const getAnalytics = (days: number) => request<Analytics>(`/metricas/analitica?dias=${days}`);

// ---------- chat ----------
export interface ChatPayload {
  message: string;
  conversationId?: string;
  customerName?: string;
  customerEmail?: string;
  channel?: string;
  escalate?: boolean;
  visitorId?: string; // identificador anónimo del navegador: permite que el chatbot reconozca a quien vuelve
}
/** Simulador del panel de administración (no exige agente activo ni API key). */
export const probeChat = (slug: string, p: ChatPayload) =>
  request<ChatResponse>(`/empresas/${slug}/probar`, json('POST', p));
/** Endpoint del widget embebido: el tenant sale de la API key. */
export const sendChat = (apiKey: string, p: ChatPayload) =>
  request<ChatResponse>('/chat', {
    ...json('POST', p),
    headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
  });

/** Chat público por slug (página /chat/{slug} y iframe del widget). Sin autenticación. */
export const getPublicAgent = (slug: string) =>
  request<PublicAgent>(`/publico/${encodeURIComponent(slug)}`);
export const sendPublicChat = (slug: string, p: ChatPayload) =>
  request<ChatResponse>(`/publico/${encodeURIComponent(slug)}/chat`, json('POST', p));

/** El cliente responde la encuesta de resolución: true = se resolvió (cierra), false = no (escala a gestión). */
export const answerSurvey = (slug: string, conversationId: string, resolved: boolean) =>
  request<PublicConversation>(
    `/publico/${encodeURIComponent(slug)}/conversaciones/${encodeURIComponent(conversationId)}/encuesta`,
    json('POST', { resolved })
  );
export const getPublicConversation = (slug: string, conversationId: string) =>
  request<PublicConversation>(
    `/publico/${encodeURIComponent(slug)}/conversaciones/${encodeURIComponent(conversationId)}`
  );

// ---------- autenticación y usuarios ----------
export const login = async (email: string, password: string) => {
  const r = await request<TokenResponse>('/auth/login', json('POST', { email, password }));
  setToken(r.accessToken);
  return r.user;
};
export const logout = () => setToken(null);

// ---------- registro en autoservicio: cuenta -> empresa -> chatbot ----------
/** Paso 1: crea la cuenta (queda como «registrado», sin empresa) y abre sesión. */
export const register = async (p: { name: string; email: string; password: string; website?: string }) => {
  const r = await request<TokenResponse>('/registro/usuario', json('POST', p));
  setToken(r.accessToken);
  return r.user;
};
/** Paso 2: registra la empresa de la cuenta; la persona pasa a ser su admin (el mismo token sigue valiendo). */
export const registerCompany = (p: { name: string; industry?: string; siteUrl?: string }) => request<Company>('/registro/empresa', json('POST', p));
/** Paso 3: crea el chatbot de la empresa (uno solo) con su plan de gasto. */
export const createChatbot = (slug: string, p: { agentName: string; tone: ResponseTone; customInstructions?: string; brandColor: string; spendPlan: SpendPlan }) =>
  request<Company>(`/empresas/${encodeURIComponent(slug)}/chatbot`, json('POST', p));
export const getMe = () => request<AuthUser>('/auth/me');
export const getUsers = (companyId?: string) =>
  request<AuthUser[]>(`/usuarios${companyId ? `?company_id=${encodeURIComponent(companyId)}` : ''}`);
export const createUser = (p: { email: string; name: string; password: string; role: Role; companyId?: string }) =>
  request<AuthUser>('/usuarios', json('POST', p));
export const updateUser = (id: string, p: { name?: string; role?: Role; active?: boolean; password?: string }) =>
  request<AuthUser>(`/usuarios/${id}`, json('PATCH', p));
export const deleteUser = (id: string) => request<void>(`/usuarios/${id}`, { method: 'DELETE' });

// ---------- Pruebas del agente (golden sets) ----------
const T = (slug: string) => `/empresas/${slug}/testing`;
export interface TestCasePayload {
  question?: string;
  expectedAnswer?: string | null;
  expectedDocument?: string | null;
  shouldEscalate?: boolean;
  conversationId?: string; // el caso nace de una conversación real
}
export const getTestSets = (slug: string) => request<TestSetItem[]>(`${T(slug)}/conjuntos`);
export const getTestSet = (slug: string, id: string) => request<TestSet>(`${T(slug)}/conjuntos/${id}`);
export const createTestSet = (slug: string, p: { name: string; description?: string }) => request<TestSet>(`${T(slug)}/conjuntos`, json('POST', p));
export const generateTestSet = (slug: string, p: { name: string; description?: string; count: number; negatives: number; documentIds?: string[]; modelId?: string }) =>
  request<TestSet>(`${T(slug)}/conjuntos/generar`, json('POST', p));
export const updateTestSet = (slug: string, id: string, p: { name?: string; description?: string; autoRun?: boolean }) => request<TestSetItem>(`${T(slug)}/conjuntos/${id}`, json('PATCH', p));
export const deleteTestSet = (slug: string, id: string) => request<void>(`${T(slug)}/conjuntos/${id}`, { method: 'DELETE' });
export const createTestCase = (slug: string, setId: string, p: TestCasePayload) => request<TestCase>(`${T(slug)}/conjuntos/${setId}/casos`, json('POST', p));
export const updateTestCase = (slug: string, caseId: string, p: TestCasePayload) => request<TestCase>(`${T(slug)}/casos/${caseId}`, json('PATCH', p));
export const deleteTestCase = (slug: string, caseId: string) => request<void>(`${T(slug)}/casos/${caseId}`, { method: 'DELETE' });
export const runTestSet = (slug: string, setId: string, p: { judgeModelId?: string } = {}) => request<TestRunBrief>(`${T(slug)}/conjuntos/${setId}/ejecutar`, json('POST', p));
export const getTestRuns = (slug: string, setId?: string) => request<TestRunBrief[]>(`${T(slug)}/ejecuciones${setId ? `?conjunto_id=${setId}` : ''}`);
export const getTestRun = (slug: string, runId: string) => request<TestRunDetail>(`${T(slug)}/ejecuciones/${runId}`);
export const deleteTestRun = (slug: string, runId: string) => request<void>(`${T(slug)}/ejecuciones/${runId}`, { method: 'DELETE' });

/** Descarga el CSV de una corrida (plantilla alloxentric). `excel` usa «;» como separador. Va con el JWT, por eso no es un simple enlace. */
export async function downloadTestRun(slug: string, runId: string, formato: 'csv' | 'excel'): Promise<string> {
  const res = await fetch(`${API_URL}${T(slug)}/ejecuciones/${runId}/exportar?formato=${formato}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    let detail = `Error ${res.status}`;
    try { detail = (await res.json()).detail ?? detail; } catch { /* sin JSON */ }
    throw new ApiError(detail, res.status);
  }
  const nombre = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'alloxentric_pruebas.csv';
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return nombre;
}

// ---------- Base de conocimiento ----------
export const getKbSummary = (slug: string) => request<KbSummary>(`/empresas/${slug}/kb/resumen`);
export const getKbDocuments = (slug: string) => request<KbDocument[]>(`/empresas/${slug}/kb/documentos`);
export const getKbChunks = (slug: string, f: { q?: string; documentId?: string; limit?: number; offset?: number } = {}) => {
  const qs = new URLSearchParams();
  if (f.q) qs.set('q', f.q);
  if (f.documentId) qs.set('documento_id', f.documentId);
  if (f.limit !== undefined) qs.set('limit', String(f.limit));
  if (f.offset) qs.set('offset', String(f.offset));
  return request<KbChunkList>(`/empresas/${slug}/kb/fragmentos${qs.toString() ? `?${qs}` : ''}`);
};

// ---------- Notificaciones (campana) ----------
export const getNotifications = (slug: string, soloNuevas = false) => request<AppNotification[]>(`/empresas/${slug}/notificaciones${soloNuevas ? '?solo_nuevas=true' : ''}`);
export const markNotificationSeen = (slug: string, id: string) => request<void>(`/empresas/${slug}/notificaciones/${id}/visto`, { method: 'POST' });
export const markAllNotificationsSeen = (slug: string) => request<void>(`/empresas/${slug}/notificaciones/visto-todas`, { method: 'POST' });

// ---------- Comparar modelos y calibrar al juez ----------
export const compareModels = (slug: string, setId: string, p: { modelIds: string[]; judgeModelId?: string }) =>
  request<TestComparison>(`${T(slug)}/conjuntos/${setId}/comparar`, json('POST', p));
export const getComparison = (slug: string, groupId: string, minQuality = 80) => request<TestComparison>(`${T(slug)}/comparativas/${groupId}?calidad_minima=${minQuality}`);
export const labelResult = (slug: string, resultId: string, label: 'correcto' | 'incorrecto' | null) =>
  request<TestResult>(`${T(slug)}/resultados/${resultId}/etiqueta`, json('PUT', { label }));
export const getLabelCounts = (slug: string) => request<LabelCounts>(`${T(slug)}/etiquetas`);
export const startCalibration = (slug: string, judgeModelIds: string[]) => request<CalibrationRun>(`${T(slug)}/calibraciones`, json('POST', { judgeModelIds }));
export const getCalibrations = (slug: string) => request<CalibrationRun[]>(`${T(slug)}/calibraciones`);

// ---------- Versiones de documentos y salud de la base de conocimiento ----------
export const replaceDocument = (docId: string, file: File) => {
  const fd = new FormData();
  fd.append('archivo', file);
  return request<DocumentItem>(`/documentos/${docId}/reemplazar`, { method: 'POST', body: fd });
};
export const getDocVersions = (docId: string) => request<DocVersion[]>(`/documentos/${docId}/versiones`);
export const restoreDocVersion = (docId: string, version: number) => request<DocumentItem>(`/documentos/${docId}/versiones/${version}/restaurar`, { method: 'POST' });
export const getKbQuality = (slug: string) => request<KbQuality>(`/empresas/${slug}/kb/calidad`);

// ---------- valoración, resumen del ticket, seguridad de la IA y preguntas sin respuesta ----------
/** El cliente valora una respuesta del bot (null quita la valoración). */
export const rateMessage = (slug: string, conversationId: string, messageId: string, rating: 'up' | 'down' | null, comment?: string) =>
  request<ChatMessage>(
    `/publico/${encodeURIComponent(slug)}/conversaciones/${encodeURIComponent(conversationId)}/mensajes/${encodeURIComponent(messageId)}/valoracion`,
    json('PUT', { rating, comment: comment || null }),
  );
export const regenerateTicketSummary = (ticketId: string) => request<Ticket>(`/tickets/${ticketId}/resumen`, { method: 'POST' });
export const getSecurityEvents = (slug: string, days: number, type?: string) =>
  request<SecurityOverview>(`/empresas/${slug}/seguridad/eventos?dias=${days}${type ? `&tipo=${encodeURIComponent(type)}` : ''}`);
export const getUnanswered = (slug: string, days: number) => request<UnansweredReport>(`/empresas/${slug}/kb/vacios?dias=${days}`);

// ---------- chat en streaming, memoria del cliente, propuestas de FAQ y rendimiento ----------
/**
 * Chat público por SSE: `onDelta` recibe el texto a medida que el modelo lo escribe; al terminar devuelve la misma respuesta que el chat normal.
 * Lo mostrado por los deltas es un adelanto: el texto final (ya filtrado por seguridad) es el que vale y debe reemplazarlo.
 * Si la conexión por streaming falla antes de empezar, quien llama puede reintentar con `sendPublicChat`.
 */
export async function streamPublicChat(slug: string, p: ChatPayload, onDelta: (texto: string) => void): Promise<ChatResponse> {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  try { const host = new URLSearchParams(window.location.search).get('host'); if (host) headers.set('X-Embed-Host', host); } catch { /* sin location */ }
  let res: Response;
  try {
    res = await fetch(`${API_URL}/publico/${encodeURIComponent(slug)}/chat/stream`, { method: 'POST', headers, body: JSON.stringify(p) });
  } catch {
    throw new ApiError(`No se pudo conectar con el backend en ${API_URL}`, 0);
  }
  if (!res.ok || !res.body) {
    let detail = `Error ${res.status}`;
    try { const b = await res.json(); if (typeof b.detail === 'string') detail = b.detail; } catch { /* sin JSON */ }
    throw new ApiError(detail, res.status);
  }
  const lector = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let final: ChatResponse | null = null;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const bloque = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (!bloque.startsWith('data: ')) continue;
      const ev = JSON.parse(bloque.slice(6));
      if (ev.type === 'delta') onDelta(ev.text);
      else if (ev.type === 'done') final = ev.data as ChatResponse;
      else if (ev.type === 'error') throw new ApiError(ev.detail ?? 'No se pudo responder', ev.status ?? 500);
    }
  }
  if (!final) throw new ApiError('La respuesta se cortó antes de terminar', 0);
  return final;
}
/** El cliente pide que el chatbot lo olvide (borra su perfil y desvincula sus conversaciones). */
export const forgetVisitor = (slug: string, visitorId: string) =>
  request<void>(`/publico/${encodeURIComponent(slug)}/memoria/${encodeURIComponent(visitorId)}`, { method: 'DELETE' });
export const getFaqProposals = (slug: string) => request<FaqProposalList>(`/empresas/${slug}/kb/propuestas-faq`);
export const acceptFaqProposal = (slug: string, id: string, p: { question: string; answer: string }) =>
  request<KbDoc>(`/empresas/${slug}/kb/propuestas-faq/${id}/aceptar`, json('POST', p));
export const discardFaqProposal = (slug: string, id: string) => request<void>(`/empresas/${slug}/kb/propuestas-faq/${id}/descartar`, { method: 'POST' });
export const getPerformance = (slug: string, days: number) => request<Performance>(`/empresas/${slug}/ia/rendimiento?dias=${days}`);
