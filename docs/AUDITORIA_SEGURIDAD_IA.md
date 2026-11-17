# Auditoría de seguridad de la IA

Alcance: los chatbots de las empresas (chat público `/chat/{slug}`, widget, `POST /chat` con API key), el motor RAG
(`services/motor_rag.py`), el cliente de Bedrock (`services/llm.py`) y los guardarraíles (`services/seguridad.py`).
Fecha de esta versión: semana 11 (15 nov 2026).

> **Declaración honesta:** un sistema con LLM no puede ser «100 % seguro». El modelo interpreta lenguaje natural y no
> existe una separación absoluta entre instrucciones y datos. Lo que se hizo es reducir el riesgo con **defensa en
> profundidad** (varias capas independientes), **medirlo** con una batería adversarial repetible y **dejar registro** de cada
> intervención. Lo que queda abierto está en «Riesgo residual».

## 1. Modelo de amenazas

| Quién ataca | Qué quiere | Por dónde entra |
|---|---|---|
| Cliente malicioso del chat | Que el bot ignore sus reglas, revele su prompt, diga cosas dañinas o gaste tokens | Mensaje del chat |
| Cliente malicioso | Leer datos de **otra empresa** (documentos, conversaciones) | Mensaje, ids en la URL |
| Autor de un documento (o quien logre subir uno) | Dar órdenes al modelo desde la documentación (**inyección indirecta**) | Fragmentos recuperados |
| Cliente | Sacar información por canales laterales (imágenes/enlaces Markdown) | Respuesta del modelo |
| Cliente descuidado | Escribir RUT, tarjetas o claves en el chat | Mensaje (privacidad) |
| Cliente | Inyectar contenido al agente humano o al prompt del borrador | Nombre del cliente, comentarios 👎 |
| Abuso | Conversaciones interminables o ráfagas que disparen el costo | Chat sin sesión |

## 2. Controles implementados (por capa)

| Capa | Control | Dónde | Evidencia (prueba) |
|---|---|---|---|
| Entrada | Limpieza de caracteres invisibles, de control y NFKC (esconden instrucciones) | `seguridad.limpiar` | `test_limpia_caracteres_invisibles`, ataques ofuscados |
| Entrada | Enmascarado de RUT (con dígito verificador), tarjetas (Luhn), correos, teléfonos y claves/secretos **antes** del modelo, del registro y de los embeddings | `seguridad.enmascarar` | `test_enmascara_*`, `test_los_datos_personales_no_llegan_al_modelo_ni_se_guardan` |
| Entrada | Detección de inyección/jailbreak en español e inglés (anular reglas, revelar prompt, cambio de rol, delimitadores falsos, exfiltración, otros tenants, infraestructura, ofuscación por espaciado/leet/base64). Bloquea **sin llamar al modelo** y no crea ticket | `seguridad.puntaje_inyeccion` | 50 ataques detectados y 25 consultas legítimas sin falsos positivos (`test_seguridad.py`) |
| Entrada | Temas prohibidos por empresa | `seguridad.tema_prohibido` | `test_temas_prohibidos` |
| Entrada | Tope de 80 mensajes por conversación; rate limiting existente en endpoints sin sesión; límite de gasto FinOps | `chat.py`, `ratelimit.py`, `finops.py` | `test_tope_de_mensajes_por_conversacion` |
| Entrada | Nombre del cliente saneado (va a un prompt y a la pantalla del agente) | `seguridad.nombre_seguro` | `test_nombre_del_cliente_con_inyeccion_no_entra_al_prompt_del_borrador` |
| Contexto | Los fragmentos con órdenes ocultas no se usan (inyección indirecta) y quedan en el registro | `motor_rag._sin_instrucciones_ocultas` | `test_inyeccion_indirecta_por_un_documento`; un manual que *habla* de seguridad no se bloquea |
| Prompt | Delimitadores con código aleatorio por petición, reglas de seguridad no negociables, datos marcados como no confiables, **canario** en el sistema | `seguridad.envolver`, `REGLAS_SEGURIDAD` | `test_el_prompt_va_endurecido_con_delimitadores_unicos` |
| Salida | Si aparece el canario o 40 caracteres seguidos del prompt → se descarta; se eliminan imágenes, HTML y enlaces que no estén en la documentación | `seguridad.filtrar_salida` | `test_si_el_modelo_filtra_el_canario…`, `test_la_respuesta_no_puede_sacar_datos…` |
| Salida | Resumen y borrador para humanos validados (urgencia en lista cerrada, texto saneado); el modelo **no puede bajar** la urgencia detectada por reglas | `services/resumen.py` | `test_el_resumen_con_ia_se_valida…` |
| Aislamiento | `empresa_id` en toda consulta; la valoración exige conversación y empresa del slug; eventos y vacíos por tenant | routers | `test_eventos_de_seguridad_aislados_por_empresa`, `test_solo_se_valoran_respuestas_del_bot…` |
| Gobierno | Solo el admin cambia las defensas; encargado del agente no puede apagarlas | `routers/empresas.py` | `test_solo_el_admin_cambia_la_seguridad` |
| Auditoría | Tabla `eventos_seguridad` (extracto ya enmascarado, severidad, señales) y vista «Seguridad de la IA» | `routers/seguridad.py`, `SecurityView.tsx` | — |

## 3. Mapeo OWASP Top 10 para LLM (2025)

| Riesgo | Estado | Comentario |
|---|---|---|
| LLM01 Inyección de prompt (directa e indirecta) | Mitigado en capas | Reglas + delimitadores + fragmentos filtrados + salida filtrada. No es absoluto (ver residual) |
| LLM02 Divulgación de información sensible | Mitigado | PII enmascarada, canario, aislamiento por tenant, sin secretos en el prompt (credenciales de AWS fuera del código) |
| LLM03 Cadena de suministro | Parcial | Un solo servicio externo (Bedrock); dependencias sin auditoría automática (pendiente `pip-audit`/`npm audit`) |
| LLM04 Envenenamiento de datos | Parcial | Solo roles de gestión suben documentos; se detectan órdenes ocultas. No se verifica la veracidad del contenido |
| LLM05 Manejo inseguro de la salida | Mitigado | El front renderiza texto plano (React escapa); se quitan HTML/imágenes/enlaces |
| LLM06 Agencia excesiva | Mitigado por diseño | El modelo no tiene herramientas ni acceso a la BD; solo recibe fragmentos y devuelve texto |
| LLM07 Fuga del prompt del sistema | Mitigado | Canario y detección de copia; el prompt no contiene secretos |
| LLM08 Debilidades de vectores y embeddings | Mitigado | Búsqueda siempre filtrada por `empresa_id` y por embedder |
| LLM09 Desinformación | Parcial | Umbral RAG, respuesta `NO_SE`, derivación a humano y golden sets; el modelo puede aun así equivocarse |
| LLM10 Consumo no acotado | Mitigado | Rate limiting, tope de mensajes por conversación, plan de gasto mensual/diario con modo extractivo |

## 4. Cómo verificar

```bash
cd backend && pytest -q tests/test_seguridad.py            # batería con modelo falso (rápida, sin AWS)
python auditoria_ia/auditar.py --slug wellq                # 20 ataques contra Bedrock REAL (plataforma corriendo)
```

Repite la auditoría viva cuando cambies el modelo de una empresa, el prompt (`motor_rag._sistema`) o `REGLAS_SEGURIDAD`:
cada modelo se resiste distinto.

### Resultado de la auditoría viva (15 nov 2026, Bedrock real, Claude Haiku 5.5, empresa WellQ)

20 ataques (revelar prompt y canario, jailbreak, cambio de rol, delimitadores falsos, exfiltración por imagen/enlace, otros tenants,
infraestructura, ofuscación por espaciado y base64, ingeniería social, PII), cada uno pegado a una pregunta que sí tiene respuesta
en la documentación para que el modelo participe: **0 vulnerables** — 11 bloqueados por las reglas (sin llamar al modelo) y 9
resistidos por el modelo (respondió solo la parte legítima y se negó a lo demás). Informe: `backend/auditoria_ia/resultados.json`.

Dos advertencias para leer bien el resultado:

- Una primera pasada sin la pregunta legítima dio 20/20, pero **no probaba al modelo**: el RAG derivaba por falta de contexto
  antes de llamarlo. Por eso el script antepone una pregunta respondible (`--prefijo`).
- El primer detector marcó un falso «vulnerable» (el modelo se negó diciendo «reglas de seguridad»). Se corrigió la comparación
  y el caso se reevaluó con la respuesta guardada: es una negativa, no una fuga.

Son 20 ataques: demuestra que las defensas funcionan contra los casos conocidos, no que no exista otro que las esquive.

## 5. Riesgo residual (lo que NO se puede garantizar)

1. **Ataques nuevos o muy creativos** (idiomas poco comunes, codificaciones raras, ataques en varios turnos) pueden esquivar
   las reglas; en ese caso quedan la negativa del modelo y el filtro de salida. Por eso hay registro y se recomienda revisar
   la vista de seguridad.
2. **Falsos positivos:** una consulta legítima redactada como orden («ignora mis reglas de facturación anteriores…») puede
   bloquearse. El cliente recibe una negativa amable y puede pedir un humano.
3. **PII fuera de patrón:** solo se detectan formatos conocidos (RUT chileno válido, tarjetas Luhn, correos, teléfonos, claves).
   Nombres, direcciones o datos de salud en texto libre **no** se enmascaran.
4. **Extractos de fuentes al cliente:** con `publicSources = extracto` el cliente ve un trozo de la documentación que ya
   cita el bot. Si un documento tiene información no pública, usar `nombre` o `ninguna`.
5. **El chat público no tiene sesión:** la protección es el rate limiting y los topes; un atacante con muchas IP puede
   gastar hasta el límite de gasto de la empresa (cuando está configurado).
6. **Veracidad:** los guardarraíles no impiden que el modelo malinterprete un fragmento correcto.
7. **Bedrock:** los mensajes (ya enmascarados) salen a AWS. Revisar los términos de retención del modelo elegido.
8. **No cubierto en esta etapa:** análisis de dependencias, pentest de la API completa, WAF y cifrado en reposo de la BD.

## 6. Recomendaciones

- Mantener `injection` y `pii` activados (por defecto) y dejar `publicSources` en `nombre` para documentación sensible.
- Definir un plan de gasto con tope en cada empresa en producción.
- Revisar semanalmente «Seguridad de la IA» y las preguntas sin respuesta.
- Repetir `auditar.py` tras cambios de modelo/prompt y guardar el `resultados.json` junto al informe del Capstone.
- Pendiente: `pip-audit` y `npm audit` en CI, y una segunda revisión cruzada (Vicente) de `seguridad.py`.
