# Manual de usuario — Chatbot de Soporte Alloxentric

Al abrir la aplicación se pide **correo y contraseña**. Lo que ves depende de tu rol:

- **Superadmin:** opera toda la plataforma: crea empresas y usuarios, ve todas las empresas.
- **Admin de empresa:** responsable de la cuenta de su empresa: ve todo lo de su empresa y gestiona sus usuarios.
- **Encargado de tickets:** atiende los casos que el bot no pudo resolver (Consola de soporte), solo de su empresa.
- **Encargado del agente IA:** configura el chatbot de su empresa y carga su documentación.
- **Usuario final:** el cliente de la empresa que conversa con el bot (no inicia sesión).

El detalle de qué puede hacer cada rol está en `MATRIZ_PERMISOS.md`.

> Para encender el sistema en Windows ejecuta `.\iniciar.ps1` (o `iniciar.cmd`) desde la carpeta del proyecto; para apagarlo, `.\detener.ps1`.
> El detalle está en el `README.md`. Si al abrir la aplicación ves un aviso rojo *"No se pudo cargar la información del backend"*,
> el servidor no está corriendo: vuelve a ejecutar `iniciar.ps1` y pulsa **Reintentar**.

La navegación está en el menú de la izquierda y **muestra solo las secciones de tu rol**: **Consola de soporte**, **Empresas y agentes**,
**Vista previa del widget**, **Analítica** y **Usuarios y roles**. Para salir, abre tu nombre (arriba a la derecha) y elige **Cerrar sesión**.

![Inicio de sesión](img/11_login.png)

### Usuarios de ejemplo para probar cada rol

| Rol | Correo | Clave | Qué ve y qué puede probar |
|---|---|---|---|
| **Superadmin** | `superadmin@alloxentric.local` | la de `SUPERADMIN_PASSWORD` en tu `.env` (`iniciar.ps1` la genera al azar; si corres `seed.py` sin esa variable es `Superadmin123!`) | Todo: todas las empresas, tickets y usuarios; crea empresas y otros superadmins |
| **Admin de empresa** | `admin@<slug>.demo` | `Demo1234!` | Consola, agentes, analítica y usuarios de **su** empresa; ve y cierra los tickets escalados |
| **Encargado de tickets** | `tickets@<slug>.demo` | `Demo1234!` | Solo Consola de soporte y Analítica de su empresa (no ve los tickets escalados) |
| **Encargado del agente IA** | `agente@<slug>.demo` | `Demo1234!` | Empresas y agentes, documentos y vista previa del widget de su empresa; sin consola ni usuarios |

`<slug>` es uno de: `wellq`, `alloxentric`, `dani-eth`, `dani27001`, `aprueba` (15 usuarios demo: 3 por empresa). Son claves **solo de desarrollo**:
cámbialas antes de usar el sistema fuera de tu notebook. Para crear un superadmin en una BD ya poblada: `python crear_superadmin.py correo@dominio.cl`.

## 0. Usuarios y roles (superadmin y admin de empresa)

En **Usuarios y roles** ves a los usuarios (el admin de empresa, solo los de su empresa). Para crear uno: correo, nombre, contraseña de
al menos 8 caracteres, rol (y empresa, si eres superadmin) y **+ Crear usuario**. En la tabla puedes cambiar el rol, **Desactivar**
(el usuario pierde el acceso al instante) o **Eliminar**. No puedes desactivarte ni cambiarte el rol a ti mismo.

![Usuarios y roles](img/12_usuarios_roles.png)

Vista de un **encargado de tickets** (solo consola y analítica, solo los tickets de su empresa):

![Encargado de tickets](img/13_rol_encargado_tickets.png)

Vista de un **encargado del agente IA** (empresas y agentes, sin consola ni usuarios, sin "Agregar empresa"):

![Encargado del agente](img/14_rol_encargado_agente.png)

---

## 1. Encargado de tickets — Consola de soporte

### Ver los casos derivados

![Consola de soporte](img/01_consola.png)

Cada tarjeta es un caso que el bot derivó: empresa, número de ticket (`COR-xxxx`), estado, la consulta del cliente, el motivo de la
derivación y el tiempo transcurrido.

- Filtra por estado (**Urgente**, **Pendiente**, **Esperando cliente**, **Cerrado** y, para el admin, **Escalado**) con los botones de arriba.
- Filtra por empresa con el selector **Filtro** de la barra superior.
- Busca por número de ticket, cliente o texto en el buscador.
- La pantalla se actualiza sola cada 15 segundos.

### Atender un caso

Pulsa **Atender** en la tarjeta.

![Detalle del ticket](img/02_ticket_detalle.png)

1. A la izquierda lees la **transcripción completa** de la conversación con el bot, incluidas las fuentes que usó.
2. A la derecha hay una **sugerencia de respuesta** con su nivel de confianza y el documento base.
   Con **Usar esta respuesta** la copias al cuadro de respuesta.
3. Edita el texto si hace falta y pulsa **Enviar respuesta y encuesta**: el mensaje queda en la transcripción, el cliente recibe la
   pregunta **«¿se resolvió tu consulta?»** y el ticket pasa a **Esperando cliente**.
4. **El encargado no cierra el ticket; lo cierra el cliente:**
   - Si responde **Sí**, el ticket queda **Cerrado** y no se vuelve a abrir (si escribe de nuevo, se crea uno nuevo).
   - Si responde **No**, el ticket pasa a **Escalado**: sale de tu cola y lo gestiona el admin de la empresa fuera del chat.
   - Si no responde en 72 horas, se cierra solo.
   - Si escribe en vez de contestar la encuesta, el ticket vuelve a tu cola como **Pendiente**.
5. Otras acciones de la parte superior: **Marcar urgente** (sube el caso a Urgente) y el botón de agente para **reasignar** el caso
   a un usuario de la empresa. Un ticket **Escalado** lo ve y lo cierra el admin con **Cerrar ticket (ya gestionado)**.

> La sugerencia de respuesta es un borrador generado con la documentación de la empresa (con DeepSeek si hay clave; si no, una plantilla con el fragmento más relevante). Revísala siempre antes de enviarla.

---

## 2. Encargado del agente IA y admin — Empresas y agentes

### Ver las empresas

![Panel de empresas](img/03_empresas.png)

Cada tarjeta muestra la empresa, el estado de su agente (**activo**, **en configuración** o **inactivo**), su tono, los documentos
cargados y sus métricas del último mes. Desde ahí puedes **Probar** el bot o **Configurar agente**.

### Agregar una empresa

Pulsa **+ Agregar empresa**.

![Agregar empresa](img/04_agregar_empresa.png)

Completa el nombre (obligatorio), el rubro, el nombre del agente, el tono de respuesta, las instrucciones y un color de marca, y
pulsa **Crear empresa**. Queda en estado *en configuración* y sin documentos.

### Configurar el agente y cargar documentos

Pulsa **Configurar agente** en la tarjeta de la empresa.

![Configurar agente](img/05_configurar_agente.png)

El modal tiene tres secciones, de arriba hacia abajo:

1. **Datos de la empresa:** nombre y rubro.
2. **Base de conocimiento:** haz clic en la zona de carga o arrastra tus archivos (PDF, DOCX, TXT, CSV o FAQ; máximo 20 MB cada uno).
   Cada documento aparece como *procesando* y pasa a *procesado* cuando ya fue dividido en fragmentos.
   Si queda en *error*, el archivo está dañado o no se pudo leer: bórralo y súbelo de nuevo.
   Para quitar un documento, usa el ícono de papelera de su fila.
3. **Configuración del agente conversacional** (bajando en el modal): nombre del agente, tono, instrucciones personalizadas y
   **umbral RAG**. El umbral es la confianza mínima para que el bot responda; mientras más alto, más seguido deriva a un humano.
   Aquí también están el enlace de chat y el acceso al widget embebible (sección siguiente).

Al final, **Publicar agente** guarda los cambios y deja el agente **activo**; **Cancelar** cierra sin guardar. Los documentos, en
cambio, se suben y se borran al instante, sin esperar a publicar.

### Ver los fragmentos de un documento

Haz clic en un documento de la lista.

![Detalle del documento](img/06_detalle_documento.png)

Verás el tamaño, la fecha, el número de fragmentos y el texto de cada uno. El buscador resalta los fragmentos que contienen las
palabras de tu consulta, útil para comprobar que el documento se leyó bien.

### API key y widget embebible

Dentro de **Configurar agente**, pulsa **Ver código del widget embebible**.

![Widget embebible](img/07_widget_embebible.png)

Pulsa **Generar API key**: se muestra **una sola vez**; cópiala. Si la pierdes o la expones, usa **Regenerar** (la anterior deja
de funcionar). El script se copia con **Copiar script**.

Pega el script antes de `</body>` en tu sitio: aparece un botón flotante que abre el chat de tu empresa (el agente debe estar
**activo**). El mismo chat está disponible como página pública en el **enlace de chat** (`/chat/{slug}`). La API key del widget ya
no es necesaria; sirve solo para integraciones propias vía `POST /chat`.

---

## 3. Usuario final — Chat

Se muestra en **Vista previa del widget**, que simula el sitio de la empresa con el chat abierto. Elige la empresa con los botones de
arriba; el ícono de flecha circular reinicia la conversación.

### Hacer una consulta

Escribe en la barra inferior y pulsa Enter. Si la respuesta salió de la documentación, el bot muestra el **documento fuente** y su
**porcentaje de confianza**.

![Respuesta con fuente](img/08_widget_respuesta_rag.png)

### Cuando el bot no puede ayudar

Si no encuentra información suficiente, o si el usuario lo pide con **¿Prefieres hablar con una persona?**, el bot avisa que
deriva el caso y se crea un ticket automáticamente.

![Derivación](img/09_widget_derivacion.png)

### Ver la respuesta del agente

En el chat público (`/chat/{slug}`) y en el widget embebido, el cliente **ve la respuesta del agente humano en la misma ventana**, sin
recargar: tras la derivación la conversación se actualiza sola cada pocos segundos. Junto a la respuesta aparece la **encuesta**
«¿Se resolvió tu consulta?» con **Sí, se resolvió** (cierra el caso) y **No, sigue sin resolverse** (lo escala a la gestión de la empresa).
Con el caso terminado, el chat se desactiva y ofrece **Iniciar una nueva consulta**. Si recarga la página, recupera la conversación. Con el widget cerrado, un **punto rojo** sobre el botón avisa que hay una respuesta nueva.

El botón **Ver este ticket en la Consola de Soporte** lleva a la consola de los agentes, donde el caso ya aparece.

![Ticket nuevo en la consola](img/10_consola_ticket_nuevo.png)

Desde ese momento el bot no vuelve a responder en esa conversación: la atiende el agente humano.

---

### Encuesta de resolución

Cuando el encargado responde, el cliente ve su respuesta **en la misma ventana** (sin recargar) y la pregunta **«¿se resolvió tu consulta?»**:

![Chat con la respuesta del agente y la encuesta](img/15_chat_publico_encuesta.png)

- **Sí, se resolvió:** el ticket queda **Cerrado** y no se vuelve a abrir.
- **No, sigue sin resolverse:** el ticket pasa a **Escalado**: sale de la cola del encargado y lo gestiona el admin de la empresa fuera del chat.
- Sin respuesta en 72 h el ticket se cierra solo.

![Caso escalado desde el chat](img/19_chat_publico_escalado.png)

El admin de la empresa ve los tickets escalados en la consola (filtro **Escalado**) y, cuando los resuelve por otro medio, los cierra con **Cerrar ticket (ya gestionado)**:

![Ticket escalado en la consola](img/17_ticket_escalado.png)

### El chat dentro del sitio de la empresa

Al pegar el script del widget en el sitio de la empresa aparece un botón flotante que abre el chat; si el agente humano responde con el chat cerrado, el botón muestra un punto rojo.

![Widget embebido en un sitio](img/18_widget_embebido_sitio.png)

## 4. Probar un agente sin salir del panel

En la tarjeta de una empresa, pulsa **Probar** (o **Probar agente** dentro de la configuración) para abrir un simulador de chat.
Usa el mismo motor que el chat real, así que sirve para revisar las respuestas después de cargar documentos.

> Las conversaciones del simulador y de la vista previa son reales: si el bot deriva, se crea un ticket de verdad en la consola.

## 4.1 Analítica

La vista **Analítica** muestra conversaciones, la resolución del bot frente a las derivadas a humano, el tiempo promedio de atención y el volumen diario (7, 14 o 30 días). El superadmin ve todas las empresas; cada rol de empresa ve solo la suya.

![Analítica](img/16_analitica.png)

## 5. Problemas frecuentes

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| "Credenciales inválidas" al entrar | Correo o clave mal escritos, o el usuario fue desactivado | Revisar los datos o pedir a tu admin que te reactive |
| De repente vuelve al login | La sesión venció (8 h) o desactivaron tu usuario | Volver a iniciar sesión |
| "Tu rol no tiene permiso para esta acción" | La acción no corresponde a tu rol | Pedir a tu admin de empresa que te cambie el rol |
| Aviso rojo "No se pudo cargar la información del backend" | El servidor no está corriendo | Ejecutar `.\iniciar.ps1` y pulsar **Reintentar** |
| "Demasiadas solicitudes" en el chat o al iniciar sesión | Se superó el límite de peticiones por minuto | Esperar el tiempo indicado y reintentar |
| "Esta conversación ya fue cerrada" | El cliente quiso seguir escribiendo en un caso cerrado | Iniciar una nueva consulta (el ticket cerrado no se reabre) |
| El bot deriva casi todas las consultas | La empresa no tiene documentos, o el umbral RAG es muy alto | Cargar documentos; bajar el umbral en **Configurar agente** |
| Documento en estado "error" | Archivo corrupto o formato no soportado | Borrarlo y subir otro archivo (PDF, DOCX, TXT, CSV, FAQ) |
| "Tipo no soportado" al subir | Extensión distinta a las permitidas | Convertir el archivo |
| Perdí la API key | Solo se muestra una vez | Usar **Regenerar** en el widget embebible |
| Los documentos de ejemplo no muestran fragmentos | Vienen del seed, sin archivo real | Subir un archivo propio |
| La tasa de resolución del bot aparece en 0 % | Aún no hay conversaciones resueltas por el bot hoy | Conversar con el bot sobre un tema que esté en los documentos |
