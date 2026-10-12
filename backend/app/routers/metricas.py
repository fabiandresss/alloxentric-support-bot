from datetime import datetime
from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from app import models as m, schemas as s
from app.config import TZ
from app.db import get_db
from app.deps import requiere_rol, SUPERADMIN, TODOS

router = APIRouter(tags=["metricas"])


@router.get("/metricas", response_model=s.SystemMetrics)
def metricas(u: m.Usuario = Depends(requiere_rol(*TODOS)), db: Session = Depends(get_db)):
    """Superadmin: métricas globales. Resto: solo las de su empresa."""
    def sc(col):  # filtro de tenant
        return [col == u.empresa_id] if u.rol != SUPERADMIN else []
    inicio_hoy = datetime.now(TZ).replace(hour=0, minute=0, second=0, microsecond=0)
    T, C = m.Ticket, m.Conversacion
    abiertos = db.scalar(select(func.count()).select_from(T).where(T.estado.in_(["pendiente", "urgente"]), *sc(T.empresa_id))) or 0
    urgentes = db.scalar(select(func.count()).select_from(T).where(T.estado == "urgente", *sc(T.empresa_id))) or 0
    total = db.scalar(select(func.count()).select_from(C).where(C.iniciada_en >= inicio_hoy, *sc(C.empresa_id))) or 0
    derivadas = db.scalar(select(func.count()).select_from(C).where(
        C.iniciada_en >= inicio_hoy, C.derivada.is_(True), *sc(C.empresa_id))) or 0
    seg = db.scalar(select(func.avg(func.extract("epoch", T.actualizado_en - T.creado_en)))
                    .where(T.estado == "resuelto", *sc(T.empresa_id)))
    prom = "—" if seg is None else f"{int(seg) // 60}m {int(seg) % 60:02d}s"
    resueltas = total - derivadas
    return s.SystemMetrics(
        open_tickets=abiertos, urgent_tickets=urgentes, avg_resolution_time=prom,
        bot_resolved_today=resueltas, total_conversations_today=total,
        bot_resolution_rate=round(resueltas / total * 100, 1) if total else 0.0,
        escalation_rate=round(derivadas / total * 100, 1) if total else 0.0)
