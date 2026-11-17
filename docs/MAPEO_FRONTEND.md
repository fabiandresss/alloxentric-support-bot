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
| aiModel            | modelo_ia (id del catálogo `services/modelos.py`) |
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
status=estado · escalationReason=motivo_derivacion · assignedAgent=nombre del usuario en agente_asignado_id · assignedAgentId=agente_asignado_id
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
   GET  /empresas/{slug}/finops?desde&hasta&modelo&agrupar=dia|semana|mes, PATCH /empresas/{slug}/plan -> FinOpsView "Consumo y costos" (`FinOpsSummary`, `SpendPlan`)
   GET  /empresas/{slug}/conversaciones (filtros q, ticket, canal, desde, hasta, limit, offset), GET /conversaciones/{id} -> ConversationsView (`ConversationList`, `ConversationDetail`)
   /empresas/{slug}/testing/... (conjuntos, casos, generar, ejecutar, ejecuciones, exportar)      -> TestingView, TestRunView (`TestSet`, `TestRunDetail`, ...)
   GET  /empresas/{slug}/kb/resumen, GET /empresas/{slug}/kb/fragmentos?q&documento_id&limit&offset -> KnowledgeBaseView (`KbSummary`, `KbChunkList`)
   GET/POST /empresas/{slug}/notificaciones[/{id}/visto | /visto-todas]                            -> NotificationBell, Sidebar (insignias)
   POST /empresas/{slug}/testing/conjuntos/{id}/comparar, GET .../comparativas/{grupo}            -> ComparisonView (`TestComparison`)
   PUT  .../testing/resultados/{id}/etiqueta, GET .../testing/etiquetas, .../testing/calibraciones -> TestRunView (etiquetas), CalibrationPanel (`CalibrationRun`)
   POST /documentos/{id}/reemplazar, GET /documentos/{id}/versiones, POST .../versiones/{n}/restaurar -> KnowledgeBaseView, VersionsModal (`DocVersion`)
   GET  /empresas/{slug}/kb/calidad                                                                -> KnowledgeBaseView «Salud de la base» (`KbQuality`)
   PATCH /empresas/{slug} {allowedDomains}                                                         -> AgentConfigModal (sitios autorizados del widget)
   GET  /modelos-ia (catálogo de modelos de IA: `AiModelOption`)    -> ModelPicker (dentro de AgentConfigModal)
2. GET  /tickets, GET /tickets/{id}, PATCH /tickets/{id} (status solo `pendiente`/`urgente`; `cerrado` solo para cerrar un escalado; assignedAgentId), POST /tickets/{id}/respuesta (el remitente sale del usuario autenticado; envía la encuesta), GET /tickets/agentes -> CorestreamConsole, TicketDetailModal.
   Estados de `status`: pendiente | urgente | esperando_cliente | cerrado | escalado (+ `closeReason`).
3. POST /empresas/{slug}/documentos (multipart), DELETE /documentos/{id}, GET /documentos/{id}/fragmentos -> AgentConfigModal, DocumentDetailModal
4. POST /chat  (X-API-Key de la empresa) -> WidgetPreview, TestAgentModal
5. GET  /metricas -> MetricCards; GET /metricas/analitica?dias= -> AnalyticsView (tipo Analytics)
6. GET  /publico/{slug}, POST /publico/{slug}/chat, GET /publico/{slug}/conversaciones/{id} (sin autenticación) -> PublicChat (página /chat/{slug} e iframe de widget.min.js); POST /publico/{slug}/conversaciones/{id}/encuesta; tipos PublicAgent y PublicConversation

## Cambios en el front (YA HECHOS en frontend/)
- Reemplazar INITIAL_COMPANIES/TICKETS/METRICS de App.tsx por fetch al backend (src/api/client.ts, VITE_API_URL).
- Los handlers de App.tsx (handleUpdateTicketStatus, handleSendAgentReply, handleReassignAgent, handleUpdateCompany, handleAddCompany) pasan a llamar a la API y luego refrescar el estado.
- WidgetPreview y TestAgentModal hoy responden con guiones + setTimeout: cambiar por POST /chat.
- AgentConfigModal.handleFileUpload / handlePublish simulan con setTimeout: cambiar por subida real.
- Quitar de package.json: @google/genai, express, dotenv, tsx (no se usan en src/). Borrar GEMINI_API_KEY de .env.example.
- El dev server corre en el puerto 3000 (no 5173): CORS en FastAPI debe permitir http://localhost:3000.

## Semana 11: seguridad de la IA, registro, memoria y operación (endpoint -> componente / tipo)
7. POST /registro/usuario, POST /registro/empresa, POST /empresas/{slug}/chatbot -> Onboarding (Signup, CompanyStep, ChatbotStep) y PlanPicker; tipos Company.chatbotCreated / spendPlan, Role "registrado"
8. PATCH /empresas/{slug}/plan -> FinOpsView (PlanEditor); Company.spendPlan se ve en AgentDeploymentPanel
9. Company.security (SecurityConfig: pii, injection, forbiddenTopics, publicSources, customerMemory, moderation) y Company.schedule -> SecurityScheduleSections dentro de AgentConfigModal
10. GET /empresas/{slug}/seguridad/eventos -> SecurityView (SecurityOverview)
11. PUT /publico/{slug}/conversaciones/{id}/mensajes/{mid}/valoracion -> PublicChat (ChatMessage.rating); SourceDetail (con page) en PublicChat, TicketDetailModal y ConversationsView
12. POST /publico/{slug}/chat/stream (SSE: delta / done / error) -> api.streamPublicChat usado por PublicChat; DELETE /publico/{slug}/memoria/{visitorId} -> «Olvidar mis datos»; ChatPayload.visitorId
13. GET /empresas/{slug}/kb/vacios -> UnansweredPanel; GET|POST /empresas/{slug}/kb/propuestas-faq[/{id}/aceptar|descartar] -> FaqProposals (FaqProposalList)
14. GET /empresas/{slug}/ia/rendimiento -> PerformancePanel dentro de FinOpsView (Performance)
15. KbDocument.warning y KbChunk.page -> KnowledgeBaseView; POST /tickets/{id}/resumen -> TicketDetailModal (TicketSummary)
