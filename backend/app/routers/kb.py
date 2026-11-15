"""Base de conocimiento: qué documentación está ingestada y cómo quedó fragmentada. Solo lectura (subir y borrar documentos sigue en /empresas/{slug}/documentos)."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from app import models as m, schemas as s
from app.db import get_db
from app.deps import empresa_con_rol, GESTION_AGENTE
from app.routers.testing import _uuid
from app.services import embeddings
from app.utils import ahora
from datetime import timedelta
import re

router = APIRouter(prefix="/empresas/{slug}/kb", tags=["kb"])


@router.get("/resumen", response_model=s.KbSummary, response_model_exclude_none=True)
def resumen(e: m.Empresa = Depends(empresa_con_rol(*GESTION_AGENTE)), db: Session = Depends(get_db)):
    D, F = m.Documento, m.FragmentoEmbedding
    estados = dict(db.execute(select(D.estado, func.count()).where(D.empresa_id == e.id).group_by(D.estado)).all())
    tipos = db.execute(select(D.tipo, func.count()).where(D.empresa_id == e.id).group_by(D.tipo).order_by(func.count().desc())).all()
    frs, chars, vec = db.execute(select(func.count(), func.coalesce(func.sum(func.length(F.texto)), 0),
                                        func.count(F.embedding)).where(F.empresa_id == e.id)).one()
    modelos_ = [x for x in db.scalars(select(F.modelo).where(F.empresa_id == e.id, F.modelo.is_not(None)).distinct()).all() if x]
    ultima = db.scalar(select(func.max(D.subido_en)).where(D.empresa_id == e.id))
    return s.KbSummary(documents=sum(estados.values()), processed=estados.get("procesado", 0), processing=estados.get("procesando", 0),
                       errors=estados.get("error", 0), fragments=int(frs), characters=int(chars), embedded_fragments=int(vec),
                       models=sorted(modelos_), last_updated=ultima.isoformat() if ultima else None,
                       by_type=[s.KbTypeCount(type=t, count=n) for t, n in tipos])


@router.get("/documentos", response_model=list[s.KbDocument], response_model_exclude_none=True)
def documentos(e: m.Empresa = Depends(empresa_con_rol(*GESTION_AGENTE)), db: Session = Depends(get_db)):
    """Los documentos de la empresa con sus fragmentos reales (cantidad, caracteres y cuántos tienen vector)."""
    D, F = m.Documento, m.FragmentoEmbedding
    cuentas = {did: (int(n), int(c or 0), int(v)) for did, n, c, v in db.execute(
        select(F.documento_id, func.count(), func.sum(func.length(F.texto)), func.count(F.embedding)).where(F.empresa_id == e.id).group_by(F.documento_id))}
    docs = db.scalars(select(D).where(D.empresa_id == e.id).order_by(D.subido_en.desc())).all()
    return [s.KbDocument(id=str(d.id), name=d.nombre, type=d.tipo, size_bytes=d.tamano_bytes, uploaded_at=d.subido_en.isoformat(), status=d.estado,
                         fragments=cuentas.get(d.id, (0, 0, 0))[0], characters=cuentas.get(d.id, (0, 0, 0))[1],
                         embedded_fragments=cuentas.get(d.id, (0, 0, 0))[2]) for d in docs]


@router.get("/fragmentos", response_model=s.KbChunkList, response_model_exclude_none=True)
def fragmentos(q: str | None = Query(None, max_length=200, description="Texto a buscar dentro de los fragmentos"),
               documento_id: str | None = None, limit: int = Query(30, ge=1, le=100), offset: int = Query(0, ge=0),
               e: m.Empresa = Depends(empresa_con_rol(*GESTION_AGENTE)), db: Session = Depends(get_db)):
    """Los fragmentos (chunks) que el agente puede usar, con su documento. Filtra por documento y/o por texto."""
    F, D = m.FragmentoEmbedding, m.Documento
    base = (select(F.id, F.documento_id, D.nombre, F.orden, F.texto, F.modelo, F.embedding.is_not(None).label("vec"))
            .join(D, D.id == F.documento_id).where(F.empresa_id == e.id, D.empresa_id == e.id))     # <- tenant
    if documento_id:
        base = base.where(F.documento_id == _uuid(documento_id))
    if q and q.strip():
        base = base.where(F.texto.ilike(f"%{q.strip()}%"))
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    filas = db.execute(base.order_by(D.nombre, F.orden).limit(limit).offset(offset)).all()
    return s.KbChunkList(total=int(total), items=[s.KbChunk(id=str(f.id), document_id=str(f.documento_id), document_name=f.nombre, order=f.orden,
                                                            text=f.texto, characters=len(f.texto), embedded=bool(f.vec), model=f.modelo) for f in filas])


def _norm(t: str) -> str:
    return re.sub(r"\s+", " ", (t or "").lower()).strip()


@router.get("/calidad", response_model=s.KbQuality, response_model_exclude_none=True)
def calidad(e: m.Empresa = Depends(empresa_con_rol(*GESTION_AGENTE)), db: Session = Depends(get_db)):
    """Revisa la base de conocimiento y avisa de lo que le quita calidad al agente: documentos sin contenido, vectores que no se usan,
    contenido repetido y fragmentos demasiado cortos."""
    D, F = m.Documento, m.FragmentoEmbedding
    docs = {d.id: d for d in db.scalars(select(D).where(D.empresa_id == e.id))}
    frs = db.execute(select(F.documento_id, F.texto, F.embedding.is_(None), F.modelo).where(F.empresa_id == e.id)).all()
    activo = embeddings.get_embedder().id
    por_doc: dict = {}
    for did, texto, sin_vec, modelo in frs:
        por_doc.setdefault(did, []).append((texto, sin_vec or modelo != activo))
    issues: list[s.KbIssue] = []
    nombre = lambda did: docs[did].nombre   # noqa: E731

    vacios = [d for d in docs.values() if d.estado == "error" or (d.estado == "procesado" and not por_doc.get(d.id))]
    if vacios:
        issues.append(s.KbIssue(code="sin_contenido", severity="alta", title="Documentos sin contenido utilizable", count=len(vacios),
                                detail="No se extrajo texto (¿PDF escaneado, archivo vacío o dañado?). El agente no puede usarlos. Súbelos de nuevo con texto seleccionable.",
                                documents=sorted(d.nombre for d in vacios)))
    colgados = [d for d in docs.values() if d.estado == "procesando" and d.subido_en < ahora() - timedelta(minutes=15)]
    if colgados:
        issues.append(s.KbIssue(code="procesando_colgado", severity="media", title="Documentos atascados en «procesando»", count=len(colgados),
                                detail="Llevan más de 15 minutos sin terminar: probablemente la ingesta se interrumpió. Reemplázalos para reprocesarlos.",
                                documents=sorted(d.nombre for d in colgados)))
    sin_uso: dict = {}
    for did, lst in por_doc.items():
        n = sum(1 for _, malo in lst if malo)
        if n:
            sin_uso[did] = n
    if sin_uso:
        issues.append(s.KbIssue(code="sin_vector", severity="alta", title="Fragmentos que el agente no puede buscar", count=sum(sin_uso.values()),
                                detail="No tienen vector o fueron vectorizados con otro modelo de embeddings que el activo, así que se ignoran al responder. "
                                       "Corre «python reindexar.py --todo» para regenerarlos.", documents=sorted(nombre(d) for d in sin_uso)))
    # contenido repetido: el mismo texto en más de un fragmento
    vistos: dict = {}
    for did, lst in por_doc.items():
        for texto, _ in lst:
            vistos.setdefault(_norm(texto), []).append(did)
    repetidos = {t: ds for t, ds in vistos.items() if len(ds) > 1 and len(t) >= 40}
    if repetidos:
        docs_rep = sorted({nombre(d) for ds in repetidos.values() for d in ds})
        issues.append(s.KbIssue(code="duplicados", severity="media", title="Contenido repetido", count=sum(len(ds) - 1 for ds in repetidos.values()),
                                detail="El mismo texto aparece en más de un fragmento. Si hay dos versiones de un documento, elimina la vieja: el agente puede citar la desactualizada.",
                                documents=docs_rep))
    # documentos que repiten casi todo su contenido
    firmas = {did: {_norm(t) for t, _ in lst if len(t) >= 40} for did, lst in por_doc.items()}
    pares = []
    ids = [d for d, f in firmas.items() if f]
    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            comun = len(firmas[a] & firmas[b])
            if comun and comun / min(len(firmas[a]), len(firmas[b])) >= 0.8:
                pares.append((nombre(a), nombre(b)))
    if pares:
        issues.append(s.KbIssue(code="casi_iguales", severity="alta", title="Documentos casi idénticos", count=len(pares),
                                detail="Estos pares comparten al menos el 80 % de su contenido: " + "; ".join(f"{x} ≈ {y}" for x, y in pares[:5]) + ". Deja solo la versión vigente.",
                                documents=sorted({n for p in pares for n in p})))
    cortos: dict = {}
    for did, lst in por_doc.items():
        n = sum(1 for t, _ in lst if len(t.strip()) < 60)
        if n:
            cortos[did] = n
    if cortos:
        issues.append(s.KbIssue(code="fragmentos_cortos", severity="baja", title="Fragmentos muy cortos", count=sum(cortos.values()),
                                detail="Menos de 60 caracteres: suelen ser títulos o viñetas sueltas que dan poco contexto. Revisa cómo está escrito el documento.",
                                documents=sorted(nombre(d) for d in cortos)))
    pena = {"alta": 25, "media": 12, "baja": 5}
    return s.KbQuality(score=max(0, 100 - sum(pena[i.severity] for i in issues)), issues=issues, documents_checked=len(docs), fragments_checked=len(frs))
