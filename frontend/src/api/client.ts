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
  brandColor?: string;
  brandBg?: string;
  logoInitials?: string;
}

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
export const updateTicket = (id: string, p: { status?: TicketStatus; assignedAgent?: string }) =>
  request<Ticket>(`/tickets/${id}`, json('PATCH', p));
export const replyTicket = (id: string, text: string, agentName?: string) =>
  request<Ticket>(`/tickets/${id}/respuesta`, json('POST', { text, agentName }));

// ---------- métricas ----------
export const getMetrics = () => request<SystemMetrics>('/metricas');

// ---------- chat ----------
export interface ChatPayload {
  message: string;
  conversationId?: string;
  customerName?: string;
  customerEmail?: string;
  channel?: string;
  escalate?: boolean;
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

// ---------- autenticación y usuarios ----------
export const login = async (email: string, password: string) => {
  const r = await request<TokenResponse>('/auth/login', json('POST', { email, password }));
  setToken(r.accessToken);
  return r.user;
};
export const logout = () => setToken(null);
export const getMe = () => request<AuthUser>('/auth/me');
export const getUsers = (companyId?: string) =>
  request<AuthUser[]>(`/usuarios${companyId ? `?company_id=${encodeURIComponent(companyId)}` : ''}`);
export const createUser = (p: { email: string; name: string; password: string; role: Role; companyId?: string }) =>
  request<AuthUser>('/usuarios', json('POST', p));
export const updateUser = (id: string, p: { name?: string; role?: Role; active?: boolean; password?: string }) =>
  request<AuthUser>(`/usuarios/${id}`, json('PATCH', p));
export const deleteUser = (id: string) => request<void>(`/usuarios/${id}`, { method: 'DELETE' });
