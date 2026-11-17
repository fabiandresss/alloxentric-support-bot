import uuid
from fastapi import HTTPException
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from app import models as m, schemas as s
from app.mappers import mensaje_out
from app.services import motor_rag, derivacion, finops, llm, seguridad, horario, resumen


def procesar_mensaje(db: Session, empresa: m.Empresa, req: s.ChatRequest, publico: bool = True) -> s.ChatResponse:
    """`publico` = lo que se devuelve lo ve el cliente (se aplica la política de fuentes de la empresa); el simulador del panel pasa False."""
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
        conv = m.Conversacion(empresa_id=empresa.id, nombre_cliente=seguridad.nombre_seguro(req.customer_name) or None,
                              email_cliente=req.customer_email, canal=req.channel)
        db.add(conv)
        db.flush()

    total = db.scalar(select(func.count()).select_from(m.Mensaje).where(
        m.Mensaje.conversacion_id == conv.id, m.Mensaje.empresa_id == empresa.id)) or 0
    if total >= seguridad.MAX_MENSAJES_CONVERSACION:
        seguridad.registrar(db, empresa, "limite_conversacion", f"{total} mensajes", conv_id=conv.id)
        db.commit()
        raise HTTPException(429, "Esta conversación alcanzó el máximo de mensajes. Inicia una nueva consulta.")

    previos = db.scalars(select(m.Mensaje).where(m.Mensaje.conversacion_id == conv.id, m.Mensaje.empresa_id == empresa.id)
                         .order_by(m.Mensaje.creado_en.desc()).limit(6)).all()[::-1]
    historial = [(x.rol, x.contenido) for x in previos]          # los últimos turnos, para entender «¿y si…?»

    ticket = db.scalar(select(m.Ticket).where(m.Ticket.conversacion_id == conv.id))
    if ticket and ticket.estado == "cerrado":
        raise HTTPException(409, "Esta conversación ya fue cerrada. Inicia una nueva consulta.")
    if ticket and ticket.estado == "escalado":
        raise HTTPException(409, "Tu caso fue escalado a gestión y ya no se responde por este chat.")

    nombre_cliente = conv.nombre_cliente or "Usuario web"
    entrada = seguridad.analizar_entrada(empresa, req.message)    # lo que se guarda y se envía al modelo ya va limpio y sin datos personales
    with seguridad.en_conversacion(conv.id):
        if entrada.pii:
            seguridad.registrar(db, empresa, "pii", "Datos enmascarados: " + ", ".join(entrada.pii))
        user_msg = m.Mensaje(empresa_id=empresa.id, conversacion_id=conv.id, rol="usuario",
                             nombre_remitente=nombre_cliente, contenido=entrada.texto)
        db.add(user_msg)
        nuevos = [user_msg]
        if ticket and ticket.estado == "esperando_cliente":
            # escribió en vez de contestar la encuesta: vuelve a la cola del encargado
            ticket.estado, ticket.encuesta_enviada_en = "pendiente", None

        if not conv.derivada:  # si ya fue derivada, responde el agente humano (no el bot)
            nombre_bot = empresa.nombre_agente or f"{empresa.nombre} Assistant"
            with llm.capturando() as usos:   # tokens de cada llamada al modelo -> panel FinOps
                r = motor_rag.responder(db, empresa, entrada.texto, forzar_derivacion=req.escalate, historial=historial)
                sug = motor_rag.sugerir_respuesta(db, empresa, entrada.texto, r.motivo, nombre_cliente) if r.derivar else None
            finops.registrar(db, empresa, conv, usos)
            contenido = r.respuesta
            fuera = r.derivar and not horario.abierto(empresa)
            if fuera:   # fuera de horario: el ticket se crea igual y se le avisa al cliente cuándo lo atienden
                contenido += "\n\n" + horario.config_de(empresa)["mensajeFuera"]
            bot_msg = m.Mensaje(empresa_id=empresa.id, conversacion_id=conv.id, rol="bot",
                                nombre_remitente=nombre_bot, contenido=contenido,
                                fuentes=r.fuentes or None, fuentes_detalle=r.fuentes_detalle or None, confianza=r.confianza,
                                es_aviso_derivacion=r.derivar)
            db.add(bot_msg)
            nuevos.append(bot_msg)
            if r.derivar:
                ticket = derivacion.crear_ticket(db, empresa, conv, r.motivo, sug)
                db.flush()
                db.refresh(conv)
                with llm.capturando() as usos_res:
                    ticket.resumen_ia = resumen.generar(db, empresa, conv, r.motivo)
                finops.registrar(db, empresa, conv, usos_res)

    db.commit()
    for x in nuevos:
        db.refresh(x)
    return s.ChatResponse(conversation_id=str(conv.id), messages=[mensaje_out(x, empresa if publico else None) for x in nuevos],
                          derived=conv.derivada, ticket_number=ticket.numero if ticket else None)
