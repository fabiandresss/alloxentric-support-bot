"""Tareas de Celery. Cada una abre su propia sesión de BD (corren en el worker, no en la API)."""
import uuid
from app.celery_app import celery
from app.db import SessionLocal
from app.services import ciclo_ticket, ingesta


@celery.task(name="app.tasks.procesar_documento", bind=True, max_retries=2, default_retry_delay=5)
def procesar_documento(self, documento_id: str, motivo: str = "subir") -> None:
    """Extrae, fragmenta y vectoriza un documento (RF-06) y corre los golden sets automáticos de la empresa."""
    ingesta.procesar_documento(uuid.UUID(documento_id), motivo)


@celery.task(name="app.tasks.cerrar_encuestas_vencidas")
def cerrar_encuestas_vencidas() -> int:
    """Cierra los tickets cuya encuesta lleva más de ENCUESTA_HORAS sin respuesta, de todas las empresas (RF-39)."""
    with SessionLocal() as db:
        return ciclo_ticket.cerrar_vencidos(db, None)
