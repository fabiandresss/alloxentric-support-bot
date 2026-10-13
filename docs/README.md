# Documentación

| Documento | Contenido |
|---|---|
| [01_documentacion_tecnica.md](01_documentacion_tecnica.md) | Arquitectura, modelo de datos, flujos, API, seguridad, pruebas, trazabilidad con los requisitos y pendientes |
| [02_manual_de_usuario.md](02_manual_de_usuario.md) | Manual para agentes de soporte, administradores y usuarios finales, con capturas |
| [MATRIZ_PERMISOS.md](MATRIZ_PERMISOS.md) | Los cuatro roles, qué puede hacer cada uno y cómo se garantiza (RF-28, RF-30) |
| [MAPEO_FRONTEND.md](MAPEO_FRONTEND.md) | Correspondencia campo por campo entre el front, la API y la base de datos |
| `diagramas/` | Fuentes Mermaid (`.mmd`) y PNG de la arquitectura, el modelo de datos y el flujo del chat |
| `img/` | Capturas de la interfaz real (regeneradas en la semana 10) usadas en el manual |
| `../backend/calidad_rag/` | Batería de calidad del RAG: corpus, 45 preguntas, evaluador y resultados por embedder |
| `../*.xlsx` | Carta Gantt (S10) y Requerimientos (39 RF, EDT, cronograma, stack, hoja "Pendientes S10") |

Los diagramas se regeneran con `npx @mermaid-js/mermaid-cli -i diagramas/arquitectura.mmd -o diagramas/arquitectura.png -s 2`.
