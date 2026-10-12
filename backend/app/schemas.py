"""Schemas con la MISMA forma que src/types/index.ts del front (camelCase)."""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

TicketStatus = Literal["pendiente", "urgente", "resuelto"]
AgentStatus = Literal["activo", "en_configuracion", "inactivo"]
Tone = Literal["formal", "cercano", "tecnico"]


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


# ---------- salida ----------
class DocumentItem(CamelModel):
    id: str
    name: str
    type: str
    size: str
    uploaded_at: str
    status: Literal["procesado", "procesando", "error"]
    chunk_count: int


class Company(CamelModel):
    id: str
    name: str
    slug: str
    industry: str
    logo_initials: str
    brand_color: str
    brand_bg: str
    agent_name: str
    agent_status: AgentStatus
    documents_count: int
    documents: list[DocumentItem]
    tone: Tone
    custom_instructions: str
    web_chat_url: str
    monthly_queries: int
    bot_resolution_rate: float
    rag_threshold: float
    last_updated: str
    version: str
    api_key: str | None = None  # solo al crear / rotar


class PublicAgent(CamelModel):
    """Lo único que expone la página pública de chat (sin documentos, claves ni métricas)."""
    name: str
    agent_name: str
    logo_initials: str
    brand_color: str
    brand_bg: str
    agent_status: AgentStatus


class ChatMessage(CamelModel):
    id: str
    sender: Literal["user", "bot", "agent"]
    sender_name: str
    message: str
    timestamp: str
    is_escalation_notice: bool | None = None
    rag_sources: list[str] | None = None
    confidence_score: float | None = None


class AiSuggestion(CamelModel):
    confidence: float
    source_doc: str
    summary: str
    draft_response: str


class Ticket(CamelModel):
    id: str
    ticket_number: str
    company_id: str
    company_name: str
    company_color: str
    company_bg: str
    status: TicketStatus
    user_query_excerpt: str
    escalation_reason: str
    relative_time: str
    exact_timestamp: str
    customer_name: str
    customer_email: str
    customer_channel: str
    transcript: list[ChatMessage]
    ai_suggestion: AiSuggestion
    assigned_agent: str | None = None      # nombre para mostrar
    assigned_agent_id: str | None = None   # id del usuario asignado
    is_live: bool | None = None


class AssignableAgent(CamelModel):
    """Usuario al que se puede asignar un ticket de su empresa."""
    id: str
    name: str
    role: str
    company_id: str


class SystemMetrics(CamelModel):
    open_tickets: int
    urgent_tickets: int
    avg_resolution_time: str
    bot_resolved_today: int
    bot_resolution_rate: float
    escalation_rate: float
    total_conversations_today: int


class ChunkOut(CamelModel):
    id: str
    order: int
    text: str


class ChatResponse(CamelModel):
    conversation_id: str
    messages: list[ChatMessage]
    derived: bool
    ticket_number: str | None = None


# ---------- entrada ----------
class CompanyCreate(CamelModel):
    name: str = Field(min_length=1, max_length=120)
    industry: str | None = None
    agent_name: str | None = None
    tone: Tone = "formal"
    custom_instructions: str | None = None
    brand_color: str = "#4F46E5"
    brand_bg: str = "#EEF2FF"
    logo_initials: str | None = None


class CompanyUpdate(CamelModel):
    name: str | None = None
    industry: str | None = None
    agent_name: str | None = None
    agent_status: AgentStatus | None = None
    tone: Tone | None = None
    custom_instructions: str | None = None
    rag_threshold: float | None = Field(default=None, ge=0.1, le=1.0)
    brand_color: str | None = None
    brand_bg: str | None = None
    logo_initials: str | None = None


class TicketUpdate(CamelModel):
    status: TicketStatus | None = None
    assigned_agent_id: str | None = None  # id de usuario; null explícito = dejar sin asignar


class AgentReply(CamelModel):
    text: str = Field(min_length=1)  # el remitente sale del usuario autenticado, no del cuerpo


class ChatRequest(CamelModel):
    message: str = Field(min_length=1, max_length=4000)
    conversation_id: str | None = None
    customer_name: str | None = None
    customer_email: str | None = None
    channel: str = "Web Chat"
    escalate: bool = False  # el usuario pidió hablar con un humano


# ---------- autenticación y usuarios ----------
Role = Literal["superadmin", "admin_empresa", "encargado_tickets", "encargado_agente"]


class LoginRequest(CamelModel):
    email: str
    password: str


class UserOut(CamelModel):
    id: str
    email: str
    name: str
    role: Role
    company_id: str | None = None      # slug de la empresa (None = superadmin)
    active: bool = True


class TokenOut(CamelModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class UserCreate(CamelModel):
    email: str
    name: str = ""
    password: str = Field(min_length=8)
    role: Role
    company_id: str | None = None      # slug; obligatorio salvo para superadmin


class UserUpdate(CamelModel):
    name: str | None = None
    role: Role | None = None
    active: bool | None = None
    password: str | None = Field(default=None, min_length=8)


# ---------- analítica (vista Analítica) ----------
class AnalyticsDay(CamelModel):
    date: str
    bot: int
    human: int
    total: int


class AnalyticsCompany(CamelModel):
    id: str
    name: str
    industry: str
    brand_color: str
    total_queries: int
    bot_resolved: int
    bot_rate: float
    escalated: int
    escalation_rate: float


class Analytics(CamelModel):
    days: int
    total_conversations: int
    bot_resolved: int
    human_escalated: int
    bot_rate: float
    escalation_rate: float
    conversations_delta: float | None = None  # % vs el periodo anterior; null si no hay base
    avg_human_resolution: str
    daily: list[AnalyticsDay]
    companies: list[AnalyticsCompany]
