"""Ingesta de documentos: extracción de texto + chunking.

PENDIENTE (Vicente): generar_embeddings() con sentence-transformers y guardarlos en
FragmentoEmbedding.embedding. Mientras tanto los fragmentos se guardan sin embedding
(el motor provisorio busca por palabras clave).
"""
import re
from pathlib import Path
from app import models as m
from app.db import SessionLocal


def extraer_texto(ruta: Path, tipo: str) -> str:
    if tipo == "pdf":
        from pypdf import PdfReader
        return "\n\n".join((p.extract_text() or "") for p in PdfReader(str(ruta)).pages)
    if tipo == "docx":
        from docx import Document
        return "\n\n".join(p.text for p in Document(str(ruta)).paragraphs)
    return ruta.read_text(encoding="utf-8", errors="replace")


def dividir(texto: str, max_chars: int = 800) -> list[str]:
    parrafos = [p.strip() for p in re.split(r"\n\s*\n", texto) if p.strip()]
    chunks, actual = [], ""
    for p in parrafos:
        while len(p) > max_chars:  # párrafo gigante: cortar
            chunks.append(p[:max_chars]); p = p[max_chars:]
        if len(actual) + len(p) + 2 <= max_chars:
            actual = f"{actual}\n\n{p}".strip()
        else:
            if actual:
                chunks.append(actual)
            actual = p
    if actual:
        chunks.append(actual)
    return chunks


def generar_embeddings(textos: list[str]):
    """TODO (Vicente): return model.encode(textos).tolist()"""
    return [None] * len(textos)


def procesar_documento(documento_id) -> None:
    """Corre en segundo plano (BackgroundTasks; luego Celery, RF-06)."""
    db = SessionLocal()
    try:
        doc = db.get(m.Documento, documento_id)
        if not doc:
            return
        try:
            chunks = dividir(extraer_texto(Path(doc.ruta_local), doc.tipo))
            embs = generar_embeddings(chunks)
            for i, (t, e) in enumerate(zip(chunks, embs)):
                db.add(m.FragmentoEmbedding(empresa_id=doc.empresa_id, documento_id=doc.id,
                                            orden=i, texto=t, embedding=e))
            doc.num_fragmentos = len(chunks)
            doc.estado = "procesado"
        except Exception:
            db.rollback()
            doc = db.get(m.Documento, documento_id)
            doc.estado = "error"
        db.commit()
    finally:
        db.close()
