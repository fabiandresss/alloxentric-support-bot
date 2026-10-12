# Chatbot de Soporte Genérico Alloxentric

Capstone **PTY4614 · Duoc UC · Ingeniería en Informática** — Fabián Armijo y Vicente Balladares.

Plataforma de soporte con IA, **multi-tenant**, para las empresas del ecosistema Alloxentric (WellQ, Alloxentric, Dani ETH, Dani27001, Aprueba):
cada empresa carga su documentación, el chatbot responde con **RAG** sobre ella y, si no puede resolver, **deriva a un agente humano**
creando un ticket en **Corestream**. Todo corre **100% en local** (sin nube).

> **Si usas Claude Code**, lee primero [`CLAUDE.md`](CLAUDE.md): contiene el contexto completo, las reglas del proyecto y el backlog.

## Estado (semana 9 de 17)

| Área | Estado |
|---|---|
| Modelo de datos + migraciones (Alembic, pgvector) | Hecho |
| API (empresas, usuarios, documentos, tickets, chat, métricas) | Hecho |
| Login JWT y 4 roles con aislamiento por empresa | Hecho |
| Ingesta de documentos (TXT, PDF, DOCX): extracción y fragmentación | Hecho (faltan embeddings) |
| Front: consola de soporte, panel de agentes, widget de prueba, usuarios y roles | Hecho |
| Motor RAG (embeddings + pgvector + DeepSeek + clasificador) | **Provisorio** (palabras clave) |
| Widget embebible `widget.min.js` y chat público `/chat/{slug}` | Hecho |
| Analítica real por empresa y rol; asignación de tickets a usuarios | Hecho |
| Corestream real · Celery | Pendiente |

## Roles

| Rol | Qué hace |
|---|---|
| `superadmin` | Opera la plataforma: crea empresas y usuarios, ve todo |
| `admin_empresa` | Responsable de su empresa: ve todo lo suyo y gestiona sus usuarios |
| `encargado_tickets` | Atiende los tickets derivados de su empresa |
| `encargado_agente` | Configura el bot IA de su empresa y su base de conocimiento |

Matriz completa y garantías de seguridad en [`docs/MATRIZ_PERMISOS.md`](docs/MATRIZ_PERMISOS.md).

## Estructura

```
proyecto/
├── docker-compose.yml     PostgreSQL+pgvector y Redis (solo en 127.0.0.1)
├── .env.example           copiar a .env
├── backend/               FastAPI + SQLAlchemy + Alembic (Python 3.11+)
├── frontend/              React + Vite (el prototipo de AI Studio, ya conectado a la API)
├── tests_e2e/             prueba de navegador (Playwright)
└── docs/                  documentación técnica, manual de usuario y diagramas (ver docs/README.md)
```

## Puesta en marcha

```bash
# 1) configuración
cp .env.example .env            # cambia DB_PASSWORD (y la misma clave dentro de DATABASE_URL)

# 2) base de datos y redis
docker compose up -d

# 3) backend
cd backend
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
alembic upgrade head            # crea las tablas + extensión pgvector
python seed.py                  # carga 5 empresas, 8 tickets y usuarios de ejemplo (imprime API keys y claves)
uvicorn app.main:app --reload   # http://localhost:8000/docs

# 4) frontend (otra terminal)
cd frontend
cp .env.example .env
npm install
npm run dev                     # http://localhost:3000
```

Tu compañero repite los mismos pasos en su notebook: cada uno tiene su propia base local con el mismo
esquema (`alembic upgrade head`). Para cambios de esquema: editar `app/models/models.py` y
`alembic revision --autogenerate -m "descripcion"` (revisar el archivo generado antes de aplicarlo).

## Pruebas

Pruebas de la API (pytest, 52 pruebas, incluye roles y permisos):

```bash
cd backend
# Opción A: Postgres temporal automático
pip install -r requirements-dev.txt && pytest -q
# Opción B: tu Docker, con una BD APARTE (los tests vacían las tablas)
docker exec chatbot-soporte-db createdb -U chatbot chatbot_test
TEST_DATABASE_URL=postgresql+psycopg://chatbot:TU_CLAVE@127.0.0.1:5432/chatbot_test pytest -q
```

Prueba de navegador: con el sistema corriendo y la BD recién sembrada, `python tests_e2e/test_flujos_navegador.py` (requiere `pip install playwright && playwright install chromium`).

Las pruebas de API incluyen el caso de **aislamiento multi-tenant** (RNF-01 / RF-25): lo que sube la empresa A nunca aparece
en las respuestas de la empresa B, y una conversación de A no se puede usar con la API key de B.

## API (resumen)

| Método y ruta | Para qué |
|---|---|
| `POST /auth/login`, `GET /auth/me` | Inicio de sesión (JWT) |
| `GET/POST /usuarios`, `PATCH/DELETE /usuarios/{id}` | Gestión de usuarios y roles |
| `GET/POST /empresas`, `PATCH /empresas/{slug}` | Panel de agentes |
| `POST /empresas/{slug}/api-key` | Generar/rotar la API key del widget |
| `GET/POST /empresas/{slug}/documentos`, `DELETE /documentos/{id}`, `GET /documentos/{id}/fragmentos` | Base de conocimiento |
| `GET /tickets`, `GET/PATCH /tickets/{id}`, `POST /tickets/{id}/respuesta` | Consola Corestream |
| `POST /chat` (header `X-API-Key`) | Integraciones propias: el tenant sale de la key |
| `GET /publico/{slug}` · `POST /publico/{slug}/chat` | Chat público (página `/chat/{slug}` y widget embebible); sin login, solo con agente `activo` |
| `GET /publico/{slug}/conversaciones/{id}` | Transcripción para que el cliente vea la respuesta del agente humano (el widget la consulta cada 5 s tras derivar) |
| `POST /publico/{slug}/conversaciones/{id}/encuesta` | El cliente responde la encuesta de resolución: sí cierra el ticket, no lo escala a gestión |
| `POST /empresas/{slug}/probar` | Simulador del panel (sin key) |
| `GET /metricas` | Tarjetas de la consola |
| `GET /metricas/analitica?dias=` | Vista Analítica (superadmin: todas las empresas; resto: la suya) |
| `GET /tickets/agentes` | Usuarios a los que se puede asignar un ticket (de la empresa) |

Todas las rutas (salvo `/health`, `/auth/login`, `/chat` y `/publico/*`) exigen `Authorization: Bearer <token>` y un rol permitido; ver `docs/MATRIZ_PERMISOS.md`.

Usuarios que deja el seed (solo desarrollo): `superadmin@alloxentric.local` / `Superadmin123!` y, por empresa, `admin@<slug>.demo`, `tickets@<slug>.demo`, `agente@<slug>.demo` con `Demo1234!` (slug: `wellq`, `alloxentric`, `dani-eth`, `dani27001`, `aprueba`). Para crear un superadmin en una BD ya existente: `python crear_superadmin.py correo@dominio.cl`.

Las respuestas usan exactamente la forma de `frontend/src/types/index.ts` (camelCase).

## Qué es provisorio / qué falta

| Pendiente | Dónde | Quién |
|---|---|---|
| **Motor RAG real** (embeddings sentence-transformers + búsqueda pgvector + DeepSeek). Hoy `services/motor_rag.py` busca por palabras clave sobre los fragmentos; el contrato (`responder`, `sugerir_respuesta`) ya está fijo. | `backend/app/services/motor_rag.py`, `ingesta.py::generar_embeddings` | Vicente |
| Procesar la ingesta con **Celery + Redis** (hoy usa `BackgroundTasks` de FastAPI) | `services/ingesta.py` | Vicente |
| **Corestream real** (hoy `CORESTREAM_MOCK=true`: el ticket se crea solo en la BD local) | `services/derivacion.py` | Fabián |
| Los documentos del seed no tienen archivo ni fragmentos reales: sube uno desde el panel para probar | — | — |
