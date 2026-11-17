"""Preguntas sin respuesta: agrupa lo que el bot no pudo resolver para decir qué documentación falta.

Fuentes (de los últimos N días, siempre de UNA empresa):
  · derivaciones por «confianza RAG bajo el umbral» (no había información)            -> sin_informacion
  · derivaciones porque el modelo contestó NO_SE con los fragmentos recuperados       -> modelo_no_sabe
  · respuestas que el cliente valoró 👎                                               -> baja_valoracion
No cuentan los pedidos de «quiero hablar con una persona» (no son un vacío de la documentación) ni los intentos bloqueados por seguridad.

Las preguntas parecidas se agrupan con los mismos embeddings del RAG (coseno entre preguntas) y, para cada grupo, se busca el documento
que más se acerca para recomendar si hay que ampliar uno o subir uno nuevo.
"""
import math
from collections import Counter, defaultdict
from datetime import timedelta
from sqlalchemy import select, or_
from sqlalchemy.orm import Session
from app import models as m
from app.services import embeddings, motor_rag
from app.utils import ahora

UMBRAL_AGRUPAR = 0.62      # confianza (0..1 del embedder activo) entre dos preguntas para considerarlas el mismo tema
MAX_FILAS = 600
MAX_GRUPOS = 25


def _coseno(a: list[float], b: list[float]) -> float:
    na, nb = math.sqrt(sum(x * x for x in a)) or 1.0, math.sqrt(sum(x * x for x in b)) or 1.0
    return sum(x * y for x, y in zip(a, b)) / (na * nb)


def _motivo(texto: str | None) -> str | None:
    t = (texto or "")
    if "solicitó atención humana" in t:
        return None
    if "no encontró la respuesta" in t:
        return "modelo_no_sabe"
    return "sin_informacion"


def _preguntas(db: Session, empresa: m.Empresa, dias: int) -> list[dict]:
    M, T = m.Mensaje, m.Ticket
    desde = ahora() - timedelta(days=dias)
    bots = db.execute(
        select(M.id, M.conversacion_id, M.creado_en, M.es_aviso_derivacion, M.valoracion, T.motivo_derivacion)
        .outerjoin(T, (T.conversacion_id == M.conversacion_id) & (T.empresa_id == empresa.id))
        .where(M.empresa_id == empresa.id, M.rol == "bot", M.creado_en >= desde,                       # <- tenant
               or_(M.es_aviso_derivacion.is_(True), M.valoracion == "abajo"))
        .order_by(M.creado_en.desc()).limit(MAX_FILAS)).all()
    if not bots:
        return []
    conv_ids = {b.conversacion_id for b in bots}
    usuario: dict = defaultdict(list)
    for x in db.scalars(select(M).where(M.empresa_id == empresa.id, M.rol == "usuario", M.conversacion_id.in_(conv_ids)).order_by(M.creado_en)):
        usuario[x.conversacion_id].append(x)
    out = []
    for b in bots:
        previas = [u for u in usuario.get(b.conversacion_id, []) if u.creado_en <= b.creado_en]
        if not previas:
            continue
        q = previas[-1]
        motivo = _motivo(b.motivo_derivacion) if b.es_aviso_derivacion else "baja_valoracion"
        if motivo is None:
            continue
        out.append({"texto": " ".join(q.contenido.split()), "en": b.creado_en, "conv": str(b.conversacion_id), "motivo": motivo})
    return out


def reporte(db: Session, empresa: m.Empresa, dias: int = 30) -> dict:
    filas = _preguntas(db, empresa, dias)
    if not filas:
        return {"days": dias, "total": 0, "groups": []}
    emb = embeddings.get_embedder()
    vecs = emb.embed([f["texto"][:500] for f in filas])
    grupos: list[dict] = []
    for f, v in zip(filas, vecs):                               # las filas vienen de la más reciente a la más antigua
        for g in grupos:
            if motor_rag.confianza_de(_coseno(v, g["vec"]), emb) >= UMBRAL_AGRUPAR:
                g["items"].append(f)
                break
        else:
            grupos.append({"vec": v, "items": [f]})
    grupos.sort(key=lambda g: (-len(g["items"]), -g["items"][0]["en"].timestamp()))
    out = []
    for g in grupos[:MAX_GRUPOS]:
        items = g["items"]
        tema = items[0]["texto"][:200]
        mejor = motor_rag.buscar(db, empresa, tema, k=1)
        cerca = mejor[0] if mejor else None
        motivo = Counter(i["motivo"] for i in items).most_common(1)[0][0]
        if motivo == "baja_valoracion":
            sugerencia = "Los clientes valoraron mal la respuesta: revisa que el documento citado sea claro y esté actualizado."
        elif cerca and cerca.confianza >= 0.5:
            sugerencia = f"La documentación se acerca en «{cerca.documento}» pero no responde esta pregunta: amplía ese documento con este tema."
        else:
            sugerencia = "No hay documentación sobre este tema: sube un documento o una FAQ que lo explique."
        out.append({"topic": tema, "count": len(items), "last_at": items[0]["en"].isoformat(), "reason": motivo,
                    "closest_document": cerca.documento if cerca else None,
                    "closest_confidence": cerca.confianza if cerca else None, "suggestion": sugerencia,
                    "questions": [{"question": i["texto"][:300], "at": i["en"].isoformat(), "conversation_id": i["conv"]} for i in items[:5]]})
    return {"days": dias, "total": len(filas), "groups": out}
