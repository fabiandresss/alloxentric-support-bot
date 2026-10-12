"""Chat público por slug (RF-29): lo usa la página /chat/{slug} y el iframe del widget embebible.

No lleva autenticación: el slug de la ruta identifica a la empresa (es el mismo que expone `webChatUrl`).
Solo responde si el agente está `activo` y solo devuelve datos de marca, nunca documentos ni API keys.
"""
import uuid
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session
from app import models as m, schemas as s
from app.db import get_db
from app.deps import empresa_por_slug
from app.mappers import mensaje_out
from app.ratelimit import limite, verificar
from app.services import ciclo_ticket
from app.services.chat import procesar_mensaje

router = APIRouter(prefix="/publico", tags=["publico"])


@router.get("/{slug}", response_model=s.PublicAgent, dependencies=[Depends(limite("agente", 60, 60, por=("slug",)))])
def agente_publico(e: m.Empresa = Depends(empresa_por_slug)):
    """Datos mínimos para pintar el chat (nombre, marca y si el agente está disponible)."""
    return s.PublicAgent(
        name=e.nombre, agent_name=e.nombre_agente or f"{e.nombre} Assistant",
        logo_initials=e.iniciales_logo or e.nombre[:2].upper(),
        brand_color=e.color_marca or "#4F46E5", brand_bg=e.color_fondo or "#EEF2FF",
        agent_status=e.estado_agente)


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


def _salida(conv: m.Conversacion, ticket: m.Ticket | None) -> s.PublicConversation:
    return s.PublicConversation(
        conversation_id=str(conv.id), messages=[mensaje_out(x) for x in conv.mensajes],
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
    return _salida(conv, ticket)


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
    return _salida(conv, ticket)
