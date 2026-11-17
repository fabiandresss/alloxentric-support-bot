"""Seguridad de la IA: registro de las intervenciones de los guardarraíles de cada empresa (inyecciones bloqueadas, datos enmascarados,
fugas evitadas…). Solo lectura; la configuración se cambia en PATCH /empresas/{slug} (campo `security`)."""
from datetime import timedelta
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from app import models as m, schemas as s
from app.db import get_db
from app.deps import empresa_con_rol, GESTION_AGENTE
from app.utils import ahora

router = APIRouter(prefix="/empresas/{slug}/seguridad", tags=["seguridad"])


@router.get("/eventos", response_model=s.SecurityOverview, response_model_exclude_none=True)
def eventos(dias: int = Query(30, ge=1, le=365), tipo: str | None = Query(None, max_length=28),
            limit: int = Query(50, ge=1, le=200), e: m.Empresa = Depends(empresa_con_rol(*GESTION_AGENTE)),
            db: Session = Depends(get_db)):
    """Resumen y lista (lo más reciente primero) de los eventos de seguridad de la IA de la empresa en los últimos `dias`."""
    E = m.EventoSeguridad
    desde = ahora() - timedelta(days=dias)
    donde = [E.empresa_id == e.id, E.creado_en >= desde]                      # <- tenant
    por_tipo = db.execute(select(E.tipo, func.count()).where(*donde).group_by(E.tipo).order_by(func.count().desc())).all()
    altos = db.scalar(select(func.count()).select_from(E).where(*donde, E.severidad == "alta")) or 0
    q = select(E).where(*donde)
    if tipo:
        q = q.where(E.tipo == tipo)
    filas = db.scalars(q.order_by(E.creado_en.desc()).limit(limit)).all()
    return s.SecurityOverview(
        days=dias, total=sum(n for _, n in por_tipo), high=int(altos),
        by_type=[s.SecurityCount(type=t, count=n) for t, n in por_tipo],
        events=[s.SecurityEvent(id=str(x.id), type=x.tipo, severity=x.severidad, detail=x.detalle, signals=list(x.senales or []),
                                conversation_id=str(x.conversacion_id) if x.conversacion_id else None, created_at=x.creado_en.isoformat())
                for x in filas])
