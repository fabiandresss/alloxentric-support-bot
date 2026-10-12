import uuid
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from app import models as m, schemas as s
from app.mappers import mensaje_out
from app.services import motor_rag, derivacion


def procesar_mensaje(db: Session, empresa: m.Empresa, req: s.ChatRequest) -> s.ChatResponse:
    if req.conversation_id:
        try:
            cid = uuid.UUID(req.conversation_id)
        except ValueError:
            raise HTTPException(404, "Conversación no encontrada")
        conv = db.scalar(select(m.Conversacion).where(
            m.Conversacion.id == cid, m.Conversacion.empresa_id == empresa.id))  # <- tenant
        if not conv:
            raise HTTPException(404, "Conversación no encontrada")
    else:
        conv = m.Conversacion(empresa_id=empresa.id, nombre_cliente=req.customer_name,
                              email_cliente=req.customer_email, canal=req.channel)
        db.add(conv)
        db.flush()

    nombre_cliente = conv.nombre_cliente or "Usuario web"
    user_msg = m.Mensaje(empresa_id=empresa.id, conversacion_id=conv.id, rol="usuario",
                         nombre_remitente=nombre_cliente, contenido=req.message)
    db.add(user_msg)
    nuevos = [user_msg]
    ticket = db.scalar(select(m.Ticket).where(m.Ticket.conversacion_id == conv.id))

    if not conv.derivada:  # si ya fue derivada, responde el agente humano (no el bot)
        nombre_bot = empresa.nombre_agente or f"{empresa.nombre} Assistant"
        r = motor_rag.responder(db, empresa, req.message, forzar_derivacion=req.escalate)
        bot_msg = m.Mensaje(empresa_id=empresa.id, conversacion_id=conv.id, rol="bot",
                            nombre_remitente=nombre_bot, contenido=r.respuesta,
                            fuentes=r.fuentes or None, confianza=r.confianza,
                            es_aviso_derivacion=r.derivar)
        db.add(bot_msg)
        nuevos.append(bot_msg)
        if r.derivar:
            sug = motor_rag.sugerir_respuesta(db, empresa, req.message, r.motivo, nombre_cliente)
            ticket = derivacion.crear_ticket(db, empresa, conv, r.motivo, sug)

    db.commit()
    for x in nuevos:
        db.refresh(x)
    return s.ChatResponse(conversation_id=str(conv.id), messages=[mensaje_out(x) for x in nuevos],
                          derived=conv.derivada, ticket_number=ticket.numero if ticket else None)
