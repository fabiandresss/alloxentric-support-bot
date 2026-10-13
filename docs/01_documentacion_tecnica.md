# Documentación técnica — Chatbot de Soporte Alloxentric

Capstone PTY4614 · Duoc UC · Fabián Armijo y Vicente Balladares · versión de la semana 9 (6 de octubre de 2026)

## 1. Qué es

Plataforma de soporte con IA, **multi-tenant**, que varias empresas del ecosistema Alloxentric (WellQ, Alloxentric,
Dani ETH, Dani27001, Aprueba) usan para atender a sus propios usuarios. Cada empresa carga su documentación; el
chatbot responde con RAG sobre *esa* documentación y, cuando no puede resolver, **deriva a un agente humano** creando
un ticket en Corestream. El sistema corre **100% en local** (sin nube).

## 2. Arquitectura

![Arquitectura](diagramas/arquitectura.png)

| Componente | Qué hace | Dónde está |
|---|---|---|
| Login y usuarios | Inicio de sesión (JWT), roles y gestión de usuarios | `LoginScreen.tsx`, `UsersView.tsx`, `auth/permissions.ts`, `backend/app/routers/auth.py` |
| Panel de administración | Alta de empresas, configuración del agente, carga de documentos, API key y widget | `frontend/src/components/AgentDeploymentPanel.tsx`, `AgentConfigModal.tsx`, `EmbedWidgetModal.tsx` |
| Consola de soporte | El agente humano ve los tickets derivados, la transcripción y una respuesta sugerida | `CorestreamConsole.tsx`, `TicketDetailModal.tsx` |
| Widget de chat | Lo que ve el usuario final | `WidgetPreview.tsx` (vista previa) |
| API REST | Expone todo por HTTP/JSON | `backend/app/routers/` |
| Servicios | Lógica de negocio separada de las rutas | `backend/app/services/` |
| PostgreSQL + pgvector | Guarda empresas, documentos, fragmentos con embeddings, conversaciones, mensajes y tickets | `docker-compose.yml`, `backend/app/models/` |
| Redis | Reservado para Celery (ingesta en segundo plano) | `docker-compose.yml` — **pendiente** |
| Carpeta `storage/` | Archivos originales subidos, una subcarpeta por empresa | `STORAGE_DIR` en `.env` |
| DeepSeek / Corestream | Modelo de lenguaje y ticketera | DeepSeek integrado (modo extractivo sin clave); Corestream es un mock |

El front **nunca** habla con la base de datos: todo pasa por la API.

## 3. Stack

| Capa | Tecnología |
|---|---|
| Backend | Python 3.11+, FastAPI, Uvicorn |
| Base de datos | PostgreSQL 16 + extensión pgvector (Docker) |
| ORM y migraciones | SQLAlchemy 2 + Alembic |
| Documentos | `pypdf` (PDF), `python-docx` (DOCX), texto plano (TXT, CSV, FAQ) |
| Frontend | React 19 + TypeScript + Vite + Tailwind (prototipo de Google AI Studio) |
| Pruebas | pytest (API contra Postgres real) y Playwright (navegador) |
| Orquestación local | Docker Compose |

## 4. Estructura del repositorio

```
proyecto/
├── docker-compose.yml        PostgreSQL+pgvector y Redis (puertos solo en 127.0.0.1)
├── .env.example
├── backend/
│   ├── app/
│   │   ├── main.py           app FastAPI + CORS
│   │   ├── config.py, db.py, deps.py, utils.py
│   │   ├── schemas.py        formas JSON (camelCase, iguales a los tipos del front)
│   │   ├── mappers.py        BD (español) -> JSON del front
│   │   ├── models/models.py  modelo de datos
│   │   ├── routers/          empresas · tickets · documentos · chat · metricas
│   │   └── services/         chat · motor_rag · ingesta · derivacion
│   ├── migrations/           Alembic (0001_modelo_inicial)
│   ├── tests/                pytest
│   ├── seed.py + seed_data.json
├── frontend/                 React (src/api/client.ts concentra las llamadas a la API)
├── tests_e2e/                prueba de navegador
└── docs/
```

## 5. Modelo de datos

![Modelo de datos](diagramas/modelo_datos.png)

Decisiones:

- **Multi-tenant por columna:** todas las tablas, salvo `empresas`, llevan `empresa_id` (con índice y `ON DELETE CASCADE`).
  `mensajes` y `tickets` lo repiten aunque se podría deducir de la conversación, para filtrar siempre por tenant sin joins.
- **Embeddings de 384 dimensiones** (modelo `paraphrase-multilingual-MiniLM-L12-v2`) con índice **HNSW** por distancia coseno.
- `empresas.slug` es el identificador público (`wellq`, `dani-eth`…); el `uuid` es interno. El front usa el `slug` como `id`.
- La API key de cada empresa se guarda **solo como hash SHA-256**; el texto plano se muestra una vez al generarla.
- `tickets.numero` (`COR-8921`) es único; el siguiente se calcula como el máximo + 1.
- `mensajes.creado_en` se asigna en Python (no con `now()` de Postgres): dentro de una misma transacción `now()` repite la hora
  y desordenaba la transcripción (bug encontrado en las pruebas).
- **Usuarios y roles:** `usuarios.rol` ∈ {`superadmin`, `admin_empresa`, `encargado_tickets`, `encargado_agente`}. `empresa_id` es nulo solo
  para el superadmin; dos `CHECK` en la BD lo garantizan. Las claves se guardan con PBKDF2-SHA256 + sal. Ver `MATRIZ_PERMISOS.md`.
- Los cambios de esquema se versionan con Alembic (`0001` modelo inicial con la extensión `vector`; `0002` roles de usuario; `0003` el agente asignado a un ticket pasa de texto libre a un usuario; `0004` ciclo del ticket con encuesta de resolución; `0005` modelo del embedding por fragmento).

## 6. Flujos principales

### 6.1 Conversación y derivación

![Flujo de chat](diagramas/flujo_chat.png)

1. El widget (un iframe a `/chat/{slug}`) envía `POST /publico/{slug}/chat`; la empresa se deduce del slug de la ruta (el cliente nunca manda `empresa_id`).
   Las integraciones propias pueden usar `POST /chat` con la API key de la empresa.
2. El motor busca fragmentos **solo de esa empresa** y calcula una confianza.
3. Si la confianza supera el **umbral de la empresa** (`umbral_rag`) responde con la fuente; si no, o si el usuario pide un humano,
   se crea el ticket, se guarda una sugerencia de respuesta y la conversación queda marcada como derivada.
4. Una vez derivada, los mensajes siguientes del usuario se guardan pero el bot ya no responde: responde el agente humano desde la consola.
5. El cliente ve esa respuesta en el mismo chat: la página `/chat/{slug}` (y el iframe del widget) consulta `GET /publico/{slug}/conversaciones/{id}`
   cada 5 s mientras la pestaña está visible. El `conversationId` se guarda en el navegador para recuperar la conversación al recargar,
   y el widget cerrado muestra un punto rojo cuando llega una respuesta.

### Ciclo de vida del ticket y encuesta de resolución (definición de negocio)

El encargado **no cierra** los tickets: cuando responde, el cliente recibe una **encuesta** («¿se resolvió tu consulta?») y es el cliente quien decide.

| Desde | Evento | Hacia |
|---|---|---|
| `pendiente` / `urgente` (cola del encargado) | el encargado responde (se envía la encuesta) | `esperando_cliente` |
| `esperando_cliente` | el cliente responde **Sí** | `cerrado` (final: **no se reabre**) |
| `esperando_cliente` | el cliente responde **No** | `escalado` (se gestiona fuera del chat) |
| `esperando_cliente` | pasan 72 h (`ENCUESTA_HORAS`) sin respuesta | `cerrado` (motivo `sin_respuesta`) |
| `esperando_cliente` | el cliente escribe en vez de contestar | `pendiente` (vuelve a la cola) |
| `escalado` | el admin de la empresa o el superadmin lo cierra | `cerrado` (motivo `gestion_manual`) |

- **Cerrado:** ya nadie lo modifica ni responde; si el cliente vuelve a escribir en esa conversación recibe 409 y debe iniciar una nueva (ticket nuevo).
- **Escalado:** sale de la cola del encargado de tickets (no lo ve) y el chat deja de responder; solo lo ven y lo cierran `admin_empresa` y `superadmin`.
- Sin planificador (Celery pendiente), el cierre a las 72 h se aplica al leer tickets, métricas y conversaciones (`services/ciclo_ticket.py`).

### 6.2 Ingesta de documentos

`POST /empresas/{slug}/documentos` → valida tipo (pdf, docx, txt, faq, csv) y tamaño (máx. 20 MB) → guarda el archivo en
`storage/<empresa_id>/` → crea el documento en estado `procesando` → en segundo plano extrae el texto, lo divide en fragmentos de
~800 caracteres por párrafos y los guarda → estado `procesado` (o `error` si el archivo está corrupto). El panel consulta cada
1,5 s hasta que termina.

## 6.3 Motor RAG y embeddings

Implementado en `services/embeddings.py`, `services/motor_rag.py` y `services/llm.py`. **Estado:** validado con el modelo real de punta a punta (E2E 49/49) y
calibrado con la batería de calidad (`backend/calidad_rag/`). **Falta probar DeepSeek en vivo** (aún no hay clave: hoy responde en modo extractivo).

**Embeddings (RF-04).** `EMBEDDINGS_BACKEND=sentence-transformers` (por defecto) usa `paraphrase-multilingual-MiniLM-L12-v2`, local, 384
dimensiones; la primera vez descarga el modelo (~470 MB) a la caché de Hugging Face y luego funciona sin conexión. `EMBEDDINGS_BACKEND=hash`
es un embedder por palabras sin descargas (pruebas, CI y respaldo si el modelo no carga: se avisa en el log y en `/health`).
Cada fragmento guarda el **id del embedder** que lo generó (`fragmentos_embeddings.modelo`) y la búsqueda solo usa los del embedder activo;
tras cambiar de modelo se regeneran con `python reindexar.py`.

**Fragmentación (RF-05).** Un fragmento por párrafo (los muy cortos se unen al siguiente; los de más de 700 caracteres se cortan por oraciones).
Juntar párrafos diluye la similitud y baja la confianza.

**Flujo de `responder`:**
1. *Intención* (reglas, sin LLM): pide un humano → deriva; saludo / gracias / despedida → respuesta fija sin derivar ni crear ticket; el resto es consulta.
2. *Recuperación:* embedding de la pregunta y búsqueda por coseno **solo en fragmentos de la empresa**, de documentos `procesado` y del embedder activo (top-4).
3. *Decisión:* la mejor similitud se convierte en **confianza 0..1** (rango `sim_min..sim_max` de cada embedder) y se compara con el `umbral_rag` de la empresa.
   Bajo el umbral → se deriva a un humano y se crea el ticket.
4. *Generación:* con `DEEPSEEK_API_KEY`, DeepSeek redacta la respuesta usando **solo los fragmentos de esa empresa**, con su tono e instrucciones;
   si contesta `NO_SE`, se deriva. Sin clave, o ante cualquier falla de red/API, responde de forma extractiva con el fragmento más relevante (el chat no se cae).
5. *Sugerencia para el agente humano* (`sugerir_respuesta`): borrador generado con los mismos fragmentos (o plantilla si no hay clave).

**Dónde se calcula la similitud (`RAG_SEARCH`).** `pgvector` (por defecto) usa la distancia coseno en la BD con el índice HNSW. `python` hace la búsqueda
exacta en el backend: existe porque el pgvector que trae el Postgres sin Docker (`pixeltable-pgserver`) se **cae al calcular distancias** en CPUs sin
AVX-512; con el Docker oficial `pgvector/pgvector` funciona. En ese Postgres temporal las pruebas eliminan el índice HNSW (solo en la BD de pruebas).
Con `TEST_DATABASE_URL` apuntando a un Postgres real las pruebas usan `pgvector`.

**Calidad medida** (`python calidad_rag/evaluar.py`, 45 preguntas sobre un corpus de 4 documentos / 15 fragmentos: 25 con respaldo y 20 sin él,
redactadas con otras palabras que el texto; incluye fuera de tema, temas del rubro no documentados, inyección de instrucciones y texto sin sentido):

| Métrica | `hash` (léxico) | `paraphrase-multilingual-MiniLM-L12-v2` |
|---|---|---|
| Fuente correcta en el top-1 / top-3 | 72 % / 100 % | **96 % / 100 %** |
| Separación con vs. sin respaldo (AUC) | 0.80 | **0.93** |
| Exactitud global al umbral 0.8 | 64 % | **80 %** |

Con el modelo real y el umbral por defecto (0.8): responde bien 18 de 25 preguntas con respaldo (72 %), deriva 18 de 20 sin respaldo y
**responde sin respaldo 2 de 20** ("¿Tienen urgencia 24 horas con ambulancia?" y un intento de inyección). Lo que cambia la empresa con su `umbral_rag`:

| Umbral | Responde bien (con respaldo) | Responde mal (sin respaldo) | Deriva de más |
|---|---|---|---|
| 0.5 | 84 % | 25 % | 4 |
| 0.6 | 84 % | 20 % | 4 |
| 0.7 | 80 % | 15 % | 5 |
| **0.8** | **72 %** | **10 %** | 7 |
| 0.9 | 60 % | 5 % | 10 |

Subir el umbral reduce las respuestas sin respaldo a costa de derivar más. Con DeepSeek activo hay una segunda barrera (`NO_SE`), por lo que
conviene un umbral algo más bajo; **sin clave** (modo extractivo) un falso positivo muestra un fragmento irrelevante, y es preferible 0.85–0.9.
La rúbrica es un corpus pequeño y de un solo rubro: sirve para comparar embedders y vigilar regresiones, no como cifra definitiva en producción.

**Límites conocidos:** la confianza depende de la calibración de `sim_min/sim_max` (`SentenceTransformerEmbedder`: 0.25–0.51); el filtro por empresa
con el índice HNSW puede devolver menos de k resultados si una empresa tiene pocos fragmentos entre muchos de otras (en este tamaño no es un problema);
los documentos subidos antes de este cambio se vuelven a procesar o se reindexan.

## 7. API

Documentación interactiva: `http://localhost:8000/docs` (botón *Authorize* para probar con un token). Todas las rutas, salvo `/health`,
`/auth/login`, `/chat` (API key) y `/publico/*` (chat público por slug), exigen `Authorization: Bearer <token>` y un rol permitido (ver `MATRIZ_PERMISOS.md`). Las respuestas usan camelCase y la misma forma que
`frontend/src/types/index.ts`.

| Método y ruta | Descripción |
|---|---|
| `POST /auth/login` · `GET /auth/me` | Iniciar sesión (devuelve JWT y usuario) / ver el usuario actual |
| `GET/POST /usuarios` · `PATCH/DELETE /usuarios/{id}` | Gestión de usuarios (superadmin: todos; admin de empresa: los suyos) |
| `GET /empresas` · `POST /empresas` | Listar (cada rol ve las suyas) / crear empresa (solo superadmin; devuelve la API key una vez) |
| `GET/PATCH /empresas/{slug}` | Ver / actualizar configuración del agente |
| `POST /empresas/{slug}/api-key` | Generar o rotar la API key |
| `GET/POST /empresas/{slug}/documentos` | Listar / subir documento (multipart, campo `archivo`) |
| `DELETE /documentos/{id}` · `GET /documentos/{id}/fragmentos` | Borrar / ver fragmentos |
| `GET /tickets?company_id=&status=` · `GET/PATCH /tickets/{id}` | Cola de la consola; cambiar estado o asignar agente |
| `POST /tickets/{id}/respuesta` | El agente responde y envía la encuesta; el ticket pasa a `esperando_cliente` (409 si está `cerrado` o `escalado`) |
| `POST /chat` (header `X-API-Key`) | Integraciones propias (exige agente `activo`) |
| `GET /publico/{slug}` | Marca y estado del agente para pintar el chat público (sin documentos ni claves) |
| `POST /publico/{slug}/chat` | Chat público: página `/chat/{slug}` y widget embebible (exige agente `activo`) |
| `GET /publico/{slug}/conversaciones/{id}` | Transcripción y estado del ticket de una conversación (el cliente ve la respuesta del agente); 404 si no es de esa empresa |
| `POST /publico/{slug}/conversaciones/{id}/encuesta` | El cliente responde la encuesta (`{"resolved": true/false}`); solo válido con el ticket `esperando_cliente` (409 si no) |
| `POST /empresas/{slug}/probar` | Simulador del panel (sin API key) |
| `GET /metricas` | Tickets abiertos/urgentes, conversaciones de hoy, tasa de resolución del bot |
| `GET /metricas/analitica?dias=7\|14\|30` | Vista Analítica: totales, volumen diario y comparativa por empresa (cada rol ve solo lo suyo) |
| `GET /tickets/agentes` | Usuarios activos (admin o encargado de tickets) a los que se puede asignar un ticket de la empresa |

Ejemplo:

```bash
curl -X POST http://localhost:8000/chat \
  -H "X-API-Key: ak_..." -H "Content-Type: application/json" \
  -d '{"message": "¿Cuánto tardan los reembolsos?", "customerName": "Ana"}'
```

## 8. Seguridad y aislamiento multi-tenant

- **RNF-01:** toda consulta a datos de una empresa filtra por `empresa_id`; el tenant sale de la API key (o del usuario autenticado), nunca del cuerpo de la petición.
  El chat público (`/publico/{slug}`) toma el tenant del slug de la ruta: solo responde con el agente `activo` y solo devuelve datos de marca.
  Una conversación de la empresa A no se puede continuar con la API key ni con el slug de B (devuelve 404).
- **RNF-02:** no hay credenciales en el código; todo va en `.env`, que está en `.gitignore`.
- **RNF-03:** PostgreSQL y Redis publican sus puertos solo en `127.0.0.1`.
- **RNF-04:** los documentos originales viven en `storage/`, excluida del repositorio; solo el backend la lee.
- **Límite de peticiones (rate limiting):** los endpoints sin sesión se limitan por IP (ventana deslizante en memoria, `app/ratelimit.py`).
  Superado el límite responden **429** con `Retry-After`.

  | Endpoint | Límite (por minuto) |
  |---|---|
  | `POST /publico/{slug}/chat` | 20 mensajes por IP y empresa; **6 conversaciones nuevas** (cada derivación crea un ticket) |
  | `GET /publico/{slug}/conversaciones/{id}` | 30 (el widget consulta 12 por minuto) |
  | `POST /publico/{slug}/conversaciones/{id}/encuesta` | 10 |
  | `GET /publico/{slug}` | 60 |
  | `POST /chat` (API key) | 120 |
  | `POST /auth/login` | 8 por IP y correo (fuerza bruta) y 30 por IP |

  Es **por proceso**: con un solo uvicorn local basta; si se despliega con varios workers hay que mover los contadores a Redis. Se desactiva con
  `RATE_LIMIT_ENABLED=false`; tras un proxy de confianza, `TRUST_PROXY_HEADERS=true` usa `X-Forwarded-For`.
- Subidas: se valida extensión y tamaño y se sanitiza el nombre del archivo.
- **RF-28 / RF-30:** login con JWT y cuatro roles (superadmin, admin de empresa, encargado de tickets, encargado del agente IA), con
  autorización por rol y aislamiento por empresa en cada endpoint. Matriz completa en `MATRIZ_PERMISOS.md`.
- Configura `JWT_SECRET` en `.env` (largo y aleatorio) y cambia las claves del seed antes de usar el sistema fuera de tu notebook.

## 9. Ejecución local

Ver `README.md` en la raíz del proyecto. En Windows, `.\iniciar.ps1` hace todo (`-SinDocker` usa un Postgres embebido; `.\detener.ps1` apaga).

**Credenciales de desarrollo**

| Rol | Correo | Clave | Qué ve y qué puede probar |
|---|---|---|---|
| **Superadmin** | `superadmin@alloxentric.local` | la de `SUPERADMIN_PASSWORD` en tu `.env` (`iniciar.ps1` la genera al azar; si corres `seed.py` sin esa variable es `Superadmin123!`) | Todo: todas las empresas, tickets y usuarios; crea empresas y otros superadmins |
| **Admin de empresa** | `admin@<slug>.demo` | `Demo1234!` | Consola, agentes, analítica y usuarios de **su** empresa; ve y cierra los tickets escalados |
| **Encargado de tickets** | `tickets@<slug>.demo` | `Demo1234!` | Solo Consola de soporte y Analítica de su empresa (no ve los tickets escalados) |
| **Encargado del agente IA** | `agente@<slug>.demo` | `Demo1234!` | Empresas y agentes, documentos y vista previa del widget de su empresa; sin consola ni usuarios |

`<slug>` es uno de: `wellq`, `alloxentric`, `dani-eth`, `dani27001`, `aprueba` (15 usuarios demo: 3 por empresa). Son claves **solo de desarrollo**:
cámbialas antes de usar el sistema fuera de tu notebook. Para crear un superadmin en una BD ya poblada: `python crear_superadmin.py correo@dominio.cl`.


## 10. Pruebas

| Tipo | Archivo | Qué cubre |
|---|---|---|
| API (pytest, Postgres real) | `backend/tests/test_api.py` (15), `test_roles.py` (28), `test_ciclo_ticket.py` (9), `test_ratelimit.py` (7) y `test_rag.py` (31) — 90 pruebas | **Login, matriz de permisos por rol, aislamiento entre empresas, gestión de usuarios y constraints de la BD**; CRUD de empresas y forma JSON, ingesta (TXT, PDF, DOCX, archivo corrupto), chat con RAG y derivación, **chat público por slug y su aislamiento**, flujo del agente, **asignación solo a usuarios de la empresa, remitente autenticado, campos de empresa por rol, analítica por empresa**, numeración de tickets, **aislamiento multi-tenant**, métricas, carga del seed |
| Navegador (Playwright) | `tests_e2e/test_flujos_navegador.py` — 49 verificaciones | **Login y permisos por rol (menús, tickets filtrados, crear usuario, cerrar sesión)**; consola → ticket → respuesta; subir documento; chat con respuesta RAG; derivación y ticket nuevo en la consola; crear empresa; **chat público `/chat/{slug}` y widget embebido en un sitio de otro origen; analítica real por rol, asignación a usuarios reales y remitente de la respuesta; el cliente ve la respuesta del agente (sin recargar y tras recargar) y el widget cerrado avisa** |
| Migración | manual | `alembic upgrade head`, `alembic check` (sin diferencias con los modelos) y `downgrade base` sobre un Postgres real |

Los tests de API usan una base temporal (o `TEST_DATABASE_URL`) porque vacían las tablas.

## 11. Trazabilidad con los requisitos

| Requisito | Dónde está | Estado |
|---|---|---|
| RF-01, RF-02 | `models/models.py`, `migrations/` | Hecho |
| RF-03 | `routers/empresas.py`, `routers/auth.py` (usuarios) | Hecho |
| RF-04, RF-05 | `routers/documentos.py`, `services/ingesta.py`, `services/embeddings.py` | Hecho (validado con el modelo real) |
| RF-06 | `BackgroundTasks` (Celery pendiente) | En curso |
| RF-07, RF-08 | `services/motor_rag.py` (búsqueda vectorial por empresa + umbral) | Hecho (calibrado con la batería de calidad) |
| RF-09 | `services/llm.py` (DeepSeek, con respaldo extractivo) | En curso (implementado; falta probar en vivo) |
| RF-10, RF-11 | `WidgetPreview.tsx`, `routers/chat.py` | Hecho |
| RF-12, RF-13 | `services/derivacion.py` (mock con `CORESTREAM_MOCK`) | Hecho |
| RF-14, RF-15 | `CorestreamConsole.tsx`, `routers/tickets.py` (sugerencia generada por el motor RAG) | Hecho |
| RF-16, RF-17 | `AgentDeploymentPanel.tsx`, `AgentConfigModal.tsx`, `EmbedWidgetModal.tsx` | Hecho |
| RF-18, RF-20 | `docker-compose.yml`, `.env.example`, `iniciar.ps1` | En curso (validado en una notebook sin Docker; falta Docker y la de Vicente) |
| RF-19, RF-21, RF-23 | `.env.example`, `.gitignore`, `docker-compose.yml` | Hecho |
| RF-22 | `docker-compose.yml` (Redis) | Pendiente (hasta implementar Celery) |
| RF-24 a RF-26, RF-37 | `backend/tests/`, `tests_e2e/`, `backend/calidad_rag/` | Hecho |
| RF-27 | `docs/` | En curso |
| RF-31 | `routers/publico.py`, `PublicChat.tsx`, `widget.min.js` | Hecho |
| RF-32 | `services/ciclo_ticket.py`, `routers/tickets.py`, `routers/publico.py`, migración 0004 | Hecho |
| RF-33 | `routers/tickets.py` (`/tickets/agentes`), migración 0003 | Hecho |
| RF-34 | `routers/metricas.py`, `AnalyticsView.tsx` | Hecho |
| RF-35 | `ratelimit.py` | Hecho |
| RF-36 | `iniciar.ps1`, `detener.ps1` | Hecho |
| RF-38 | `services/derivacion.py` | Pendiente (Corestream real) |
| RF-39 | `services/ciclo_ticket.py` | Pendiente (tarea periódica con Celery) |
| RF-28, RF-30 | `routers/auth.py`, `deps.py`, `security.py`, `LoginScreen.tsx`, `UsersView.tsx` | Hecho |
| RF-29 | `frontend/public/widget.min.js`, `PublicChat.tsx`, `routers/publico.py` | Hecho |

## 12. Pendientes y riesgos

| Pendiente | Responsable | Semana (replan) |
|---|---|---|
| Embeddings (sentence-transformers) y guardado en `fragmentos_embeddings` | Vicente | S9–S10 (hecho y validado con el modelo real) |
| Motor RAG real: búsqueda pgvector, DeepSeek, clasificador de intención | Vicente | S9–S12 (hecho y calibrado; falta DeepSeek en vivo) |
| Widget embebible `widget.min.js` y página pública `/chat/{slug}` | Fabián | S9–S10 (hecho) |
| Integración real con Corestream (depende de su documentación) | Fabián | S11–S12 |
| Celery + Redis para la ingesta | Vicente | S10–S12 |
| Vista Analítica con datos reales | Fabián | hecho (`GET /metricas/analitica`) |
| Mover los contadores del rate limiting a Redis (hoy en memoria, por proceso) si se despliega con varios workers | Fabián | solo si se escala |
| Cierre a las 72 h con un planificador real (hoy se aplica al leer; con Celery pasa a tarea periódica) | Vicente / Fabián | con Celery |

**Riesgos (semana 10):** (1) DeepSeek en vivo depende de una API key que aún no existe y es el único componente del RAG sin probar con datos reales;
(2) la integración real con Corestream depende de documentación y credenciales externas (hoy mock); (3) el motor RAG y los embeddings se
implementaron desde el repositorio de Fabián y requieren revisión de Vicente; (4) margen corto para el cierre: informe final y entregables académicos.
El resto de la lista de pendientes está en la hoja "Pendientes S10" del Excel de Requerimientos.
