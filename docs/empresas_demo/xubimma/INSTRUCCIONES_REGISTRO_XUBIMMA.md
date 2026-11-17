# Guía de Práctica: Registro de Nueva Empresa (XubiMMA), Ingesta RAG y Conexión de Landing Page

**Proyecto Capstone PTY4614 — Duoc UC**  
**Alumnos:** Vicente Balladares & Fabián Armijo  
**Plataforma:** Alloxentric SupportHub Multi-Tenant  
**Fecha:** Noviembre 2026  

---

## 1. Resumen del Ejercicio

Este ejercicio práctico permite validar en vivo los requerimientos funcionales clave del proyecto:
- **RF-01 / RF-02 / RF-03 (Multi-tenant):** Aislamiento de datos y creación de un nuevo tenant (`xubimma`).
- **RF-04 / RF-05 / RF-06 (Ingesta y Embeddings):** Carga de documentos reales (PDF y MD), extracción de texto, fragmentación semántica (chunking) y almacenamiento de vectores en PostgreSQL con `pgvector` (384 dimensiones).
- **RF-10 / RF-12 / RF-14 (Motor RAG):** Búsqueda semántica por similitud de coseno acotada estrictamente a la empresa `xubimma`.
- **RF-29 (Widget Embebible y Chat Público):** Integración del widget de soporte en la nueva landing page `xubimma-landing.html`.
- **RF-16 / RF-17 (Derivación a Corestream):** Derivación automática ante consultas que requieren atención humana (lesiones, congelamientos o facturación).

---

## 2. Archivos Generados para la Prueba

Todos los archivos han sido generados y depositados en:
- `alloxentric-support-bot/docs/empresas_demo/xubimma/`
- `alloxentric-support-bot/frontend/public/`
- `chat-soporte-generico-alloxentric/Fase 2/Evidencias Proyecto/xubimma/`

### Listado de Archivos:
1. **`xubimma-landing.html`**: Landing page completa de XubiMMA con estética de combate (rojo, carbón y oro), catálogo de disciplinas, tabla de precios, FAQ interactivo y el script de inyección del widget oficial (`/widget.min.js`).
2. **`XubiMMA_Guia_Oficial_Membresias_y_Servicios_2026.pdf`**: Documento institucional en PDF listo para ser cargado en el módulo de ingesta (contiene descripción de disciplinas, valores de membresías, indumentaria obligatoria, staff técnico y políticas).
3. **`XubiMMA_FAQ_y_Protocolos_Seguridad.pdf`**: Segundo PDF con más de 20 preguntas y respuestas sobre pruebas gratuitas, congelamientos médicos y reglas del tatami.
4. **`XubiMMA_Guia_Oficial_Membresias_y_Servicios_2026.md`** y **`XubiMMA_FAQ_y_Protocolos_Seguridad.md`**: Versiones en Markdown puro para pruebas alternativas de ingesta directa de texto.

---

## 3. Paso a Paso para la Demostración

### Paso 1: Levantar el Entorno Local
Desde la raíz de `C:\Proyectos\alloxentric-support-bot`:
```powershell
.\iniciar.ps1
```
*(Si no tienes Docker abierto en tu máquina, puedes usar `.\iniciar.ps1 -SinDocker`).*

Verifica que:
- Backend esté disponible en: `http://localhost:8000/docs`
- Frontend esté corriendo en: `http://localhost:3000`

---

### Paso 2: Registrar la Empresa en la Plataforma
1. Ingresa a `http://localhost:3000` e inicia sesión como superadministrador:
   - **Correo:** `superadmin@alloxentric.local`
   - **Contraseña:** la que figure en tu archivo `.env` (`SUPERADMIN_PASSWORD`).
2. En el panel superior o menú lateral, haz clic en el botón **"+ Agregar Empresa"**.
3. Completa el formulario con los siguientes datos del tenant:
   - **Nombre:** `XubiMMA`
   - **Slug:** `xubimma` (se autogenera)
   - **Industria:** `Centro de Alto Rendimiento & Deportes de Contacto`
   - **Nombre del Agente:** `XubiBot MMA`
   - **Iniciales Logo:** `XM`
   - **Color de Marca:** `#DC2626` (Rojo combate)
   - **Color de Fondo:** `#FEF2F2`
   - **Tono de Respuesta:** `enérgico` (o `cercano`)
   - **Instrucciones Personalizadas (Prompt del Sistema):**
     ```text
     Eres XubiBot MMA, el asistente oficial y coach virtual de XubiMMA Training Center.
     Respondes con energía, motivación, claridad y disciplina marcial.
     Ayudas a los atletas y alumnos con información de membresías (Striker, Grappler, Fighter Pro, Black Belt), horarios de clases (Muay Thai, Brazilian Jiu-Jitsu Gi/No-Gi, Boxeo, MMA y Acondicionamiento Físico), requisitos de indumentaria obligatoria (guantillas, bucal, canilleras, kimono), protocolos de seguridad y pesaje, y convenios corporativos para empresas y estudiantes de Duoc UC.
     Si un usuario reporta una lesión severa, dolor agudo o emergencia en las instalaciones, indícale de inmediato acudir a la enfermería o llamar al 131, y deriva la consulta a Corestream con etiqueta URGENTE.
     ```
4. Guarda la empresa.

---

### Paso 3: Activar el Agente (¡Paso Fundamental!)
> **REGLA DE NEGOCIO:** Cuando se crea una nueva empresa, su agente inicia en estado `en_configuracion`. La API pública de chat (`/publico/{slug}/chat`) rechaza peticiones (error 403) a menos que el agente esté en estado `activo`.

1. En la lista de empresas, selecciona **XubiMMA**.
2. Ve a la pestaña **Configuración del Agente**.
3. Cambia el interruptor de estado a **Activo** y guarda los cambios.

---

### Paso 4: Cargar la Documentación RAG
1. Con la empresa **XubiMMA** seleccionada, ingresa a la pestaña **Documentos**.
2. Haz clic en **Subir Documento** (o arrastra los archivos):
   - Sube: `docs/empresas_demo/xubimma/XubiMMA_Guia_Oficial_Membresias_y_Servicios_2026.pdf`
   - Sube: `docs/empresas_demo/xubimma/XubiMMA_FAQ_y_Protocolos_Seguridad.pdf`
3. Observa cómo el estado cambia de `procesando` a `procesado`.
4. Si haces clic sobre cualquier documento procesado, podrás ver los fragmentos de texto generados (`chunks`) y confirmar que están vectorizados con el modelo `paraphrase-multilingual-MiniLM-L12-v2`.

---

### Paso 5: Abrir la Landing Page y Probar el Widget
1. Abre en tu navegador la landing page:
   ```text
   http://localhost:3000/xubimma-landing.html
   ```
   *(También puedes abrir directamente el archivo `frontend/public/xubimma-landing.html` con doble clic).*
2. En la esquina inferior derecha verás el botón flotante rojo con el ícono de chat de **XubiBot MMA**.
3. Haz clic en el botón para desplegar el chat embebido.

---

## 4. Batería de Preguntas de Prueba Recomendadas

Prueba las siguientes consultas para comprobar el funcionamiento del motor RAG y la derivación:

| # | Pregunta a enviar en el chat | Respuesta esperada del RAG / Sistema |
|---|---|---|
| **1** | *"¿Cuánto cuesta el plan Fighter Pro y qué incluye?"* | Debe responder que cuesta **$65.000 CLP al mes**, con acceso ilimitado a las 6 disciplinas (MMA, BJJ, Muay Thai, Boxeo, Lucha y S&C) y matrícula gratis. |
| **2** | *"¿Puedo tomar una clase de prueba gratis?"* | Debe confirmar que la **1ª clase es 100% gratuita** para personas que no hayan sido alumnas antes. |
| **3** | *"¿Qué ropa y equipo necesito para mi primera clase de Muay Thai?"* | Debe indicar ropa deportiva, toalla, agua, sandalias para el tatami, y mencionar que en recepción prestan guantes desinfectados. |
| **4** | *"Tengo 15% de descuento por estudiar en Duoc UC?"* | Debe responder afirmativamente, indicando que con certificado de alumno regular de Duoc UC o Inacap se obtiene un 15% de descuento permanente. |
| **5** | *"¿Quién es el entrenador de Jiu-Jitsu?"* | Debe mencionar al Head Coach **Vicente "El Tanque" Balladares**, Faixa Preta 2º Grado BJJ. |
| **6** | *(Prueba de derivación)* *"Me fracturé el tobillo y necesito congelar mi membresía por 2 meses"* | Al tratarse de una gestión médica/administrativa que excede la información general, el bot debe activar la derivación a **Corestream** y entregar un código de ticket (ej. `COR-8930`). |

---

## 5. Validación en la Consola Corestream
Tras la pregunta #6:
1. Vuelve a la consola administrativa (`http://localhost:3000`).
2. Entra a la vista de **Tickets / Mesa de Ayuda**.
3. Filtra por la empresa **XubiMMA**.
4. Verás el ticket recién creado con prioridad y la transcripción completa de la conversación.
5. Como agente humano, redacta una respuesta ("*Hola, hemos recibido tu certificado. Tu membresía ha sido congelada hasta tu alta médica*").
6. Regresa a la landing page `xubimma-landing.html` y verás cómo el widget muestra un indicador rojo de mensaje no leído y la respuesta del operador humano.
