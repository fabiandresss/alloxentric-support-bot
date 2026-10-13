# CLAUDE.md — Chatbot de Soporte Genérico Alloxentric

Contexto para Claude Code. Léelo completo antes de tocar código. Detalle ampliado en `README.md` y `docs/`.

## 1. Qué es el proyecto

Capstone **PTY4614 (Duoc UC, Ingeniería en Informática)** de Fabián Armijo y Vicente Balladares.
Plataforma de soporte con IA, **multi-tenant**: varias empresas del ecosistema Alloxentric (WellQ, Alloxentric, Dani ETH,
Dani27001, Aprueba) cargan su documentación; el chatbot responde con **RAG** sobre *esa* documentación y, cuando no puede
resolver, **deriva a un humano** creando un ticket en **Corestream** (la ticketera genérica del ecosistema).

- **Todo corre 100% en local, sin nube** (decisión del equipo: nada de AWS ni servicios cloud). El único gasto externo posible es la API de DeepSeek.
- Fabián: front, plataforma base, derivación a Corestream, roles/login, documentación. Vicente: modelo de datos, ingesta, embeddings, motor RAG.
- Estamos en la **semana 9 de 17** (6 oct 2026), con atraso respecto a la Carta Gantt original; ver sección 9.
- El usuario escribe en español (Chile). Responde en español, tono directo y de estudiante, sin relleno. Código y nombres de variables en el idioma que ya usa cada archivo (backend en español: `empresa`, `fragmentos`, `ticket`).

## 2. Stack

| Capa | Tecnología |
|---|---|
| Backend | Python 3.11+ (probado en 3.13), FastAPI, Uvicorn, SQLAlchemy 2, Alembic, Pydantic v2 |
| BD | PostgreSQL 16 + **pgvector** (HNSW, coseno, 384 dimensiones), driver psycopg3 |
| Auth | PyJWT (HS256) + PBKDF2-SHA256 de la stdlib (`app/security.py`) |
| Ingesta | pypdf, python-docx; `BackgroundTasks` de FastAPI (Celery + Redis **pendiente**) |
| Embeddings | `paraphrase-multilingual-MiniLM-L12-v2` (sentence-transformers, local; `EMBEDDINGS_BACKEND=hash` sin modelo, para pruebas) |
| LLM | DeepSeek vía API (`DEEPSEEK_API_KEY` en `.env`); sin clave el motor responde extractivo |
| Front | React 19 + TypeScript + Vite + Tailwind (prototipo de Google AI Studio, ya conectado a la API) |
| Infra local | Docker Compose (Postgres+pgvector y Redis, puertos solo en 127.0.0.1) |
| Pruebas | pytest sobre Postgres real, Playwright (navegador), `pixeltable-pgserver` como Postgres temporal |

## 3. Comandos

```bash
.\iniciar.ps1 | iniciar.cmd                                      # Windows: TODO en uno (.env, BD, backend, front); .\detener.ps1 apaga
cp .env.example .env && docker compose up -d                     # BD y Redis
cd backend && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
alembic upgrade head                                             # esquema + extensión vector
python seed.py [--reset]                                         # 5 empresas, 8 tickets, usuarios demo (imprime keys)
python reindexar.py [--todo] [--empresa slug]                    # regenera los vectores (primera vez con el modelo real o tras cambiarlo)
python calidad_rag/evaluar.py [--backend hash]                   # batería de calidad del RAG (45 preguntas); recomienda sim_min/sim_max
uvicorn app.main:app --reload                                    # http://localhost:8000/docs
cd ../frontend && cp .env.example .env && npm install && npm run dev   # http://localhost:3000
cd ../backend && pytest -q                                       # 90 pruebas (Postgres temporal automático)
python ../tests_e2e/test_flujos_navegador.py                     # 49 verificaciones; BD recién sembrada y todo corriendo
cd ../frontend && npx tsc --noEmit && npm run build              # verificación de tipos y build
alembic revision --autogenerate -m "desc"                        # tras cambiar models.py; REVISAR el archivo generado
```

Usuarios del seed (solo desarrollo): `superadmin@alloxentric.local` / `Superadmin123!`; por empresa `admin@<slug>.demo`,
`tickets@<slug>.demo`, `agente@<slug>.demo` con `Demo1234!` (slugs: `wellq`, `alloxentric`, `dani-eth`, `dani27001`, `aprueba`).
Superadmin en una BD ya poblada: `python crear_superadmin.py correo@dominio.cl`.

## 4. Mapa del repositorio

```
backend/app/
  main.py            monta los routers
  config.py          variables de entorno (DATABASE_URL, JWT_SECRET, CORESTREAM_MOCK, STORAGE_DIR…)
  models/models.py   TODAS las tablas (empresas, usuarios, documentos, fragmentos_embeddings, conversaciones, mensajes, tickets)
  schemas.py         schemas Pydantic en camelCase = forma EXACTA de frontend/src/types/index.ts
  mappers.py         ORM → schemas (toda la traducción BD español ↔ front camelCase vive aquí)
  deps.py            tenant por API key, login (JWT), requiere_rol(), verificar_tenant(), empresa_con_rol()
  security.py        hash de claves y JWT
  routers/           auth (login + usuarios), empresas, tickets, documentos, chat, publico (chat por slug), metricas
  services/          chat (orquesta), motor_rag (RAG: intención, búsqueda por empresa, umbral, LLM), embeddings, llm (DeepSeek),
                     ciclo_ticket, ingesta, derivacion (mock Corestream)
backend/migrations/versions/   0001 modelo inicial, 0002 roles de usuario, 0003 agente del ticket = usuario, 0004 ciclo del ticket con encuesta, 0005 modelo del embedding
backend/seed.py · seed_data.json · crear_superadmin.py · tests/ (test_api.py, test_roles.py, conftest.py)
frontend/src/api/client.ts     ÚNICO lugar con llamadas HTTP (+ sesión JWT en sessionStorage)
frontend/src/auth/permissions.ts   vistas por rol (espejo de la matriz; la regla real está en el backend)
frontend/public/widget.min.js    widget embebible (botón + iframe a /chat/{slug}?embed=1)
frontend/src/components/PublicChat.tsx   página pública /chat/{slug} (la enruta main.tsx)
frontend/src/App.tsx           Dashboard: carga por rol, polling de 15 s, handlers que llaman a la API
docs/                          documentación técnica, manual, MATRIZ_PERMISOS.md, MAPEO_FRONTEND.md, diagramas Mermaid, capturas
```

## 5. Reglas que NO se rompen

1. **Multi-tenant (RNF-01):** toda tabla salvo `empresas` lleva `empresa_id`, y **toda consulta de datos de una empresa filtra por él**.
   El tenant sale de la API key (`X-API-Key`, `POST /chat`) o del usuario autenticado, **nunca** del cuerpo/parámetros del cliente.
   Única excepción (RF-29): el chat público (`GET /publico/{slug}`, `POST /publico/{slug}/chat` y `GET /publico/{slug}/conversaciones/{id}`)
   toma el tenant del slug de la ruta (es el mismo que expone `webChatUrl`), responde solo con el agente `activo`, solo expone
   datos de marca y la transcripción de una conversación exige su UUID y que sea de esa empresa.
   Una conversación de la empresa A no se puede continuar con la key de B ni por el slug de B (404). Cada cambio que toque datos necesita su prueba de aislamiento.
2. **Roles (RF-28/RF-30):** 4 roles — `superadmin` (sin empresa), `admin_empresa`, `encargado_tickets`, `encargado_agente`.
   Cada endpoint nuevo declara explícitamente qué roles acepta (`requiere_rol(...)` o `empresa_con_rol(...)`) y, si accede por id,
   llama a `verificar_tenant`. Matriz en `docs/MATRIZ_PERMISOS.md`; si la cambias, actualiza la matriz, `tests/test_roles.py` y `frontend/src/auth/permissions.ts`.
3. **Contrato del motor RAG (no cambiar firmas):** `responder(db, empresa, texto, forzar_derivacion) -> Resultado` y
   `sugerir_respuesta(db, empresa, texto, motivo, nombre_cliente) -> dict` en `services/motor_rag.py`. `services/chat.py` y el front dependen de ellas.
4. **Forma de la API = tipos del front.** Los schemas están en camelCase con alias; si cambias un campo, cambia `schemas.py`, `mappers.py`,
   `frontend/src/types/index.ts` y `docs/MAPEO_FRONTEND.md` juntos.
5. **API keys:** se guardan solo como hash SHA-256; el texto plano se muestra una vez. **Contraseñas:** PBKDF2 con sal. Nada de secretos en el código ni en git (`.env`, `seed_keys.txt`, `storage/` están ignorados).
6. **Sin nube:** no agregar dependencias de AWS/GCP/Azure ni servicios externos salvo DeepSeek.
7. **Esquema:** cualquier cambio en `models.py` va con migración Alembic revisada a mano (el autogenerate no importa `pgvector` ni crea la extensión; ya está corregido en `0001`). Verifica `upgrade`, `alembic check` y `downgrade`.
8. **Subidas:** validar extensión (`pdf, docx, txt, faq, csv`), tamaño (`MAX_UPLOAD_MB`) y sanear el nombre; un directorio por empresa en `storage/`.
9. **Endpoints sin sesión** (chat público, widget, login): llevan límite de peticiones con `app/ratelimit.py` (`limite(...)` o `verificar(...)`); uno nuevo sin límite es un hueco. Tabla de límites en `docs/01_documentacion_tecnica.md` §8.

### Definición de negocio: ciclo del ticket (no cambiar sin acordarlo)

El encargado de tickets responde y se envía una **encuesta** al cliente; **el cliente cierra**. Estados: `pendiente`/`urgente` → `esperando_cliente` → `cerrado` (Sí; final, no se reabre) o `escalado` (No; gestión fuera del chat por `admin_empresa`/`superadmin`, el encargado ya no lo ve). Sin respuesta en `ENCUESTA_HORAS` (72 h) se cierra solo. Detalle y tabla de transiciones en `services/ciclo_ticket.py` y `docs/01_documentacion_tecnica.md` §6.1.

## 6. Convenciones y trampas ya encontradas

- `mensajes.creado_en` se asigna **en Python** (no `now()`): dentro de una transacción `now()` repite la hora y desordena la transcripción.
- Tras escribir en una conversación y releer un ticket, usar `db.expire_all()` o la transcripción sale vieja.
- `tickets.numero` = `COR-xxxx`, siguiente = máximo + 1 (el seed arranca en COR-8922).
- `empresas.slug` es el id público (el front lo usa como `id`); el UUID es interno.
- Los tests **vacían las tablas**: nunca apuntarlos a la BD de desarrollo (usar el Postgres temporal o `TEST_DATABASE_URL` de una BD aparte). El fixture `client` entra como superadmin; `usuario_como(slug, rol)` da un cliente con ese rol.
- `seed.py --reset` borra también los usuarios (el superadmin del seed se recrea).
- No hay Docker en el entorno de nube de Claude: allí se prueba con `pixeltable-pgserver`. En el notebook de Fabián sí hay Docker.
- Evitar `pkill -f` con un patrón que coincida con el propio comando (mata la shell); usa `[v]ite` o el PID.
- Front: `npm install` falló una vez por un `esbuild` fijado contra Vite 8; ya se quitó de `devDependencies`.
- **Vectores de modelos distintos no se comparan:** cada fragmento guarda el `modelo` que lo generó y la búsqueda ignora los de otro embedder; tras cambiar de modelo, `python reindexar.py`.
- El pgvector del Postgres sin Docker (`pixeltable-pgserver`) se **cae al calcular distancias** en CPUs sin AVX-512 (probado en un i5-8250U): ahí `RAG_SEARCH=python` y sin índice HNSW (lo hace `tests/conftest.py`). Con Docker `pgvector/pgvector` no pasa.
- `pip install -r requirements.txt` arrastra torch (~1 GB). Las pruebas no lo necesitan (`EMBEDDINGS_BACKEND=hash`).
- Los embeddings son de **384** dimensiones (el prototipo decía 768 y se corrigió). Si cambias de modelo, cambia `EMBED_DIM` y haz migración.

## 7. Estado actual (semana 9)

**Hecho y probado:** modelo de datos + migraciones; API de empresas, usuarios, documentos, tickets, chat y métricas; ingesta de TXT/PDF/DOCX
(extracción + fragmentación); chat con derivación a ticket; **widget embebible `widget.min.js` y página pública `/chat/{slug}` (RF-29)**; consola de soporte; panel de agentes y carga de documentos; login JWT + 4 roles + gestión de usuarios; **analítica real por empresa y rol** (`GET /metricas/analitica`); asignación de tickets a usuarios reales (`GET /tickets/agentes`); **el cliente ve la respuesta del agente humano en el chat público/widget**; **ciclo del ticket con encuesta de resolución (Sí cierra, No escala, 72 h cierra)**; **rate limiting de los endpoints sin sesión**;
documentación técnica, manual y diagramas.

**Motor RAG:** implementado y validado con el modelo real (E2E 49/49; fuente correcta 96 %, AUC 0.93, `calidad_rag/`). **Falta probar DeepSeek en vivo** (no hay `DEEPSEEK_API_KEY` aún: responde en modo extractivo). **Provisorio:** Corestream es un mock (`CORESTREAM_MOCK=true`);
la ingesta usa `BackgroundTasks`; los documentos del seed no tienen archivo ni fragmentos reales.

## 8. Pendiente (en orden de dependencia)

| # | Tarea | Dónde | Quién |
|---|---|---|---|
| 1 | Embeddings: **hecho y validado con el modelo real** (`services/embeddings.py`, `reindexar.py`) | `services/ingesta.py`, `services/embeddings.py` | Vicente |
| 2 | Motor RAG: **hecho y calibrado** (pgvector por `empresa_id`, umbral, intención, sugerencia IA); falta probar **DeepSeek en vivo** (necesita `DEEPSEEK_API_KEY`) y la ruta SQL de pgvector contra el Docker | `services/motor_rag.py` | Vicente / Fabián |
| 3 | Celery + Redis para la ingesta | `services/ingesta.py`, `docker-compose.yml` | Vicente |
| 4 | Corestream real (`httpx`) cuando exista su documentación; mantener el mock | `services/derivacion.py` | Fabián |
| 5 | Validar el entorno en ambas notebooks (RF-18…23) | README | Ambos |
| 6 | Pruebas de calidad del RAG (preguntas con/sin respaldo), pruebas integrales, ajustes y documentación final | `tests/`, `docs/` | Ambos |

Al terminar una tarea: actualizar `README.md` (sección "Qué es provisorio"), `docs/01_documentacion_tecnica.md` (trazabilidad y pendientes) y avisar a Fabián para actualizar los Excel de Requerimientos y la Carta Gantt (RF-xx: Hecho / En curso / Pendiente).

## 9. Contexto académico y de planificación

- Requerimientos (Excel, ciclo en cascada): 30 RF — 11 hechos, 11 en curso, 8 pendientes (a la semana 9). Fases: Análisis, Diseño, Configuración del entorno local, Desarrollo, Pruebas, Implementación y cierre.
- Carta Gantt: 17 semanas, 10 actividades. Van atrasadas carga/vectorización, motor RAG y derivación real. Pruebas S11–S14 y ajustes/documentación S14–S17 son lo que queda después.
- **Riesgo principal:** la cadena embeddings → motor RAG → pruebas depende de Vicente y deja poco margen para el cierre.
- Competencias del perfil de egreso: gestión de proyectos, desarrollo de software, QA, bases de datos, IA. Entregables extra por ser Capstone: Abstract (ES/EN), conclusiones y reflexión individuales (en inglés).

## 10. Cómo trabajar aquí

- Antes de implementar algo no trivial, lee el archivo y sus tests; respeta el estilo existente (español en el backend, camelCase en la API).
- Cambios de comportamiento van con prueba (pytest) y, si tocan flujos de pantalla, con una verificación en `tests_e2e/`.
- Verifica antes de dar algo por terminado: `pytest -q`, `npx tsc --noEmit`, y la migración si tocaste modelos.
- No hagas commits ni push sin que Fabián lo pida. No agregues archivos con secretos.
- Prefiere cambios pequeños y revisables; explica brevemente qué cambió y qué quedó pendiente.
