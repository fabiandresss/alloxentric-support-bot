"""Caché semántica de respuestas: si llega una pregunta casi idéntica a otra ya respondida y NADA cambió, se reutiliza la respuesta sin llamar
al modelo (ahorra costo y latencia).

Reglas para que no se sirva algo viejo o equivocado:
  · solo preguntas independientes (sin depender de la conversación) y sin datos personales;
  · solo respuestas que dio el modelo con fragmentos de la documentación (no derivaciones ni bloqueos);
  · misma empresa y mismo modelo; la `version` incluye la configuración del agente y el estado de la base de conocimiento: al subir, reemplazar
    o borrar un documento, o cambiar el tono/instrucciones/umbral, las respuestas guardadas dejan de valer;
  · vencen a los 7 días y hay un máximo por empresa.
"""
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime, timedelta, timezone
from sqlalchemy import select, func, delete
from sqlalchemy.orm import Session
from app import models as m
from app.config import CACHE_RESPUESTAS, CACHE_SIM_MIN, RAG_SEARCH

VIGENCIA = timedelta(days=7)
MAX_POR_EMPRESA = 400


_apagada: ContextVar[bool] = ContextVar("cache_apagada", default=False)


def habilitada() -> bool:
    return CACHE_RESPUESTAS and not _apagada.get()


@contextmanager
def sin_cache():
    """Dentro del bloque no se lee ni se escribe la caché (las pruebas del agente deben llamar de verdad al modelo)."""
    token = _apagada.set(True)
    try:
        yield
    finally:
        _apagada.reset(token)


def version(db: Session, empresa: m.Empresa) -> str:
    """Huella de lo que condiciona una respuesta: configuración del agente + documentos (cantidad, última subida y versiones)."""
    D = m.Documento
    n, ult, vers = db.execute(select(func.count(), func.max(D.subido_en), func.coalesce(func.sum(D.version), 0))
                              .where(D.empresa_id == empresa.id, D.estado == "procesado")).one()
    return f"{empresa.version}|{n}|{vers}|{ult.timestamp() if ult else 0:.0f}"[:80]


def buscar(db: Session, empresa: m.Empresa, modelo_id: str, vec: list[float], ver: str) -> m.CacheRespuesta | None:
    """La respuesta guardada para una pregunta con coseno >= CACHE_SIM_MIN, vigente y de la misma versión/modelo; None si no hay."""
    C = m.CacheRespuesta
    desde = datetime.now(timezone.utc) - VIGENCIA
    donde = (C.empresa_id == empresa.id, C.modelo == modelo_id, C.version == ver, C.creada_en >= desde)        # <- tenant
    if RAG_SEARCH == "python":
        mejor, mejor_sim = None, 0.0
        nq = sum(x * x for x in vec) ** 0.5 or 1.0
        for fila in db.scalars(select(C).where(*donde).limit(MAX_POR_EMPRESA)):
            v = [float(x) for x in fila.embedding]
            nv = sum(x * x for x in v) ** 0.5
            sim = sum(a * b for a, b in zip(v, vec)) / (nv * nq) if nv else 0.0
            if sim > mejor_sim:
                mejor, mejor_sim = fila, sim
        hit = mejor if mejor_sim >= CACHE_SIM_MIN else None
    else:
        dist = C.embedding.cosine_distance(vec).label("dist")
        fila = db.execute(select(C, dist).where(*donde).order_by(dist).limit(1)).first()
        hit = fila[0] if fila and 1.0 - float(fila[1]) >= CACHE_SIM_MIN else None
    if hit:
        hit.aciertos += 1
    return hit


def guardar(db: Session, empresa: m.Empresa, modelo_id: str, ver: str, pregunta: str, vec: list[float], respuesta: str,
            fuentes: list[str], detalle: list[dict], confianza: float) -> None:
    C = m.CacheRespuesta
    db.add(C(empresa_id=empresa.id, modelo=modelo_id, version=ver, pregunta=pregunta[:500], embedding=vec, respuesta=respuesta,
             fuentes=fuentes or None, fuentes_detalle=detalle or None, confianza=confianza))
    db.flush()
    # tope por empresa: se borran las más antiguas
    total = db.scalar(select(func.count()).select_from(C).where(C.empresa_id == empresa.id)) or 0
    if total > MAX_POR_EMPRESA:
        viejas = db.scalars(select(C.id).where(C.empresa_id == empresa.id).order_by(C.creada_en).limit(total - MAX_POR_EMPRESA)).all()
        db.execute(delete(C).where(C.id.in_(viejas), C.empresa_id == empresa.id))


def estadisticas(db: Session, empresa_id) -> tuple[int, int]:
    """(respuestas guardadas, veces que se reutilizaron)."""
    C = m.CacheRespuesta
    n, a = db.execute(select(func.count(), func.coalesce(func.sum(C.aciertos), 0)).where(C.empresa_id == empresa_id)).one()
    return int(n), int(a)
