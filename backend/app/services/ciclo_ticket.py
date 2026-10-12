"""Ciclo de vida del ticket y encuesta de resolución (definición de negocio).

    pendiente / urgente ──(el encargado responde: se envía la encuesta)──▶ esperando_cliente
    esperando_cliente ──(cliente: SÍ se resolvió)──────────────▶ cerrado   (final; no se reabre)
    esperando_cliente ──(cliente: NO se resolvió)──────────────▶ escalado  (gestión fuera del chat)
    esperando_cliente ──(sin respuesta en ENCUESTA_HORAS)──────▶ cerrado   (motivo: sin_respuesta)
    esperando_cliente ──(el cliente escribe en vez de contestar)▶ pendiente (vuelve a la cola)
    escalado ──(admin de la empresa / superadmin lo cierra)───▶ cerrado   (motivo: gestion_manual)

Un ticket `cerrado` no cambia más: si el cliente vuelve a escribir, debe iniciar una conversación nueva.
Un ticket `escalado` ya no lo atienden ni el bot ni el encargado de tickets en el chat.
"""
import uuid
from datetime import timedelta
from sqlalchemy import update
from sqlalchemy.orm import Session
from app import models as m
from app.config import ENCUESTA_HORAS
from app.utils import ahora

ABIERTOS = ("pendiente", "urgente")          # en la cola del encargado de tickets
FINALES = ("cerrado", "escalado")            # la conversación ya no admite mensajes del cliente


def cerrar_vencidos(db: Session, empresa_id: uuid.UUID | None = None) -> int:
    """Cierra los tickets cuya encuesta lleva más de ENCUESTA_HORAS sin respuesta.

    No hay planificador (Celery está pendiente), así que se ejecuta al leer tickets, métricas y conversaciones.
    `empresa_id=None` solo para el superadmin (todas las empresas).
    """
    q = update(m.Ticket).where(
        m.Ticket.estado == "esperando_cliente",
        m.Ticket.encuesta_enviada_en < ahora() - timedelta(hours=ENCUESTA_HORAS))
    if empresa_id is not None:
        q = q.where(m.Ticket.empresa_id == empresa_id)          # <- tenant
    res = db.execute(q.values(estado="cerrado", cierre_motivo="sin_respuesta", actualizado_en=ahora()))
    db.commit()
    return res.rowcount or 0


def enviar_encuesta(t: m.Ticket) -> None:
    t.estado = "esperando_cliente"
    t.encuesta_enviada_en = ahora()
    t.cierre_motivo = None


def responder_encuesta(db: Session, empresa: m.Empresa, conv: m.Conversacion, t: m.Ticket, resuelto: bool) -> None:
    """Aplica la respuesta del cliente y deja constancia en la transcripción."""
    cliente = conv.nombre_cliente or "Usuario web"
    bot = empresa.nombre_agente or f"{empresa.nombre} Assistant"
    if resuelto:
        t.estado, t.cierre_motivo = "cerrado", "confirmado_cliente"
        dicho = "Sí, mi consulta quedó resuelta."
        aviso = f"¡Gracias! Cerramos tu caso {t.numero}. Si necesitas algo más, inicia una nueva consulta."
    else:
        t.estado, t.cierre_motivo = "escalado", None
        dicho = "No, mi consulta sigue sin resolverse."
        aviso = (f"Lamentamos que no se haya resuelto. Escalamos tu caso {t.numero} a la gestión de {empresa.nombre}: "
                 f"te contactarán directamente. Ya no se responderá por este chat.")
    db.add(m.Mensaje(empresa_id=empresa.id, conversacion_id=conv.id, rol="usuario",
                     nombre_remitente=cliente, contenido=dicho))
    db.add(m.Mensaje(empresa_id=empresa.id, conversacion_id=conv.id, rol="bot", nombre_remitente=bot,
                     contenido=aviso, es_aviso_derivacion=not resuelto))
    db.commit()
