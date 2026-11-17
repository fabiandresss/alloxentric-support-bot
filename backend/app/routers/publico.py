"""Chat público por slug (RF-29): lo usa la página /chat/{slug} y el iframe del widget embebible.

No lleva autenticación: el slug de la ruta identifica a la empresa (es el mismo que expone `webChatUrl`).
Solo responde si el agente está `activo` y solo devuelve datos de marca, nunca documentos ni API keys.
"""
import json
import queue
import re
import threading
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session
from app import models as m, schemas as s
from app.db import SessionLocal, get_db
from app.deps import empresa_por_slug
from app.mappers import mensaje_out
from app.ratelimit import limite, verificar
from app.services import ciclo_ticket, horario, memoria, motor_rag, seguridad
from app.services.chat import procesar_mensaje

router = APIRouter(prefix="/publico", tags=["publico"])


@router.get("/{slug}", response_model=s.PublicAgent, dependencies=[Depends(limite("agente", 60, 60, por=("slug",)))])
def agente_publico(e: m.Empresa = Depends(empresa_por_slug)):
    """Datos mínimos para pintar el chat (nombre, marca y si el agente está disponible)."""
    return s.PublicAgent(
        name=e.nombre, agent_name=e.nombre_agente or f"{e.nombre} Assistant",
        logo_initials=e.iniciales_logo or e.nombre[:2].upper(),
        brand_color=e.color_marca or "#4F46E5", brand_bg=e.color_fondo or "#EEF2FF",
        agent_status=e.estado_agente, human_support=s.HumanSupport(**horario.estado(e)))


# 20 mensajes/min por IP y empresa; además, como máximo 6 conversaciones nuevas/min (cada derivación crea un ticket)
@router.post("/{slug}/chat", response_model=s.ChatResponse, response_model_exclude_none=True,
             dependencies=[Depends(limite("chat", 20, 60, por=("slug",)))])
def chat_publico(request: Request, body: s.ChatRequest, e: m.Empresa = Depends(empresa_por_slug),
                 db: Session = Depends(get_db)):
    if not body.conversation_id:
        verificar(request, "nueva_conv", 6, 60, extra=e.slug)
    if e.estado_agente != "activo":
        raise HTTPException(403, "El agente de esta empresa no está activo")
    return procesar_mensaje(db, e, body)


def _conversacion(db: Session, e: m.Empresa, conversation_id: str) -> tuple[m.Conversacion, m.Ticket | None]:
    """Conversación del tenant (404 si el id no existe o es de otra empresa) y su ticket, ya con el barrido de
    encuestas vencidas aplicado."""
    try:
        cid = uuid.UUID(conversation_id)
    except ValueError:
        raise HTTPException(404, "Conversación no encontrada")
    ciclo_ticket.cerrar_vencidos(db, e.id)
    conv = db.scalar(select(m.Conversacion).where(
        m.Conversacion.id == cid, m.Conversacion.empresa_id == e.id))  # <- tenant
    if not conv:
        raise HTTPException(404, "Conversación no encontrada")
    ticket = db.scalar(select(m.Ticket).where(
        m.Ticket.conversacion_id == conv.id, m.Ticket.empresa_id == e.id))
    return conv, ticket


def _salida(e: m.Empresa, conv: m.Conversacion, ticket: m.Ticket | None) -> s.PublicConversation:
    return s.PublicConversation(
        conversation_id=str(conv.id), messages=[mensaje_out(x, e) for x in conv.mensajes],
        derived=conv.derivada, ticket_number=ticket.numero if ticket else None,
        ticket_status=ticket.estado if ticket else None)


# el widget consulta cada 5 s (12/min); 30/min deja margen para recargas
@router.get("/{slug}/conversaciones/{conversation_id}", response_model=s.PublicConversation,
            response_model_exclude_none=True,
            dependencies=[Depends(limite("conversacion", 30, 60, por=("slug", "conversation_id")))])
def conversacion_publica(conversation_id: str, e: m.Empresa = Depends(empresa_por_slug),
                         db: Session = Depends(get_db)):
    """Transcripción de una conversación para que el cliente vea la respuesta del agente humano.

    El id (UUID aleatorio) es la credencial de la conversación, igual que en POST /chat; además se exige que
    pertenezca a la empresa del slug (la de otra empresa responde 404). No expone al agente asignado ni
    datos internos del ticket: solo su número y estado (`esperando_cliente` = hay una encuesta por responder).
    """
    conv, ticket = _conversacion(db, e, conversation_id)
    return _salida(e, conv, ticket)


@router.put("/{slug}/conversaciones/{conversation_id}/mensajes/{message_id}/valoracion", response_model=s.ChatMessage,
            response_model_exclude_none=True,
            dependencies=[Depends(limite("valoracion", 30, 60, por=("slug", "conversation_id")))])
def valorar_respuesta(conversation_id: str, message_id: str, body: s.RatingIn, e: m.Empresa = Depends(empresa_por_slug),
                      db: Session = Depends(get_db)):
    """El cliente valora una respuesta del bot (👍/👎, con comentario opcional). Solo se pueden valorar respuestas del bot de ESTA
    conversación y empresa; `rating: null` quita la valoración. Las 👎 alimentan los casos de prueba y la analítica de satisfacción."""
    conv, _ = _conversacion(db, e, conversation_id)
    try:
        mid = uuid.UUID(message_id)
    except ValueError:
        raise HTTPException(404, "Mensaje no encontrado")
    msg = db.scalar(select(m.Mensaje).where(m.Mensaje.id == mid, m.Mensaje.conversacion_id == conv.id,
                                            m.Mensaje.empresa_id == e.id, m.Mensaje.rol == "bot"))      # <- tenant
    if not msg:
        raise HTTPException(404, "Mensaje no encontrado")
    msg.valoracion = {"up": "arriba", "down": "abajo"}.get(body.rating or "")
    comentario = seguridad.enmascarar(body.comment or "")[0] if body.rating else ""
    msg.valoracion_comentario = " ".join(comentario.split())[:500] or None
    msg.valoracion_en = datetime.now(timezone.utc) if body.rating else None
    db.commit()
    db.refresh(msg)
    return mensaje_out(msg, e)


@router.post("/{slug}/chat/stream", dependencies=[Depends(limite("chat", 20, 60, por=("slug",)))])
def chat_publico_stream(request: Request, body: s.ChatRequest, e: m.Empresa = Depends(empresa_por_slug)):
    """Igual que POST /{slug}/chat pero la respuesta llega por SSE: eventos `delta` (texto a medida que se escribe) y uno final `done` con la
    misma respuesta que devuelve el chat normal (el cliente debe reemplazar lo mostrado por ese texto: ya pasó los filtros de seguridad)."""
    if not body.conversation_id:
        verificar(request, "nueva_conv", 6, 60, extra=e.slug)
    if e.estado_agente != "activo":
        raise HTTPException(403, "El agente de esta empresa no está activo")
    cola: queue.Queue = queue.Queue()
    empresa_id = e.id

    def trabajo():
        try:
            with SessionLocal() as db:      # sesión propia: este hilo no comparte la de la petición
                empresa = db.get(m.Empresa, empresa_id)
                with motor_rag.emitiendo(lambda t: cola.put(("delta", t))):
                    cola.put(("done", procesar_mensaje(db, empresa, body)))
        except HTTPException as ex:
            cola.put(("error", {"status": ex.status_code, "detail": ex.detail}))
        except Exception:   # noqa: BLE001
            cola.put(("error", {"status": 500, "detail": "No se pudo responder. Intenta de nuevo."}))
        finally:
            cola.put(None)

    threading.Thread(target=trabajo, daemon=True).start()

    def eventos():
        while (item := cola.get()) is not None:
            tipo, dato = item
            if tipo == "delta":
                carga = {"type": "delta", "text": dato}
            elif tipo == "done":
                carga = {"type": "done", "data": dato.model_dump(by_alias=True, exclude_none=True)}
            else:
                carga = {"type": "error", **dato}
            yield f"data: {json.dumps(carga, ensure_ascii=False)}\n\n"

    return StreamingResponse(eventos(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.delete("/{slug}/memoria/{visitor_id}", status_code=204,
               dependencies=[Depends(limite("olvidar", 10, 60, por=("slug",)))])
def olvidar_cliente(visitor_id: str, e: m.Empresa = Depends(empresa_por_slug), db: Session = Depends(get_db)):
    """El cliente pide que el chatbot lo olvide: se borra su perfil (nombre y últimas consultas) y se desvinculan sus conversaciones de su
    identificador. Es idempotente. El identificador es el que su navegador generó; solo afecta a esta empresa."""
    if not re.fullmatch(r"[0-9a-fA-F\-]{16,64}", visitor_id):
        raise HTTPException(404, "Identificador no válido")
    memoria.olvidar(db, e, visitor_id)
    db.commit()


@router.post("/{slug}/conversaciones/{conversation_id}/encuesta", response_model=s.PublicConversation,
             response_model_exclude_none=True,
             dependencies=[Depends(limite("encuesta", 10, 60, por=("slug", "conversation_id")))])
def responder_encuesta(conversation_id: str, body: s.SurveyAnswer, e: m.Empresa = Depends(empresa_por_slug),
                       db: Session = Depends(get_db)):
    """El cliente responde la encuesta de resolución que envió el agente.

    Sí → el ticket se cierra y no se reabre. No → se escala a gestión (sale de la cola del encargado y el
    chat deja de responder). Solo vale mientras el ticket está `esperando_cliente`.
    """
    conv, ticket = _conversacion(db, e, conversation_id)
    if not ticket or ticket.estado != "esperando_cliente":
        raise HTTPException(409, "No hay una encuesta pendiente en esta conversación")
    ciclo_ticket.responder_encuesta(db, e, conv, ticket, body.resolved)
    db.expire_all()  # recargar la transcripción con los mensajes nuevos
    conv, ticket = _conversacion(db, e, conversation_id)
    return _salida(e, conv, ticket)
