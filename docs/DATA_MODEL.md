# Modelo de datos — Chatbot de Soporte Genérico Alloxentric

Propuesta inicial para partir el desarrollo. Ajustar con el equipo antes de generar la primera migración, pero
mantener el principio de aislamiento multi-tenant (`empresa_id` en toda tabla de negocio).

## Entidades principales

### `empresas` (tenants)
| Campo | Tipo | Notas |
|---|---|---|
| id | UUID / PK | |
| nombre | text | Ej. "WellQ", "Dani27001" |
| slug | text, único | usado en URLs / configuración del widget |
| creado_en | timestamp | |

### `usuarios_admin`
Usuarios que administran la configuración de una empresa (cargan documentos, revisan tickets, etc.).
| Campo | Tipo | Notas |
|---|---|---|
| id | UUID / PK | |
| empresa_id | UUID / FK → empresas | |
| email | text, único | |
| password_hash | text | |
| rol | text | ej. `admin`, `agente` |

### `documentos`
Documentos y FAQ cargados por cada empresa, antes de vectorizar.
| Campo | Tipo | Notas |
|---|---|---|
| id | UUID / PK | |
| empresa_id | UUID / FK → empresas | |
| nombre_archivo | text | |
| tipo | text | `pdf`, `faq`, `txt`, etc. |
| contenido_original | text / bytea | según se decida guardar texto extraído o el archivo |
| estado | text | `pendiente`, `procesado`, `error` |
| creado_en | timestamp | |

### `fragmentos_embeddings`
Fragmentos ("chunks") de cada documento, con su embedding, usados por el motor RAG.
| Campo | Tipo | Notas |
|---|---|---|
| id | UUID / PK | |
| empresa_id | UUID / FK → empresas | **redundante a propósito**: evita tener que hacer join para filtrar por tenant en cada búsqueda vectorial |
| documento_id | UUID / FK → documentos | |
| texto | text | contenido del fragmento |
| embedding | vector (pgvector) | dimensión según el modelo de embeddings elegido |
| creado_en | timestamp | |

### `conversaciones`
| Campo | Tipo | Notas |
|---|---|---|
| id | UUID / PK | |
| empresa_id | UUID / FK → empresas | |
| usuario_final_id | text / UUID | identificador del usuario que consulta (puede ser anónimo/sesión) |
| estado | text | `activa`, `resuelta`, `derivada` |
| creado_en | timestamp | |

### `mensajes`
| Campo | Tipo | Notas |
|---|---|---|
| id | UUID / PK | |
| empresa_id | UUID / FK → empresas | **redundante a propósito**, igual que en `fragmentos_embeddings`: garantiza que el aislamiento multi-tenant no dependa de recordar el JOIN con `conversaciones` en cada consulta |
| conversacion_id | UUID / FK → conversaciones | |
| rol | text | `usuario`, `bot` |
| contenido | text | |
| fragmentos_usados | jsonb / nullable | referencia a qué fragmentos se usaron para responder (trazabilidad) |
| creado_en | timestamp | |

### `tickets`
Registro local de la derivación, además de lo que se crea en Corestream.
| Campo | Tipo | Notas |
|---|---|---|
| id | UUID / PK | |
| empresa_id | UUID / FK → empresas | |
| conversacion_id | UUID / FK → conversaciones | |
| corestream_ticket_id | text / nullable | id devuelto por la API de Corestream (o mock) |
| motivo | text | por qué se derivó |
| estado | text | `pendiente`, `urgente`, `esperando_cliente`, `cerrado`, `escalado` (ver ciclo en `01_documentacion_tecnica.md` §6.1) |
| encuesta_enviada_en | timestamptz / nullable | cuándo se envió la encuesta de resolución (base del cierre a las 72 h) |
| cierre_motivo | text / nullable | `confirmado_cliente`, `sin_respuesta`, `gestion_manual`, `migrado` |
| creado_en | timestamp | |

## Relaciones (resumen)

```
empresas 1───N usuarios_admin
empresas 1───N documentos 1───N fragmentos_embeddings
empresas 1───N conversaciones 1───N mensajes
empresas 1───N tickets ── (1) conversaciones
```

## Reglas de aislamiento (multi-tenant)

- Ninguna query debe recuperar filas de más de una empresa a la vez, salvo endpoints administrativos
  explícitamente diseñados para eso (y protegidos por rol).
- La búsqueda vectorial en `fragmentos_embeddings` **siempre** debe filtrar por `empresa_id` antes (o junto)
  con la búsqueda de similitud, nunca después.
- Al escribir tests, incluir al menos un caso que verifique que una consulta de la Empresa A nunca devuelve
  fragmentos o conversaciones de la Empresa B.

## Notas para la migración inicial (Alembic)

- Definir primero `empresas`, luego el resto en orden de dependencia.
- Activar la extensión `pgvector` en PostgreSQL antes de crear `fragmentos_embeddings`
  (`CREATE EXTENSION IF NOT EXISTS vector;`).
- Decidir la dimensión del vector según el modelo de embeddings que se use (dejarlo como constante de
  configuración, no hardcodeado en la migración, si es posible).
