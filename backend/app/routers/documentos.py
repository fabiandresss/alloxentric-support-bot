import re
import uuid
from pathlib import Path
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session
from app import models as m, schemas as s
from app.config import STORAGE_DIR, MAX_UPLOAD_MB
from app.db import get_db
from app.deps import empresa_con_rol, requiere_rol, verificar_tenant, GESTION_AGENTE
from app.mappers import documento_out
from app.services import ingesta

router = APIRouter(tags=["documentos"])
TIPOS = {"pdf", "docx", "txt", "faq", "csv"}


@router.get("/empresas/{slug}/documentos", response_model=list[s.DocumentItem])
def listar(e: m.Empresa = Depends(empresa_con_rol(*GESTION_AGENTE)), db: Session = Depends(get_db)):
    ds = db.scalars(select(m.Documento).where(m.Documento.empresa_id == e.id)
                    .order_by(m.Documento.subido_en.desc())).all()
    return [documento_out(d) for d in ds]


@router.post("/empresas/{slug}/documentos", response_model=s.DocumentItem, status_code=201)
async def subir(bg: BackgroundTasks, archivo: UploadFile = File(...),
                e: m.Empresa = Depends(empresa_con_rol(*GESTION_AGENTE)), db: Session = Depends(get_db)):
    nombre = Path(archivo.filename or "").name
    tipo = nombre.rsplit(".", 1)[-1].lower() if "." in nombre else ""
    if tipo not in TIPOS:
        raise HTTPException(415, f"Tipo no soportado. Permitidos: {', '.join(sorted(TIPOS))}")
    datos = await archivo.read()
    if len(datos) > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(413, f"Máximo {MAX_UPLOAD_MB} MB")
    carpeta = STORAGE_DIR / str(e.id)          # una carpeta por empresa
    carpeta.mkdir(parents=True, exist_ok=True)
    seguro = re.sub(r"[^A-Za-z0-9._-]", "_", nombre)
    ruta = carpeta / f"{uuid.uuid4().hex[:8]}_{seguro}"
    ruta.write_bytes(datos)
    d = m.Documento(empresa_id=e.id, nombre=nombre, tipo=tipo, tamano_bytes=len(datos),
                    ruta_local=str(ruta), estado="procesando")
    db.add(d)
    db.commit()
    db.refresh(d)
    bg.add_task(ingesta.procesar_documento, d.id)
    return documento_out(d)


def _doc(doc_id: str, db: Session, u: m.Usuario) -> m.Documento:
    try:
        did = uuid.UUID(doc_id)
    except ValueError:
        raise HTTPException(404, "Documento no encontrado")
    d = db.get(m.Documento, did)
    if not d:
        raise HTTPException(404, "Documento no encontrado")
    verificar_tenant(u, d.empresa_id)
    return d


@router.delete("/documentos/{doc_id}", status_code=204)
def eliminar(doc_id: str, u: m.Usuario = Depends(requiere_rol(*GESTION_AGENTE)),
             db: Session = Depends(get_db)):
    d = _doc(doc_id, db, u)
    ruta = Path(d.ruta_local)
    db.delete(d)
    db.commit()
    if ruta.is_file() and STORAGE_DIR in ruta.resolve().parents:
        ruta.unlink()


@router.get("/documentos/{doc_id}/fragmentos", response_model=list[s.ChunkOut])
def fragmentos(doc_id: str, u: m.Usuario = Depends(requiere_rol(*GESTION_AGENTE)),
               db: Session = Depends(get_db)):
    d = _doc(doc_id, db, u)
    fs = db.scalars(select(m.FragmentoEmbedding).where(
        m.FragmentoEmbedding.documento_id == d.id,
        m.FragmentoEmbedding.empresa_id == d.empresa_id).order_by(m.FragmentoEmbedding.orden)).all()
    return [s.ChunkOut(id=str(f.id), order=f.orden, text=f.texto) for f in fs]
