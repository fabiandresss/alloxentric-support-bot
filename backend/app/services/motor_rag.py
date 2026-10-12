"""MOTOR RAG — IMPLEMENTACIÓN PROVISORIA (stub).

Responsable del reemplazo: Vicente (actividad "Implementación del motor RAG").
Contrato que NO debe cambiar (lo usa services/chat.py):

    responder(db, empresa, texto, forzar_derivacion) -> Resultado
    sugerir_respuesta(db, empresa, texto, motivo, nombre_cliente) -> dict

Hoy: búsqueda por palabras clave sobre los fragmentos de la empresa (sin embeddings
ni LLM). Mañana: embeddings (sentence-transformers) + búsqueda pgvector + DeepSeek.
REGLA MULTI-TENANT: toda consulta a fragmentos filtra por empresa_id.
"""
import re
import unicodedata
from dataclasses import dataclass, field
from sqlalchemy import select
from sqlalchemy.orm import Session
from app import models as m

PALABRAS_DERIVACION = ("humano", "agente", "persona real", "urgente", "reclamo", "supervisor")


@dataclass
class Resultado:
    respuesta: str
    confianza: float
    fuentes: list[str] = field(default_factory=list)
    derivar: bool = False
    motivo: str = ""


def _tokens(texto: str) -> set[str]:
    t = unicodedata.normalize("NFD", texto.lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return {w for w in re.findall(r"[a-z0-9]+", t) if len(w) > 3}


def _mejor_fragmento(db: Session, empresa: m.Empresa, texto: str):
    q = _tokens(texto)
    if not q:
        return None, 0.0
    filas = db.execute(
        select(m.FragmentoEmbedding.texto, m.Documento.nombre)
        .join(m.Documento, m.Documento.id == m.FragmentoEmbedding.documento_id)
        .where(m.FragmentoEmbedding.empresa_id == empresa.id)  # <- aislamiento por tenant
        .limit(2000)).all()
    mejor, score = None, 0.0
    for txt, doc in filas:
        sc = len(q & _tokens(txt)) / len(q)
        if sc > score:
            mejor, score = (txt, doc), sc
    return mejor, score


def responder(db: Session, empresa: m.Empresa, texto: str, forzar_derivacion: bool = False) -> Resultado:
    pidio_humano = forzar_derivacion or any(p in texto.lower() for p in PALABRAS_DERIVACION)
    mejor, score = _mejor_fragmento(db, empresa, texto)
    confianza = round(min(0.95, 0.35 + score * 0.9), 2) if mejor else 0.2
    if pidio_humano:
        return Resultado("Entiendo. Te voy a derivar con un agente humano de soporte.", confianza,
                         [mejor[1]] if mejor else [], True, "El usuario solicitó atención humana.")
    if not mejor or confianza < empresa.umbral_rag:
        return Resultado("No encontré información suficiente en la base de conocimiento para "
                         "resolver tu consulta. Te voy a derivar con un agente humano.", confianza,
                         [mejor[1]] if mejor else [], True,
                         f"Confianza RAG ({confianza:.2f}) bajo el umbral ({empresa.umbral_rag:.2f}).")
    extracto = mejor[0].strip()
    extracto = extracto[:600] + ("…" if len(extracto) > 600 else "")
    return Resultado(f"Según la documentación de {empresa.nombre}: {extracto}", confianza, [mejor[1]])


def sugerir_respuesta(db: Session, empresa: m.Empresa, texto: str, motivo: str,
                      nombre_cliente: str) -> dict:
    mejor, score = _mejor_fragmento(db, empresa, texto)
    return {
        "confidence": round(min(0.95, 0.35 + score * 0.9), 2) if mejor else 0.0,
        "sourceDoc": mejor[1] if mejor else "",
        "summary": motivo,
        "draftResponse": f"Hola {nombre_cliente}, soy parte del equipo de soporte de {empresa.nombre}. "
                         f"Estamos revisando tu caso y te responderemos a la brevedad. "
                         f"(Borrador provisorio: lo generará DeepSeek cuando el motor RAG esté integrado.)",
    }
