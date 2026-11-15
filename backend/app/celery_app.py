"""Celery + Redis (RF-06, RF-22, RF-39). Solo se usa con INGESTA_BACKEND=celery (ver README): por defecto todo corre con BackgroundTasks de FastAPI.

Worker:  celery -A app.celery_app worker -l info          (en Windows agrega: -P solo)
Beat:    celery -A app.celery_app beat -l info            (tareas periódicas: cierre de tickets sin respuesta)
Redis:   docker compose up -d redis                       (solo escucha en 127.0.0.1)
"""
from celery import Celery
from app.config import CELERY_BROKER_URL

celery = Celery("alloxentric", broker=CELERY_BROKER_URL, include=["app.tasks"])
celery.conf.update(
    task_serializer="json", accept_content=["json"], timezone="America/Santiago", enable_utc=True,
    broker_connection_retry_on_startup=True, broker_connection_timeout=2, task_acks_late=True,
    beat_schedule={"cerrar-encuestas-vencidas": {"task": "app.tasks.cerrar_encuestas_vencidas", "schedule": 900.0}},   # cada 15 min (RF-39)
)
