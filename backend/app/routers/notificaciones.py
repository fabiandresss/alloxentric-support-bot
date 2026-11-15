"""Notificaciones de la plataforma (campana): alertas de gasto y cambios en las pruebas del agente.

Las de gasto solo las ven superadmin y admin de la empresa. Siempre se filtra por la empresa del path.
"""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, update
from sqlalchemy.orm import Session
from app import models as m, schemas as s
from app.db import get_db
from app.deps import empresa_con_rol, usuario_actual, ADMIN, GESTION_AGENTE
from app.routers.testing import _uuid
from app.services.notificaciones import TIPOS_DE_GASTO

router = APIRouter(prefix="/empresas/{slug}/notificaciones", tags=["notificaciones"])


def _visibles(u: m.Usuario, e: m.Empresa):
    q = [m.Notificacion.empresa_id == e.id]
    if u.rol not in ADMIN:
        q.append(m.Notificacion.tipo.not_in(TIPOS_DE_GASTO))
    return q


def _out(n: m.Notificacion) -> s.Notification:
    return s.Notification(id=str(n.id), type=n.tipo, title=n.titulo, message=n.mensaje, view=n.vista, ref=n.ref,
                          created_at=n.creada_en.isoformat(), seen=n.vista_en is not None)


@router.get("", response_model=list[s.Notification], response_model_exclude_none=True)
def listar(solo_nuevas: bool = False, limit: int = Query(30, ge=1, le=100), e: m.Empresa = Depends(empresa_con_rol(*GESTION_AGENTE)),
           u: m.Usuario = Depends(usuario_actual), db: Session = Depends(get_db)):
    q = select(m.Notificacion).where(*_visibles(u, e))
    if solo_nuevas:
        q = q.where(m.Notificacion.vista_en.is_(None))
    return [_out(n) for n in db.scalars(q.order_by(m.Notificacion.creada_en.desc()).limit(limit))]


@router.post("/visto-todas", status_code=204)
def marcar_todas(e: m.Empresa = Depends(empresa_con_rol(*GESTION_AGENTE)), u: m.Usuario = Depends(usuario_actual), db: Session = Depends(get_db)):
    db.execute(update(m.Notificacion).where(*_visibles(u, e), m.Notificacion.vista_en.is_(None)).values(vista_en=datetime.now(timezone.utc)))
    db.commit()


@router.post("/{nid}/visto", status_code=204)
def marcar(nid: str, e: m.Empresa = Depends(empresa_con_rol(*GESTION_AGENTE)), u: m.Usuario = Depends(usuario_actual), db: Session = Depends(get_db)):
    n = db.scalar(select(m.Notificacion).where(m.Notificacion.id == _uuid(nid), *_visibles(u, e)))
    if not n:
        raise HTTPException(404, "Notificación no encontrada")
    n.vista_en = n.vista_en or datetime.now(timezone.utc)
    db.commit()
