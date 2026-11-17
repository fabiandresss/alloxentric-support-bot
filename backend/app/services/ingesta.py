"""Ingesta de documentos: extracción de texto + chunking + embeddings (RF-04, RF-05).

Cada fragmento se guarda con su vector (services/embeddings.py) y el id del embedder que lo generó.
"""
import re
from pathlib import Path
from app import models as m
from app.db import SessionLocal
from app.services import embeddings, ocr, seguridad


def extraer_paginas(ruta: Path, tipo: str) -> list[tuple[int | None, str]]:
    """[(página, texto)]: un PDF devuelve una entrada por página (para citarla); los demás formatos, una sola entrada sin página."""
    if tipo == "pdf":
        from pypdf import PdfReader
        return [(i, (p.extract_text() or "")) for i, p in enumerate(PdfReader(str(ruta)).pages, 1)]
    if tipo == "docx":
        from docx import Document
        return [(None, "\n\n".join(p.text for p in Document(str(ruta)).paragraphs))]
    return [(None, ruta.read_text(encoding="utf-8", errors="replace"))]


def extraer_texto(ruta: Path, tipo: str) -> str:
    return "\n\n".join(t for _, t in extraer_paginas(ruta, tipo))


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


def _revisar_contenido(db, doc: m.Documento, chunks: list[str]) -> str | None:
    """Inyección indirecta: ¿el documento trae órdenes dirigidas al modelo («ignora tus instrucciones y…»)? Se avisa al subirlo; esos fragmentos
    además se descartan al responder (motor_rag._sin_instrucciones_ocultas). No bloquea la ingesta: un manual de seguridad puede hablar del tema."""
    sospechosos = [c for c in chunks if seguridad.fragmento_sospechoso(c)[0]]
    if not sospechosos:
        return None
    empresa = db.get(m.Empresa, doc.empresa_id)
    seguridad.registrar(db, empresa, "documento_sospechoso", f"{doc.nombre}: {sospechosos[0]}", [f"{len(sospechosos)} fragmento(s)"])
    return f"{len(sospechosos)} fragmento(s) con posibles órdenes ocultas dirigidas al modelo: revísalos"[:200]


def procesar_documento(documento_id, motivo: str = "subir") -> None:
    """Corre en segundo plano (BackgroundTasks, o Celery con INGESTA_BACKEND=celery; RF-06). Al terminar corre los golden sets automáticos."""
    db = SessionLocal()
    try:
        doc = db.get(m.Documento, documento_id)
        if not doc:
            return
        try:
            paginas = extraer_paginas(Path(doc.ruta_local), doc.tipo)
            if doc.tipo == "pdf" and not any(t.strip() for _, t in paginas):
                # PDF escaneado: sin texto seleccionable. Se transcribe con visión de Bedrock si está disponible (cuesta tokens)
                paginas = ocr.transcribir_pdf(db, db.get(m.Empresa, doc.empresa_id), Path(doc.ruta_local))
            items = [(pg, c) for pg, texto in paginas for c in dividir(texto)]     # cada fragmento conserva su página
            if not items:
                raise ValueError("el documento no tiene texto")
            embs, modelo = generar_embeddings([c for _, c in items])
            for i, ((pg, c), e) in enumerate(zip(items, embs)):
                db.add(m.FragmentoEmbedding(empresa_id=doc.empresa_id, documento_id=doc.id,
                                            orden=i, pagina=pg, texto=c, embedding=e, modelo=modelo))
            doc.num_fragmentos = len(items)
            doc.estado = "procesado"
            doc.advertencia = _revisar_contenido(db, doc, [c for _, c in items])
        except Exception:
            db.rollback()
            doc = db.get(m.Documento, documento_id)
            doc.estado = "error"
        db.commit()
        empresa_id, nombre = doc.empresa_id, doc.nombre
    finally:
        db.close()
    from app.services import evaluacion      # al final y sin importar arriba: evaluacion usa el motor RAG, que usa embeddings
    evaluacion.disparar_automaticas(empresa_id, f"{motivo} «{nombre}»")
