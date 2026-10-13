# Chatbot de Soporte Genérico Alloxentric

Capstone **PTY4614 · Duoc UC · Ingeniería en Informática** — Fabián Armijo y Vicente Balladares.

Plataforma de soporte con IA, **multi-tenant**, para las empresas del ecosistema Alloxentric (WellQ, Alloxentric, Dani ETH, Dani27001, Aprueba):
cada empresa carga su documentación, el chatbot responde con **RAG** sobre ella y, si no puede resolver, **deriva a un agente humano**
creando un ticket en **Corestream**. Todo corre **100% en local** (sin nube).

> **Si usas Claude Code**, lee primero [`CLAUDE.md`](CLAUDE.md): contiene el contexto completo, las reglas del proyecto y el backlog.

## Estado (semana 10 de 17)

| Área | Estado |
|---|---|
| Modelo de datos + migraciones (Alembic, pgvector) | Hecho |
| API (empresas, usuarios, documentos, tickets, chat, métricas) | Hecho |
| Login JWT y 4 roles con aislamiento por empresa | Hecho |
| Ingesta de documentos (TXT, PDF, DOCX): extracción, fragmentación y embeddings | Hecho |
| Front: consola de soporte, panel de agentes, widget de prueba, usuarios y roles | Hecho |
| Motor RAG (embeddings + pgvector + DeepSeek + intención) | Hecho y validado con el modelo real; **falta probar DeepSeek en vivo (sin clave aún)** |
| Widget embebible `widget.min.js` y chat público `/chat/{slug}` | Hecho |
| Analítica real por empresa y rol; asignación de tickets a usuarios | Hecho |
| Ciclo del ticket con encuesta de resolución (Sí cierra, No escala a gestión, 72 h cierra) | Hecho |
| Rate limiting de endpoints sin sesión; scripts de arranque (`iniciar.ps1`); batería de calidad del RAG | Hecho |
| DeepSeek en vivo · Corestream real · Celery + Redis | Pendiente |

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
├── iniciar.ps1 / detener.ps1   arranque y apagado en un comando (Windows)
├── docker-compose.yml     PostgreSQL+pgvector y Redis (solo en 127.0.0.1)
├── .env.example           copiar a .env
├── backend/               FastAPI + SQLAlchemy + Alembic (Python 3.11+); calidad_rag/ = batería de calidad del RAG
├── frontend/              React + Vite (el prototipo de AI Studio, ya conectado a la API)
├── tests_e2e/             prueba de navegador (Playwright)
├── docs/                  documentación técnica, manual de usuario y diagramas (ver docs/README.md)
└── *.xlsx                 Carta Gantt (S10) y Requerimientos (39 RF, EDT, hoja "Pendientes S10")
```

## Puesta en marcha

### Opción rápida (Windows + Docker Desktop)

Un solo comando levanta todo (crea el `.env` con claves aleatorias, base de datos, backend, frontend y abre el navegador). Es idempotente: solo hace lo que falta.

```powershell
.\iniciar.ps1
```

O haz doble clic en `iniciar.cmd`. Opciones: `-SinDocker` (Postgres embebido, para desarrollo si no tienes Docker; ver abajo), `-Reset` (borra la BD y vuelve a sembrar), `-SinFrontend`, `-NoAbrirNavegador`, `-SoloConfigurar` (solo crea el `.env`) y `-Simular` (muestra los pasos sin ejecutarlos). Para apagar: `.\detener.ps1` (o `detener.cmd`; con `-BorrarDatos` elimina también la BD).

La primera vez tarda varios minutos: instala torch (~1 GB) y, al arrancar, descarga el modelo de embeddings (~470 MB).

**Sin Docker (`-SinDocker`):** usa un Postgres embebido (`backend\dev_db.py`, datos en `backend\.pgdata`). Es solo para desarrollo: su pgvector se cae al calcular distancias en CPUs sin AVX-512, así que en este modo la búsqueda es exacta en el backend (`RAG_SEARCH=python`) y se omite el índice HNSW de esa base. El apagado debe ser con `detener.ps1` (cierre limpio de Postgres).

**Puerto 5432 ocupado:** si ya tienes un PostgreSQL instalado en Windows, con Docker el script elige solo otro puerto (5433–5440), lo guarda como `DB_PORT` en `.env` y ajusta `DATABASE_URL`.

### Paso a paso (cualquier sistema)

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

Pruebas de la API (pytest, 90 pruebas, incluye roles y permisos):

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

### Credenciales de desarrollo (por rol)

| Rol | Correo | Clave | Qué ve y qué puede probar |
|---|---|---|---|
| **Superadmin** | `superadmin@alloxentric.local` | la de `SUPERADMIN_PASSWORD` en tu `.env` (`iniciar.ps1` la genera al azar; si corres `seed.py` sin esa variable es `Superadmin123!`) | Todo: todas las empresas, tickets y usuarios; crea empresas y otros superadmins |
| **Admin de empresa** | `admin@<slug>.demo` | `Demo1234!` | Consola, agentes, analítica y usuarios de **su** empresa; ve y cierra los tickets escalados |
| **Encargado de tickets** | `tickets@<slug>.demo` | `Demo1234!` | Solo Consola de soporte y Analítica de su empresa (no ve los tickets escalados) |
| **Encargado del agente IA** | `agente@<slug>.demo` | `Demo1234!` | Empresas y agentes, documentos y vista previa del widget de su empresa; sin consola ni usuarios |

`<slug>` es uno de: `wellq`, `alloxentric`, `dani-eth`, `dani27001`, `aprueba` (15 usuarios demo: 3 por empresa). Son claves **solo de desarrollo**:
cámbialas antes de usar el sistema fuera de tu notebook. Para crear un superadmin en una BD ya poblada: `python crear_superadmin.py correo@dominio.cl`.


Las respuestas usan exactamente la forma de `frontend/src/types/index.ts` (camelCase).

## Qué es provisorio / qué falta

| Pendiente | Dónde | Quién |
|---|---|---|
| **DeepSeek en vivo**: poner `DEEPSEEK_API_KEY` en `.env` y repasar umbral/tono; probar la búsqueda `pgvector` (SQL + HNSW) corriendo `pytest` con `TEST_DATABASE_URL` del Docker | `backend/app/services/llm.py`, `motor_rag.py` | Fabián / Vicente |
| Procesar la ingesta con **Celery + Redis** (hoy usa `BackgroundTasks` de FastAPI) | `services/ingesta.py` | Vicente |
| **Corestream real** (hoy `CORESTREAM_MOCK=true`: el ticket se crea solo en la BD local) | `services/derivacion.py` | Fabián |
| Los documentos del seed no tienen archivo ni fragmentos reales: sube uno desde el panel para probar | — | — |
