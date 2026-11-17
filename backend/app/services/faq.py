"""Propuestas de FAQ: lo que respondió un agente humano en un ticket, ofrecido como pregunta frecuente para la base de conocimiento.

Así lo que hoy resuelve una persona mañana lo resuelve el bot. Una persona SIEMPRE revisa y edita antes de aceptar (puede traer nombres,
datos del caso o promesas que no deben quedar en la documentación). Los textos se enmascaran (RUT, correos, teléfonos…) al crear la
propuesta. Todo va por empresa: solo se proponen tickets de la empresa y el documento creado es de esa empresa.
"""
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from sqlalchemy import select
from sqlalchemy.orm import Session
from app import models as m
from app.config import STORAGE_DIR
from app.services import seguridad

MIN_RESPUESTA = 40


def _limpio(t: str, n: int) -> str:
    return " ".join(seguridad.enmascarar(t)[0].split())[:n]


def generar(db: Session, empresa: m.Empresa, limite: int = 100) -> int:
    """Crea propuestas para los tickets de la empresa que ya tienen respuesta de un agente y aún no tienen propuesta. Devuelve cuántas creó."""
    con = select(m.PropuestaFaq.ticket_id).where(m.PropuestaFaq.empresa_id == empresa.id)
    tickets = db.scalars(select(m.Ticket).where(m.Ticket.empresa_id == empresa.id, m.Ticket.id.not_in(con))      # <- tenant
                         .order_by(m.Ticket.creado_en.desc()).limit(limite)).all()
    n = 0
    for t in tickets:
        msgs = [x for x in t.conversacion.mensajes if x.empresa_id == empresa.id]
        pregunta = next((x.contenido for x in msgs if x.rol == "usuario"), "")
        respuestas = [x.contenido for x in msgs if x.rol == "agente" and len(x.contenido.strip()) >= MIN_RESPUESTA]
        if not pregunta or not respuestas:
            continue
        resp = respuestas[-1]
        if seguridad.hay_inyeccion(pregunta) or seguridad.hay_inyeccion(resp):
            continue
        db.add(m.PropuestaFaq(empresa_id=empresa.id, ticket_id=t.id, pregunta=_limpio(pregunta, 500), respuesta=_limpio(resp, 1500)))
        n += 1
    if n:
        db.flush()
    return n


def crear_documento(db: Session, empresa: m.Empresa, pregunta: str, respuesta: str) -> m.Documento:
    """Guarda la pregunta y la respuesta como un documento FAQ de la empresa (`estado=procesando`; la ingesta corre aparte)."""
    pregunta, respuesta = _limpio(pregunta, 500), _limpio(respuesta, 2000)
    carpeta = STORAGE_DIR / str(empresa.id)                       # una carpeta por empresa
    carpeta.mkdir(parents=True, exist_ok=True)
    nombre = "faq_" + (re.sub(r"[^a-z0-9]+", "_", pregunta.lower())[:40].strip("_") or "pregunta") + ".faq"
    ruta = carpeta / f"{uuid.uuid4().hex[:8]}_{nombre}"
    contenido = f"Pregunta: {pregunta}\n\nRespuesta: {respuesta}\n"
    ruta.write_text(contenido, encoding="utf-8")
    d = m.Documento(empresa_id=empresa.id, nombre=nombre, tipo="faq", tamano_bytes=len(contenido.encode()), ruta_local=str(ruta), estado="procesando")
    db.add(d)
    db.flush()
    return d


def resolver(p: m.PropuestaFaq, estado: str, documento: m.Documento | None = None) -> None:
    p.estado = estado
    p.documento_id = documento.id if documento else None
    p.resuelta_en = datetime.now(timezone.utc)
