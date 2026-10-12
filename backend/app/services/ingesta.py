"""Ingesta de documentos: extracción de texto + chunking + embeddings (RF-04, RF-05).

Cada fragmento se guarda con su vector (services/embeddings.py) y el id del embedder que lo generó.
"""
import re
from pathlib import Path
from app import models as m
from app.db import SessionLocal
from app.services import embeddings


def extraer_texto(ruta: Path, tipo: str) -> str:
    if tipo == "pdf":
        from pypdf import PdfReader
        return "\n\n".join((p.extract_text() or "") for p in PdfReader(str(ruta)).pages)
    if tipo == "docx":
        from docx import Document
        return "\n\n".join(p.text for p in Document(str(ruta)).paragraphs)
    return ruta.read_text(encoding="utf-8", errors="replace")


def _por_oraciones(parrafo: str, max_chars: int) -> list[str]:
    """Corta un párrafo largo en oraciones sin pasar de max_chars (una oración gigante se corta en seco)."""
    out, actual = [], ""
    for o in re.split(r"(?<=[.!?])\s+", parrafo):
        while len(o) > max_chars:
            if actual:
                out.append(actual); actual = ""
            out.append(o[:max_chars]); o = o[max_chars:]
        if len(actual) + len(o) + 1 <= max_chars:
            actual = f"{actual} {o}".strip()
        else:
            out.append(actual); actual = o
    if actual:
        out.append(actual)
    return out


def dividir(texto: str, max_chars: int = 700, min_chars: int = 120) -> list[str]:
    """Un fragmento por párrafo: cada tema queda en su propio vector y la búsqueda es precisa (juntar párrafos diluye la
    similitud). Los párrafos muy cortos (títulos, viñetas sueltas) se unen al siguiente hasta `min_chars`; los de más
    de `max_chars` se cortan por oraciones."""
    parrafos = [p.strip() for p in re.split(r"\n\s*\n", texto) if p.strip()]
    chunks, buffer = [], ""
    for p in parrafos:
        if buffer and len(buffer) < min_chars and len(buffer) + len(p) + 2 <= max_chars:
            p = f"{buffer}\n\n{p}"          # el título / fragmento corto acompaña al siguiente párrafo
        elif buffer:
            chunks.append(buffer)
        if len(p) > max_chars:
            partes = _por_oraciones(p, max_chars)
            chunks.extend(partes[:-1])
            buffer = partes[-1]
        else:
            buffer = p
    if buffer:
        chunks.append(buffer)
    return chunks


def generar_embeddings(textos: list[str]) -> tuple[list[list[float]], str]:
    """(vectores, id del embedder). Procesa por lotes para no cargar de golpe documentos grandes."""
    emb = embeddings.get_embedder()
    out: list[list[float]] = []
    for i in range(0, len(textos), 64):
        out.extend(emb.embed(textos[i:i + 64]))
    return out, emb.id


def procesar_documento(documento_id) -> None:
    """Corre en segundo plano (BackgroundTasks; luego Celery, RF-06)."""
    db = SessionLocal()
    try:
        doc = db.get(m.Documento, documento_id)
        if not doc:
            return
        try:
            chunks = dividir(extraer_texto(Path(doc.ruta_local), doc.tipo))
            if not chunks:
                raise ValueError("el documento no tiene texto")
            embs, modelo = generar_embeddings(chunks)
            for i, (t, e) in enumerate(zip(chunks, embs)):
                db.add(m.FragmentoEmbedding(empresa_id=doc.empresa_id, documento_id=doc.id,
                                            orden=i, texto=t, embedding=e, modelo=modelo))
            doc.num_fragmentos = len(chunks)
            doc.estado = "procesado"
        except Exception:
            db.rollback()
            doc = db.get(m.Documento, documento_id)
            doc.estado = "error"
        db.commit()
    finally:
        db.close()
