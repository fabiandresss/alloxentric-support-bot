"""Derivación a Corestream (RF-12/RF-13). Con CORESTREAM_MOCK=true se crea el ticket solo en la BD local."""
from fastapi import HTTPException
from sqlalchemy import select, func, cast, Integer
from sqlalchemy.orm import Session
from app import models as m
from app.config import CORESTREAM_MOCK


def _siguiente_numero(db: Session) -> str:
    ultimo = db.scalar(select(func.max(cast(func.substr(m.Ticket.numero, 5), Integer))))
    return f"COR-{(ultimo or 8900) + 1}"


def crear_ticket(db: Session, empresa: m.Empresa, conv: m.Conversacion, motivo: str,
                 sugerencia: dict) -> m.Ticket:
    if not CORESTREAM_MOCK:
        # TODO (Fabián): httpx.post a la API real de Corestream y usar el número que devuelva.
        raise HTTPException(501, "Integración real con Corestream pendiente; use CORESTREAM_MOCK=true")
    t = m.Ticket(empresa_id=empresa.id, conversacion_id=conv.id, numero=_siguiente_numero(db),
                 estado="pendiente", motivo_derivacion=motivo, sugerencia_ia=sugerencia)
    db.add(t)
    conv.derivada = True
    db.flush()
    return t
