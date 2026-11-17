"""Schemas con la MISMA forma que src/types/index.ts del front (camelCase)."""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

TicketStatus = Literal["pendiente", "urgente", "esperando_cliente", "cerrado", "escalado"]
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
    ai_model: str
    allowed_domains: list[str] = []      # sitios donde puede ir el widget; vacío = cualquiera
    chatbot_created: bool = True         # false = la empresa se registró y falta crear su chatbot (uno por empresa)
    spend_plan: "SpendPlan"              # gasto del chatbot: ilimitado o con tope mensual (y diario)
    security: "SecurityConfig"
    schedule: "Schedule"
    last_updated: str
    version: str
    api_key: str | None = None  # solo al crear / rotar


class AiModel(CamelModel):
    id: str
    name: str
    provider: str
    provider_id: str   # clave del logo del proveedor en el front
    description: str
    recommended: bool = False


class PublicAgent(CamelModel):
    """Lo único que expone la página pública de chat (sin documentos, claves ni métricas)."""
    name: str
    agent_name: str
    logo_initials: str
    brand_color: str
    brand_bg: str
    agent_status: AgentStatus
    human_support: "HumanSupport | None" = None


class SecurityConfig(CamelModel):
    """Guardarraíles de la IA de la empresa (ver services/seguridad.py)."""
    pii: bool = True                                   # enmascarar RUT, tarjetas, correos, teléfonos y claves antes del modelo y de guardar
    injection: bool = True                             # bloquear intentos de inyección de prompt y jailbreak
    forbidden_topics: list[str] = Field(default_factory=list, max_length=30)
    public_sources: Literal["extracto", "nombre", "ninguna"] = "extracto"   # qué ve el cliente de las fuentes de una respuesta
    customer_memory: bool = True       # recordar el nombre y las últimas consultas de quien vuelve (con su identificador anónimo)
    moderation: bool = True            # filtrar contenido dañino (insultos, amenazas, instrucciones para dañar) en la respuesta


class Schedule(CamelModel):
    """Horario de atención humana. `days`: día (lun…dom) -> [desde, hasta] en HH:MM; un día ausente no tiene atención."""
    enabled: bool = False
    days: dict[str, list[str]] = Field(default_factory=dict)
    out_of_hours_message: str = Field(default="", max_length=300)


class HumanSupport(CamelModel):
    """Lo que ve el cliente sobre la atención humana: si hoy hay alguien, el horario y el aviso fuera de horario."""
    enabled: bool
    open: bool
    schedule: str | None = None
    message: str | None = None


class SourceDetail(CamelModel):
    """De dónde salió una respuesta. Para el equipo trae ids (abrir el fragmento); para el cliente solo lo que permite la empresa."""
    document_id: str | None = None
    document_name: str
    fragment_id: str | None = None
    order: int | None = None
    excerpt: str | None = None
    confidence: float | None = None
    page: int | None = None            # página del PDF de la que sale el fragmento


class ChatMessage(CamelModel):
    id: str
    sender: Literal["user", "bot", "agent"]
    sender_name: str
    message: str
    timestamp: str
    is_escalation_notice: bool | None = None
    rag_sources: list[str] | None = None
    source_details: list[SourceDetail] | None = None
    confidence_score: float | None = None
    rating: Literal["up", "down"] | None = None         # valoración del cliente a la respuesta del bot
    rating_comment: str | None = None


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
    ai_summary: "TicketSummary | None" = None
    close_reason: str | None = None        # confirmado_cliente | sin_respuesta | gestion_manual | migrado
    assigned_agent: str | None = None      # nombre para mostrar
    assigned_agent_id: str | None = None   # id del usuario asignado
    is_live: bool | None = None


class TicketSummary(CamelModel):
    """Resumen para el agente humano: qué quiere el cliente, por qué se derivó y qué urgencia parece."""
    summary: str
    reason: str = ""
    urgency: Literal["baja", "media", "alta"]
    source: Literal["ia", "reglas"]
    generated_at: str | None = None


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


class PublicConversation(CamelModel):
    """Estado de una conversación pública: el cliente la usa para ver las respuestas del agente humano."""
    conversation_id: str
    messages: list[ChatMessage]
    derived: bool
    ticket_number: str | None = None
    ticket_status: TicketStatus | None = None


# ---------- entrada ----------
class CompanyCreate(CamelModel):
    name: str = Field(min_length=1, max_length=120)
    industry: str | None = None
    agent_name: str | None = None
    tone: Tone = "formal"
    custom_instructions: str | None = None
    brand_color: str = "#D20A2E"
    brand_bg: str = "#FCEDEF"
    logo_initials: str | None = None


class CompanyUpdate(CamelModel):
    name: str | None = None
    industry: str | None = None
    agent_name: str | None = None
    agent_status: AgentStatus | None = None
    tone: Tone | None = None
    custom_instructions: str | None = None
    rag_threshold: float | None = Field(default=None, ge=0.1, le=1.0)
    ai_model: str | None = None   # id del catálogo (GET /modelos-ia); se valida en el router
    allowed_domains: list[str] | None = None   # se normaliza y valida en el router
    security: SecurityConfig | None = None
    schedule: Schedule | None = None           # se valida en el router
    brand_color: str | None = None
    brand_bg: str | None = None
    logo_initials: str | None = None


class TicketUpdate(CamelModel):
    status: TicketStatus | None = None
    assigned_agent_id: str | None = None  # id de usuario; null explícito = dejar sin asignar


class SurveyAnswer(CamelModel):
    resolved: bool  # el cliente responde la encuesta: ¿se resolvió tu consulta?


class AgentReply(CamelModel):
    text: str = Field(min_length=1)  # el remitente sale del usuario autenticado, no del cuerpo


class RatingIn(CamelModel):
    rating: Literal["up", "down"] | None = None   # null = quitar la valoración
    comment: str | None = Field(default=None, max_length=500)


class ChatRequest(CamelModel):
    message: str = Field(min_length=1, max_length=4000)
    conversation_id: str | None = None
    customer_name: str | None = None
    customer_email: str | None = None
    channel: str = "Web Chat"
    escalate: bool = False  # el usuario pidió hablar con un humano
    visitor_id: str | None = Field(default=None, pattern=r"^[0-9a-fA-F\-]{16,64}$")   # identificador anónimo del navegador (memoria del cliente que vuelve)


# ---------- autenticación y usuarios ----------
Role = Literal["superadmin", "admin_empresa", "encargado_tickets", "encargado_agente"]


class LoginRequest(CamelModel):
    email: str
    password: str


class UserOut(CamelModel):
    id: str
    email: str
    name: str
    role: Role | Literal["registrado"]   # «registrado» = cuenta creada que aún no registra su empresa
    company_id: str | None = None      # slug de la empresa (None = superadmin)
    active: bool = True


class RegisterUser(CamelModel):
    """Registro de una persona (paso 1). Queda como `registrado`, sin empresa, hasta que registre la suya."""
    email: str = Field(min_length=5, max_length=255)
    name: str = Field(min_length=2, max_length=120)
    password: str = Field(min_length=10, max_length=128)
    website: str = Field(default="", max_length=200)   # trampa para bots (campo oculto): una persona nunca lo llena


class RegisterCompany(CamelModel):
    """Registro de la empresa (paso 2) por quien se acaba de registrar: pasa a ser su admin."""
    name: str = Field(min_length=2, max_length=120)
    industry: str | None = Field(default=None, max_length=160)
    site_url: str | None = Field(default=None, max_length=255)


class ChatbotCreate(CamelModel):
    """Creación del chatbot de la empresa (paso 3). Cada empresa tiene uno solo."""
    agent_name: str = Field(min_length=2, max_length=80)
    tone: Tone = "cercano"
    custom_instructions: str | None = Field(default=None, max_length=2000)
    brand_color: str = Field(default="#D20A2E", pattern=r"^#[0-9A-Fa-f]{6}$")
    spend_plan: "SpendPlanUpdate"        # obligatorio: quien crea el chatbot elige si su gasto es ilimitado o tiene un límite


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
    satisfaction: float | None = None     # % de valoraciones positivas; null si nadie ha valorado


class Satisfaction(CamelModel):
    """Valoraciones (👍/👎) que dejan los clientes a las respuestas del bot."""
    rated: int
    up: int
    down: int
    rate: float | None = None             # % positivas
    coverage: float | None = None         # % de respuestas del bot que fueron valoradas


class Analytics(CamelModel):
    days: int
    total_conversations: int
    bot_resolved: int
    human_escalated: int
    bot_rate: float
    escalation_rate: float
    conversations_delta: float | None = None  # % vs el periodo anterior; null si no hay base
    avg_human_resolution: str
    satisfaction: Satisfaction
    daily: list[AnalyticsDay]
    companies: list[AnalyticsCompany]


# ---------- FinOps (consumo de IA) y registro de conversaciones ----------
class SpendPlan(CamelModel):
    mode: Literal["limitado", "sin_limite"]
    monthly_limit_usd: float | None = None   # solo con mode=limitado
    daily_limit_usd: float | None = None     # tope por día (opcional, solo con mode=limitado)


class SpendPlanUpdate(CamelModel):
    mode: Literal["limitado", "sin_limite"]
    monthly_limit_usd: float | None = Field(default=None, ge=0.01, le=1_000_000)   # en dólares, con centavos
    daily_limit_usd: float | None = Field(default=None, ge=0.01, le=1_000_000)     # opcional; no puede superar al mensual


class FinOpsModelRow(CamelModel):
    model_id: str
    name: str
    provider: str
    provider_id: str
    calls: int
    input_tokens: int
    output_tokens: int
    cost_usd: float


class FinOpsPoint(CamelModel):
    """Un tramo del gráfico: un día, una semana (lunes a domingo) o un mes, recortado al rango consultado."""
    date: str        # primer día del tramo (AAAA-MM-DD)
    end_date: str    # último día del tramo
    calls: int
    input_tokens: int
    output_tokens: int
    cost_usd: float


class FinOpsBilling(CamelModel):
    """Ciclo de cobro: el mes en curso completo y todos los modelos, sin importar el filtro. Es lo que mide el límite del plan."""
    month: str       # AAAA-MM
    spent_usd: float
    used_pct: float | None = None        # % del límite (solo plan limitado)
    limit_reached: bool                  # tope alcanzado: el agente responde en modo extractivo
    near_limit: bool                     # >= 80 % y aún bajo el tope
    projected_usd: float | None = None   # proyección al cierre del mes
    daily_spent_usd: float = 0.0
    daily_used_pct: float | None = None  # % del tope diario (si hay)
    daily_limit_reached: bool = False


class FinOpsSummary(CamelModel):
    range_from: str
    range_to: str
    group_by: Literal["dia", "semana", "mes"]
    model: str | None = None             # filtro de modelo aplicado a los totales y al gráfico
    plan: SpendPlan
    billing: FinOpsBilling
    spent_usd: float                     # del rango y modelo filtrados
    calls: int
    input_tokens: int
    output_tokens: int
    conversations: int
    avg_cost_per_conversation_usd: float | None = None
    by_model: list[FinOpsModelRow]       # del rango, sin el filtro de modelo (para poder compararlos)
    series: list[FinOpsPoint]


class ConversationListItem(CamelModel):
    id: str
    customer_name: str
    customer_email: str | None = None
    channel: str
    started_at: str                      # ISO 8601
    last_activity_at: str                # ISO 8601
    message_count: int
    escalated: bool                      # fue derivada a un humano
    ticket_number: str | None = None
    ticket_status: str | None = None
    first_message: str = ""
    last_message: str = ""
    cost_usd: float = 0.0
    thumbs_up: int = 0
    thumbs_down: int = 0


class ConversationList(CamelModel):
    total: int
    items: list[ConversationListItem]


class ConversationDetail(CamelModel):
    summary: ConversationListItem
    messages: list[ChatMessage]
    input_tokens: int
    output_tokens: int
    ai_calls: int


# ---------- Rendimiento de la IA (trazas) ----------
class PerfModelRow(CamelModel):
    model_id: str
    name: str
    calls: int
    errors: int
    p50_ms: int
    p95_ms: int


class PerfTypeCount(CamelModel):
    type: str          # respuesta | sugerencia | resumen | memoria | ocr | cache
    count: int


class PerfError(CamelModel):
    error: str
    count: int


class Performance(CamelModel):
    days: int
    calls: int                    # llamadas al modelo (sin contar las servidas desde la caché)
    errors: int
    error_rate: float             # %
    p50_ms: int
    p95_ms: int
    fallbacks: int                # respondió el modelo de respaldo porque el de la empresa falló
    cache_hits: int               # respuestas reutilizadas sin llamar al modelo
    cache_entries: int
    cache_saved_usd: float        # ahorro estimado de la caché
    by_model: list[PerfModelRow]
    by_type: list[PerfTypeCount]
    top_errors: list[PerfError]


# ---------- Propuestas de FAQ (lo que respondió un humano, para la base de conocimiento) ----------
class FaqProposal(CamelModel):
    id: str
    ticket_number: str
    question: str
    answer: str
    created_at: str


class FaqProposalList(CamelModel):
    pending: list[FaqProposal]
    accepted: int
    discarded: int


class FaqProposalAccept(CamelModel):
    question: str = Field(min_length=3, max_length=500)
    answer: str = Field(min_length=10, max_length=2000)


# ---------- Seguridad de la IA, preguntas sin respuesta ----------
class SecurityEvent(CamelModel):
    id: str
    type: str                  # inyeccion | tema_prohibido | pii | fuga_salida | salida_saneada | fragmento_sospechoso | limite_conversacion
    severity: Literal["baja", "media", "alta"]
    detail: str                # ya enmascarado
    signals: list[str] = []
    conversation_id: str | None = None
    created_at: str


class SecurityCount(CamelModel):
    type: str
    count: int


class SecurityOverview(CamelModel):
    days: int
    total: int
    high: int
    by_type: list[SecurityCount]
    events: list[SecurityEvent]


class UnansweredQuestion(CamelModel):
    question: str
    at: str
    conversation_id: str


class UnansweredGroup(CamelModel):
    """Preguntas parecidas que el bot no pudo resolver: son los temas que le faltan a la documentación."""
    topic: str                              # la pregunta más representativa
    count: int
    last_at: str
    reason: Literal["sin_informacion", "modelo_no_sabe", "baja_valoracion"]
    closest_document: str | None = None     # el documento que más se acerca (aunque no alcanzó)
    closest_confidence: float | None = None
    suggestion: str
    questions: list[UnansweredQuestion]


class UnansweredReport(CamelModel):
    days: int
    total_questions: int
    groups: list[UnansweredGroup]


# ---------- Pruebas del agente (golden sets) y base de conocimiento ----------
class TestCase(CamelModel):
    id: str
    order: int
    question: str
    expected_answer: str | None = None
    expected_document: str | None = None
    should_escalate: bool = False        # pregunta fuera de la documentación: debe derivar a un humano
    origin: Literal["manual", "ia", "real"] = "manual"    # real = nació de una conversación
    conversation_id: str | None = None   # la conversación de la que salió (origin real)


class TestCaseIn(CamelModel):
    question: str = Field(min_length=3, max_length=1000)
    expected_answer: str | None = Field(default=None, max_length=2000)
    expected_document: str | None = Field(default=None, max_length=255)
    should_escalate: bool = False
    conversation_id: str | None = None   # si el caso sale de una conversación real (debe ser de esta empresa)


class TestCaseUpdate(CamelModel):
    question: str | None = Field(default=None, min_length=3, max_length=1000)
    expected_answer: str | None = Field(default=None, max_length=2000)
    expected_document: str | None = Field(default=None, max_length=255)
    should_escalate: bool | None = None


class TestKb(CamelModel):
    documents: int
    fragments: int


class TestRunSummary(CamelModel):
    total: int
    passed: int
    failed: int
    errors: int
    pass_rate: float                       # % de casos aprobados
    avg_score: float | None = None         # 0..1, solo casos con respuesta esperada
    source_accuracy: float | None = None   # % de casos que citaron el documento esperado
    derivation_accuracy: float | None = None   # % de casos donde derivó (o no) como se esperaba
    avg_confidence: float | None = None    # % de confianza RAG promedio
    avg_latency_ms: int
    p95_latency_ms: int
    input_tokens: int
    output_tokens: int
    agent_cost_usd: float
    judge_cost_usd: float
    limit_reached: bool = False            # el tope mensual cortó la IA: el agente respondió en modo extractivo


class TestRunBrief(CamelModel):
    id: str
    set_id: str
    set_name: str
    status: Literal["ejecutando", "completada", "error"]
    total: int
    completed: int
    judge_model_id: str                    # LLM as a Judge que puntuó las respuestas
    group_id: str | None = None            # corridas lanzadas juntas para comparar modelos
    origin: Literal["manual", "automatica"] = "manual"
    trigger: str | None = None             # qué la disparó (p. ej. «subir tarifas.pdf»)
    started_at: str
    finished_at: str | None = None
    model_id: str
    rag_threshold: float
    kb: TestKb                             # cómo estaba la base de conocimiento al correr
    created_by: str | None = None
    summary: TestRunSummary | None = None


class TestSetItem(CamelModel):
    id: str
    name: str
    description: str | None = None
    case_count: int
    ai_cases: int
    generated_with: str | None = None      # modelo de IA que propuso los casos
    auto_run: bool = False                 # se corre solo al ingestar, reemplazar o eliminar documentos
    created_at: str
    updated_at: str
    last_run: TestRunBrief | None = None


class TestSet(TestSetItem):
    cases: list[TestCase]


class TestSetIn(CamelModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=1000)


class TestSetUpdate(CamelModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    auto_run: bool | None = None


class TestSetGenerate(CamelModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    count: int = Field(default=10, ge=1, le=30)               # casos con respuesta en la documentación
    negatives: int = Field(default=2, ge=0, le=10)            # casos fuera de la documentación (deben derivar)
    document_ids: list[str] | None = None                     # None = toda la base de conocimiento
    model_id: str | None = None                               # modelo que genera los casos (catálogo); None = el recomendado


class TestRunStart(CamelModel):
    judge_model_id: str | None = None      # LLM as a Judge (catálogo); None = el recomendado


class TestResult(CamelModel):
    id: str
    order: int
    question: str
    expected_answer: str | None = None
    expected_document: str | None = None
    should_escalate: bool
    answer: str
    escalated: bool
    sources: list[str]
    confidence: float | None = None
    latency_ms: int
    input_tokens: int
    output_tokens: int
    cost_usd: float
    source_ok: bool | None = None
    escalation_ok: bool
    score: float | None = None
    verdict: Literal["aprobado", "fallido", "error"]
    reason: str | None = None
    previous_verdict: str | None = None    # veredicto del mismo caso en la corrida anterior (para ver regresiones)
    human_label: Literal["correcto", "incorrecto"] | None = None   # lo que dijo una persona (para calibrar al juez)


class TestRunDetail(CamelModel):
    run: TestRunBrief
    previous: TestRunBrief | None = None
    error: str | None = None
    results: list[TestResult]


class KbTypeCount(CamelModel):
    type: str
    count: int


class KbSummary(CamelModel):
    documents: int
    processed: int
    processing: int
    errors: int
    fragments: int
    characters: int
    embedded_fragments: int
    models: list[str]                      # embedders que generaron los vectores
    last_updated: str | None = None        # ISO 8601 de la última subida
    by_type: list[KbTypeCount]


class PipelineConfig(CamelModel):
    """Ajustes de ingesta y recuperación de una empresa (ver services/pipeline.py). Los rangos válidos los devuelve GET .../kb/pipeline."""
    chunk_max: int                  # caracteres máximos por fragmento
    chunk_min: int                  # los fragmentos más cortos se unen al siguiente
    chunk_overlap: int              # caracteres del fragmento anterior que se repiten al inicio del siguiente
    top_k: int                      # fragmentos que se pasan al modelo
    hybrid: bool                    # vectores + palabras clave
    ocr: bool                       # transcribir PDFs escaneados con visión


class PipelineState(CamelModel):
    config: PipelineConfig          # la vigente (defecto + lo que cambió la empresa)
    defaults: PipelineConfig
    limits: dict[str, list[int]]    # clave → [mínimo, máximo]
    customized: bool                # ¿difiere del defecto?
    reprocessable: int              # documentos con archivo, que se pueden volver a fragmentar
    documents: int


class PipelineReprocess(CamelModel):
    queued: int
    skipped: int                    # documentos sin archivo (p. ej. los del seed)


class KbDocument(CamelModel):
    """Un documento de la base de conocimiento con lo que REALMENTE quedó ingestado (los fragmentos se cuentan, no se confía en un contador)."""
    id: str
    name: str
    type: str
    size_bytes: int
    uploaded_at: str                 # ISO 8601
    status: Literal["procesando", "procesado", "error"]
    fragments: int
    characters: int
    embedded_fragments: int
    warning: str | None = None       # p. ej. «2 fragmento(s) con posibles órdenes ocultas dirigidas al modelo»


class KbChunk(CamelModel):
    id: str
    document_id: str
    document_name: str
    order: int
    text: str
    characters: int
    embedded: bool
    model: str | None = None
    page: int | None = None          # página del PDF


class KbChunkList(CamelModel):
    total: int
    items: list[KbChunk]


# ---------- Notificaciones ----------
class Notification(CamelModel):
    id: str
    type: str
    title: str
    message: str
    view: str | None = None     # pantalla a la que lleva (finops, testing…)
    ref: str | None = None
    created_at: str
    seen: bool


# ---------- Comparar modelos y calibrar al juez ----------
class TestCompareStart(CamelModel):
    model_ids: list[str] = Field(min_length=2, max_length=5)       # agentes a comparar con el mismo golden set
    judge_model_id: str | None = None


class TestComparison(CamelModel):
    group_id: str
    set_id: str
    set_name: str
    judge_model_id: str
    min_quality: float                      # tasa de aprobación mínima para recomendar (%)
    runs: list[TestRunBrief]
    recommended_run_id: str | None = None   # el más barato que cumple la calidad mínima
    recommendation: str                     # explicación en lenguaje claro


class TestLabel(CamelModel):
    label: Literal["correcto", "incorrecto"] | None = None         # None = quitar la etiqueta


class LabelCounts(CamelModel):
    labeled: int                            # respuestas etiquetadas que sirven para calibrar
    correct: int
    incorrect: int
    min_required: int
    max_used: int


class CalibrationStart(CamelModel):
    judge_model_ids: list[str] = Field(min_length=1, max_length=4)


class CalibrationJudge(CamelModel):
    model_id: str
    n: int
    agreement: float                        # % de acuerdo con la persona
    true_positives: int
    true_negatives: int
    false_positives: int                    # el juez aprobó lo que la persona dio por incorrecto
    false_negatives: int                    # el juez rechazó lo que la persona dio por correcto
    precision: float | None = None
    recall: float | None = None
    kappa: float                            # acuerdo corregido por azar (1 = perfecto, 0 = como tirar una moneda)
    without_judge: int                      # veces que el juez no dio un puntaje válido
    cost_usd: float
    avg_score_if_correct: float | None = None
    avg_score_if_incorrect: float | None = None


class CalibrationRun(CamelModel):
    id: str
    status: Literal["ejecutando", "completada", "error"]
    judge_model_ids: list[str]
    labeled: int
    total: int
    completed: int
    started_at: str
    finished_at: str | None = None
    created_by: str | None = None
    error: str | None = None
    judges: list[CalibrationJudge] = []


# ---------- Versiones de documentos y calidad de la base de conocimiento ----------
class DocVersion(CamelModel):
    version: int
    name: str
    type: str
    size_bytes: int
    fragments: int
    uploaded_at: str
    replaced_at: str | None = None   # cuándo fue reemplazada (las anteriores)
    current: bool
    restorable: bool                 # el archivo sigue en el almacenamiento


class KbIssue(CamelModel):
    code: str
    severity: Literal["alta", "media", "baja"]
    title: str
    detail: str
    count: int
    documents: list[str]


class KbQuality(CamelModel):
    score: int                       # 0 a 100
    issues: list[KbIssue]
    documents_checked: int
    fragments_checked: int


for _m in (Company, PublicAgent, Ticket, ChatbotCreate):
    _m.model_rebuild()
