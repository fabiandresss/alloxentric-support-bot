"""Avisos dentro de la plataforma (campana) y, si hay SMTP configurado, por correo a los admins de la empresa.

`clave` evita repetir un aviso (p. ej. «gasto-2026-11-80»): el mismo aviso no se crea dos veces para la misma empresa.
El correo es opcional y nunca rompe la operación: si falla, se registra en el log y se sigue.
"""
import logging
import smtplib
from email.message import EmailMessage
from sqlalchemy import select
from sqlalchemy.orm import Session
from app import models as m
from app.config import SMTP_FROM, SMTP_HOST, SMTP_PASSWORD, SMTP_PORT, SMTP_STARTTLS, SMTP_USER

log = logging.getLogger("notificaciones")
TIPOS_DE_GASTO = ("gasto_80", "gasto_100", "gasto_dia")      # solo los ven superadmin y admin de la empresa


def correo_configurado() -> bool:
    return bool(SMTP_HOST)


def enviar_correo(destinatarios: list[str], asunto: str, cuerpo: str) -> bool:
    """Envío best-effort por SMTP. Devuelve False (sin lanzar) si no hay SMTP o falla."""
    if not SMTP_HOST or not destinatarios:
        return False
    try:
        msg = EmailMessage()
        msg["From"], msg["To"], msg["Subject"] = SMTP_FROM, ", ".join(destinatarios), asunto
        msg.set_content(cuerpo)
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as s:
            if SMTP_STARTTLS:
                s.starttls()
            if SMTP_USER:
                s.login(SMTP_USER, SMTP_PASSWORD)
            s.send_message(msg)
        return True
    except Exception as exc:   # noqa: BLE001 — un correo caído no debe frenar el chat ni las pruebas
        log.warning("no se pudo enviar el correo (%s)", exc.__class__.__name__)
        return False


def correos_admins(db: Session, empresa_id) -> list[str]:
    return list(db.scalars(select(m.Usuario.email).where(m.Usuario.empresa_id == empresa_id, m.Usuario.rol == "admin_empresa", m.Usuario.activo.is_(True))))


def notificar(db: Session, empresa_id, tipo: str, titulo: str, mensaje: str, vista: str | None = None, ref: str | None = None,
              clave: str | None = None, correo: bool = False) -> m.Notificacion | None:
    """Crea el aviso si no existe uno con la misma clave. Devuelve None si ya estaba. No hace commit."""
    clave = clave or f"{tipo}-{ref or ''}"
    if db.scalar(select(m.Notificacion.id).where(m.Notificacion.empresa_id == empresa_id, m.Notificacion.clave == clave)):
        return None
    n = m.Notificacion(empresa_id=empresa_id, tipo=tipo, titulo=titulo, mensaje=mensaje, vista=vista, ref=ref, clave=clave)
    db.add(n)
    db.flush()
    if correo:
        enviar_correo(correos_admins(db, empresa_id), f"alloxentric · {titulo}", f"{mensaje}\n\nRevísalo en la plataforma.")
    return n
