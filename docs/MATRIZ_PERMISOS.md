# Roles y matriz de permisos (RF-28 y RF-30)

Hay **cuatro roles**. Tres pertenecen siempre a una empresa; el superadmin pertenece a la plataforma.

| Rol | Quién es | Pertenece a |
|---|---|---|
| `superadmin` | Equipo de Alloxentric que opera la plataforma | Ninguna empresa (`empresa_id` nulo) |
| `admin_empresa` | Responsable de la cuenta de una empresa cliente | Una empresa |
| `encargado_tickets` | Atiende la cola de tickets derivados de su empresa (Corestream) | Una empresa |
| `encargado_agente` | Configura el agente/bot IA de su empresa y su base de conocimiento | Una empresa |

## Matriz

| Acción | Superadmin | Admin de empresa | Encargado de tickets | Encargado del agente IA |
|---|:-:|:-:|:-:|:-:|
| Crear empresas | ✔ | | | |
| Ver empresas | todas | la suya | la suya | la suya |
| Configurar agente (nombre del agente, tono, instrucciones, umbral, estado) | ✔ | ✔ | | ✔ |
| Cambiar nombre e industria de la empresa | ✔ | ✔ | | |
| Subir / borrar documentos y ver fragmentos | ✔ | ✔ | | ✔ |
| Generar o rotar la API key y obtener el widget | ✔ | ✔ | | ✔ |
| Probar el agente (simulador) | ✔ | ✔ | | ✔ |
| Ver y atender tickets (urgente/pendiente, asignar, responder con encuesta) | todos | los de su empresa | los de su empresa (menos los escalados) | |
| Ver y cerrar tickets **escalados** (el cliente dijo que no se resolvió) | todos | los de su empresa | | |
| Cerrar un ticket sin encuesta | no existe: lo cierra el cliente (o las 72 h) | | | |
| Asignar un ticket | a usuarios de la empresa del ticket (admin o encargado de tickets); nunca a otra empresa | | | |
| Ver métricas y analítica | globales (todas las empresas) | las de su empresa | las de su empresa | las de su empresa |
| Gestionar usuarios | todos | los de su empresa | | |
| Crear superadmins | ✔ | | | |

## Cómo se garantiza

- **Autenticación:** `POST /auth/login` entrega un JWT (8 h por defecto). Las claves se guardan con PBKDF2-SHA256 con sal.
- **Autorización por rol:** cada endpoint declara qué roles acepta (`requiere_rol(...)` en `app/deps.py`); otro rol recibe **403**.
- **Aislamiento por empresa:** aunque el rol sea correcto, un usuario de empresa solo toca datos de **su** empresa
  (`verificar_tenant`). Intentar leer o modificar datos de otra empresa devuelve 403 (404 para usuarios, para no revelar que existen).
  Los listados se filtran por la empresa del token; el parámetro `company_id` solo lo respeta el superadmin.
- **Base de datos:** la tabla `usuarios` tiene dos `CHECK`: el rol debe ser uno de los cuatro, y `empresa_id` es nulo **si y solo si** el rol es `superadmin`.
- **Reglas anti-accidentes:** nadie puede desactivarse, eliminarse ni cambiarse el rol a sí mismo; un admin de empresa no puede crear ni tocar superadmins;
  un usuario desactivado pierde el acceso aunque su token no haya vencido.
- **Remitente confiable:** quien responde un ticket queda registrado con el usuario autenticado; el cuerpo de la petición no puede cambiarlo.
- **Asignación real:** `assignedAgentId` debe ser un usuario activo, de la empresa del ticket y con rol de atención (`admin_empresa` o `encargado_tickets`); si no, 422.
- **Datos de empresa:** nombre e industria solo los cambia el admin de la empresa o el superadmin (403 al encargado del agente, salvo que reenvíe el mismo valor).
- **El widget no usa JWT:** el chat público (`/publico/{slug}`, que usan la página `/chat/{slug}` y el widget embebible) no exige login; la empresa sale del slug de la ruta, solo responde con el agente `activo` y solo expone datos de marca. Todos llevan límite de peticiones por IP (429 al superarlo; tabla en `01_documentacion_tecnica.md` §8). Leer una conversación (`/publico/{slug}/conversaciones/{id}`) exige su UUID y que sea de la empresa del slug (404 si no); no expone al agente asignado. `POST /chat` sigue autenticándose con la API key (`X-API-Key`).
- **En el front** el menú muestra solo las vistas del rol (`src/auth/permissions.ts`), pero es solo comodidad: la regla real está en el backend.
