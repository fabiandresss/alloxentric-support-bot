"""OCR de PDFs escaneados (páginas que son imágenes, sin texto seleccionable).

Se renderiza cada página a imagen (pypdfium2, local) y se transcribe con un modelo de visión de AWS Bedrock (el mismo servicio externo de siempre:
regla 6 del CLAUDE.md). Cuesta tokens: se registra en FinOps como tipo `ocr`, respeta el límite de gasto de la empresa y procesa como máximo
OCR_MAX_PAGINAS páginas. Se apaga con OCR_HABILITADO=false (el PDF sin texto queda «sin texto», como antes).
"""
import io
import logging
from pathlib import Path
from sqlalchemy.orm import Session
from app import models as m
from app.config import OCR_HABILITADO, OCR_MAX_PAGINAS
from app.services import finops, llm, modelos

log = logging.getLogger("rag.ocr")
INSTRUCCION = ("Transcribe fielmente TODO el texto de esta página, en el orden de lectura, respetando párrafos y listas. Si hay tablas, "
               "escribe cada fila en una línea con las celdas separadas por «|». No agregues comentarios, títulos ni explicaciones: solo el "
               "texto de la página. Si la página no tiene texto, responde con una línea vacía.")
MODELO_OCR = "haiku-5-5"      # el del catálogo con visión y mejor lectura de texto


def disponible() -> bool:
    return OCR_HABILITADO and llm.disponible()


def paginas_png(ruta: Path, max_paginas: int) -> list[bytes]:
    import pypdfium2 as pdfium
    pdf = pdfium.PdfDocument(str(ruta))
    out = []
    for i in range(min(len(pdf), max_paginas)):
        buf = io.BytesIO()
        pdf[i].render(scale=1.6).to_pil().convert("RGB").save(buf, "PNG", optimize=True)
        out.append(buf.getvalue())
    return out


def transcribir_pdf(db: Session, empresa: m.Empresa, ruta: Path) -> list[tuple[int, str]]:
    """[(página, texto)] de las páginas con texto. Lanza ValueError si el OCR no está disponible o se agotó el gasto permitido."""
    if not disponible():
        raise ValueError("el PDF no tiene texto y el OCR no está disponible")
    modelo = modelos.obtener(MODELO_OCR)
    paginas: list[tuple[int, str]] = []
    with llm.capturando() as usos:
        for n, png in enumerate(paginas_png(ruta, OCR_MAX_PAGINAS), 1):
            if finops.limite_alcanzado(db, empresa):
                finops.registrar(db, empresa, None, usos)
                db.commit()
                raise ValueError("se alcanzó el límite de gasto de IA antes de terminar el OCR")
            texto = llm.transcribir(png, modelo, INSTRUCCION)
            if texto and texto.strip():
                paginas.append((n, texto.strip()))
    finops.registrar(db, empresa, None, usos)
    db.commit()               # el gasto del OCR se guarda aunque el documento termine en error
    if not paginas:
        raise ValueError("el OCR no encontró texto en el PDF")
    return paginas
