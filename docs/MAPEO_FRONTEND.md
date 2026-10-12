# Mapeo front (AI Studio) <-> modelo de datos <-> API

El front usa camelCase en inglés; la API debe devolver ESA forma (Pydantic con alias camelCase)
para no tocar los componentes. La base usa español/snake_case.

## Company  <-  empresas (+ documentos)
| Front              | Base                                   |
|--------------------|----------------------------------------|
| id / slug          | empresas.slug (el uuid queda interno)  |
| name               | nombre                                 |
| industry           | industria                              |
| logoInitials, brandColor, brandBg | iniciales_logo, color_marca, color_fondo |
| agentName          | nombre_agente                          |
| agentStatus        | estado_agente                          |
| tone               | tono                                   |
| customInstructions | instrucciones                          |
| ragThreshold       | umbral_rag                             |
| version            | "v{version}"                           |
| webChatUrl         | calculado: {BASE_URL}/chat/{slug}      |
| documents / documentsCount | documentos (count)             |
| lastUpdated        | actualizada_en (formatear en el front) |
| monthlyQueries, botResolutionRate | CALCULADOS con queries sobre mensajes/tickets |

## DocumentItem  <-  documentos
name=nombre · type=tipo · size=tamano_bytes (formatear) · uploadedAt=subido_en
status=estado (procesando|procesado|error) · chunkCount=COUNT(fragmentos_embeddings)

## Ticket  <-  tickets + conversaciones + empresas
ticketNumber=numero · companyId=empresas.slug · companyName/Color/Bg=empresas.*
status=estado · escalationReason=motivo_derivacion · assignedAgent=agente_asignado
customerName/Email/Channel=conversaciones.nombre_cliente/email_cliente/canal
userQueryExcerpt=primer mensaje rol=usuario · exactTimestamp/relativeTime=creado_en
aiSuggestion=sugerencia_ia (JSONB, mismas llaves que el front)
transcript=mensajes de la conversación

## ChatMessage  <-  mensajes
sender=rol · senderName=nombre_remitente · message=contenido · timestamp=creado_en
isEscalationNotice=es_aviso_derivacion · ragSources=fuentes · confidenceScore=confianza

## SystemMetrics y AnalyticsView
No tienen tabla: se calculan con COUNT/AVG sobre tickets y mensajes (endpoint GET /metricas).

## Endpoints (en el orden que conviene construirlos)
1. GET  /empresas, POST /empresas, PATCH /empresas/{slug}          -> AgentDeploymentPanel, AddCompanyModal, AgentConfigModal
2. GET  /tickets, GET /tickets/{id}, PATCH /tickets/{id} (estado, agente_asignado), POST /tickets/{id}/respuesta -> CorestreamConsole, TicketDetailModal
3. POST /empresas/{slug}/documentos (multipart), DELETE /documentos/{id}, GET /documentos/{id}/fragmentos -> AgentConfigModal, DocumentDetailModal
4. POST /chat  (X-API-Key de la empresa) -> WidgetPreview, TestAgentModal
5. GET  /metricas -> MetricCards, AnalyticsView

## Cambios en el front (YA HECHOS en frontend/)
- Reemplazar INITIAL_COMPANIES/TICKETS/METRICS de App.tsx por fetch al backend (src/api/client.ts, VITE_API_URL).
- Los handlers de App.tsx (handleUpdateTicketStatus, handleSendAgentReply, handleReassignAgent, handleUpdateCompany, handleAddCompany) pasan a llamar a la API y luego refrescar el estado.
- WidgetPreview y TestAgentModal hoy responden con guiones + setTimeout: cambiar por POST /chat.
- AgentConfigModal.handleFileUpload / handlePublish simulan con setTimeout: cambiar por subida real.
- Quitar de package.json: @google/genai, express, dotenv, tsx (no se usan en src/). Borrar GEMINI_API_KEY de .env.example.
- El dev server corre en el puerto 3000 (no 5173): CORS en FastAPI debe permitir http://localhost:3000.
