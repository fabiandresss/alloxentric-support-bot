import re
import uuid
from pathlib import Path
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
import logging
from datetime import datetime, timezone
from sqlalchemy import select, delete
from sqlalchemy.orm import Session
from app import models as m, schemas as s
from app.config import STORAGE_DIR, MAX_UPLOAD_MB, INGESTA_BACKEND
from app.db import get_db
from app.deps import empresa_con_rol, requiere_rol, verificar_tenant, GESTION_AGENTE
from app.mappers import documento_out
from app.services import evaluacion, ingesta

log = logging.getLogger("documentos")

router = APIRouter(tags=["documentos"])
TIPOS = {"pdf", "docx", "txt", "faq", "csv", "md"}
ALIAS_TIPO = {"markdown": "md"}        # .markdown se guarda como md


def _ingestar(bg: BackgroundTasks, doc_id, motivo: str) -> None:
    """Procesa el documento en segundo plano: con Celery (INGESTA_BACKEND=celery y Redis arriba) o con BackgroundTasks. Si Celery no
    responde se cae a BackgroundTasks: subir un documento nunca debe fallar por culpa del broker."""
    if INGESTA_BACKEND == "celery":
        try:
            from app.tasks import procesar_documento as tarea
            tarea.delay(str(doc_id), motivo)
            return
        except Exception as exc:   # noqa: BLE001
            log.warning("Celery no disponible (%s): se procesa con BackgroundTasks", exc.__class__.__name__)
    bg.add_task(ingesta.procesar_documento, doc_id, motivo)


async def _leer(archivo: UploadFile) -> tuple[str, str, bytes]:
    """Valida extensión y tamaño del archivo subido y devuelve (nombre, tipo, bytes)."""
    nombre = Path(archivo.filename or "").name
    tipo = nombre.rsplit(".", 1)[-1].lower() if "." in nombre else ""
    tipo = ALIAS_TIPO.get(tipo, tipo)
    if tipo not in TIPOS:
        raise HTTPException(415, f"Tipo no soportado. Permitidos: {', '.join(sorted(TIPOS))}")
    datos = await archivo.read()
    if len(datos) > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(413, f"Máximo {MAX_UPLOAD_MB} MB")
    return nombre, tipo, datos


def _guardar(empresa_id, nombre: str, datos: bytes) -> Path:
    carpeta = STORAGE_DIR / str(empresa_id)          # una carpeta por empresa
    carpeta.mkdir(parents=True, exist_ok=True)
    ruta = carpeta / f"{uuid.uuid4().hex[:8]}_{re.sub(r'[^A-Za-z0-9._-]', '_', nombre)}"
    ruta.write_bytes(datos)
    return ruta


@router.get("/empresas/{slug}/documentos", response_model=list[s.DocumentItem])
def listar(e: m.Empresa = Depends(empresa_con_rol(*GESTION_AGENTE)), db: Session = Depends(get_db)):
    ds = db.scalars(select(m.Documento).where(m.Documento.empresa_id == e.id)
                    .order_by(m.Documento.subido_en.desc())).all()
    return [documento_out(d) for d in ds]


@router.post("/empresas/{slug}/documentos", response_model=s.DocumentItem, status_code=201)
async def subir(bg: BackgroundTasks, archivo: UploadFile = File(...),
                e: m.Empresa = Depends(empresa_con_rol(*GESTION_AGENTE)), db: Session = Depends(get_db)):
    nombre, tipo, datos = await _leer(archivo)
    ruta = _guardar(e.id, nombre, datos)
    d = m.Documento(empresa_id=e.id, nombre=nombre, tipo=tipo, tamano_bytes=len(datos),
                    ruta_local=str(ruta), estado="procesando")
    db.add(d)
    db.commit()
    db.refresh(d)
    _ingestar(bg, d.id, "subir")
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
def eliminar(doc_id: str, bg: BackgroundTasks, u: m.Usuario = Depends(requiere_rol(*GESTION_AGENTE)),
             db: Session = Depends(get_db)):
    d = _doc(doc_id, db, u)
    empresa_id, nombre = d.empresa_id, d.nombre
    rutas = [Path(d.ruta_local)] + [Path(v.ruta_local) for v in db.scalars(select(m.DocumentoVersion).where(
        m.DocumentoVersion.documento_id == d.id, m.DocumentoVersion.empresa_id == d.empresa_id))]
    db.delete(d)                     # borra también sus fragmentos y su historial de versiones
    db.commit()
    for ruta in rutas:
        if ruta.is_file() and STORAGE_DIR in ruta.resolve().parents:
            ruta.unlink()
    bg.add_task(evaluacion.disparar_automaticas, empresa_id, f"eliminar «{nombre}»")   # ¿empeoró el agente sin ese documento?


@router.get("/documentos/{doc_id}/fragmentos", response_model=list[s.ChunkOut])
def fragmentos(doc_id: str, u: m.Usuario = Depends(requiere_rol(*GESTION_AGENTE)),
               db: Session = Depends(get_db)):
    d = _doc(doc_id, db, u)
    fs = db.scalars(select(m.FragmentoEmbedding).where(
        m.FragmentoEmbedding.documento_id == d.id,
        m.FragmentoEmbedding.empresa_id == d.empresa_id).order_by(m.FragmentoEmbedding.orden)).all()
    return [s.ChunkOut(id=str(f.id), order=f.orden, text=f.texto) for f in fs]


# ------------------------------------------------------------------------------------------ versiones (reemplazar y volver atrás)
def _archivar(db: Session, d: m.Documento) -> None:
    """Guarda en el historial el archivo actual antes de cambiarlo (el archivo se conserva en storage/)."""
    db.add(m.DocumentoVersion(empresa_id=d.empresa_id, documento_id=d.id, version=d.version, nombre=d.nombre, tipo=d.tipo,
                              tamano_bytes=d.tamano_bytes, ruta_local=d.ruta_local, num_fragmentos=d.num_fragmentos, subido_en=d.subido_en))


def _poner_archivo(db: Session, d: m.Documento, nombre: str, tipo: str, tamano: int, ruta: str) -> None:
    """Deja `ruta` como el contenido vigente del documento: borra sus fragmentos, sube la versión y queda a la espera de la ingesta."""
    db.execute(delete(m.FragmentoEmbedding).where(m.FragmentoEmbedding.documento_id == d.id, m.FragmentoEmbedding.empresa_id == d.empresa_id))
    d.nombre, d.tipo, d.tamano_bytes, d.ruta_local = nombre, tipo, tamano, ruta
    d.estado, d.num_fragmentos, d.version = "procesando", 0, d.version + 1
    d.subido_en = datetime.now(timezone.utc)


@router.post("/documentos/{doc_id}/reemplazar", response_model=s.DocumentItem)
async def reemplazar(doc_id: str, bg: BackgroundTasks, archivo: UploadFile = File(...),
                     u: m.Usuario = Depends(requiere_rol(*GESTION_AGENTE)), db: Session = Depends(get_db)):
    """Sube una versión nueva del documento conservando la anterior en el historial. Al terminar de procesarlo corren los golden sets automáticos."""
    d = _doc(doc_id, db, u)
    nombre, tipo, datos = await _leer(archivo)
    ruta = _guardar(d.empresa_id, nombre, datos)
    _archivar(db, d)
    _poner_archivo(db, d, nombre, tipo, len(datos), str(ruta))
    db.commit()
    db.refresh(d)
    _ingestar(bg, d.id, "reemplazar")
    return documento_out(d)


@router.get("/documentos/{doc_id}/versiones", response_model=list[s.DocVersion])
def versiones(doc_id: str, u: m.Usuario = Depends(requiere_rol(*GESTION_AGENTE)), db: Session = Depends(get_db)):
    """El historial del documento, de la versión más nueva (la vigente) a la más antigua."""
    d = _doc(doc_id, db, u)
    out = [s.DocVersion(version=d.version, name=d.nombre, type=d.tipo, size_bytes=d.tamano_bytes, fragments=d.num_fragmentos,
                        uploaded_at=d.subido_en.isoformat(), current=True, restorable=False)]
    for v in db.scalars(select(m.DocumentoVersion).where(m.DocumentoVersion.documento_id == d.id, m.DocumentoVersion.empresa_id == d.empresa_id)
                        .order_by(m.DocumentoVersion.version.desc())):
        out.append(s.DocVersion(version=v.version, name=v.nombre, type=v.tipo, size_bytes=v.tamano_bytes, fragments=v.num_fragmentos,
                                uploaded_at=v.subido_en.isoformat(), replaced_at=v.reemplazada_en.isoformat(), current=False,
                                restorable=Path(v.ruta_local).is_file()))
    return out


@router.post("/documentos/{doc_id}/versiones/{version}/restaurar", response_model=s.DocumentItem)
def restaurar(doc_id: str, version: int, bg: BackgroundTasks, u: m.Usuario = Depends(requiere_rol(*GESTION_AGENTE)), db: Session = Depends(get_db)):
    """Vuelve a una versión anterior: el archivo vigente pasa al historial y se reprocesa el de esa versión (queda como una versión nueva)."""
    d = _doc(doc_id, db, u)
    v = db.scalar(select(m.DocumentoVersion).where(m.DocumentoVersion.documento_id == d.id, m.DocumentoVersion.empresa_id == d.empresa_id,
                                                  m.DocumentoVersion.version == version))
    if not v:
        raise HTTPException(404, "Versión no encontrada")
    ruta = Path(v.ruta_local)
    if not ruta.is_file():
        raise HTTPException(410, "El archivo de esa versión ya no existe en el almacenamiento")
    _archivar(db, d)
    _poner_archivo(db, d, v.nombre, v.tipo, v.tamano_bytes, v.ruta_local)
    db.commit()
    db.refresh(d)
    _ingestar(bg, d.id, f"restaurar la v{version} de")
    return documento_out(d)
