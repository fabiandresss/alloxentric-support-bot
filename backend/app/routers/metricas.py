from collections import defaultdict
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from app import models as m, schemas as s
from app.config import TZ
from app.db import get_db
from app.deps import requiere_rol, SUPERADMIN, TODOS
from app.services import ciclo_ticket
from app.utils import MESES

router = APIRouter(tags=["metricas"])


@router.get("/metricas", response_model=s.SystemMetrics)
def metricas(u: m.Usuario = Depends(requiere_rol(*TODOS)), db: Session = Depends(get_db)):
    """Superadmin: métricas globales. Resto: solo las de su empresa."""
    def sc(col):  # filtro de tenant
        return [col == u.empresa_id] if u.rol != SUPERADMIN else []
    ciclo_ticket.cerrar_vencidos(db, None if u.rol == SUPERADMIN else u.empresa_id)
    inicio_hoy = datetime.now(TZ).replace(hour=0, minute=0, second=0, microsecond=0)
    T, C = m.Ticket, m.Conversacion
    abiertos = db.scalar(select(func.count()).select_from(T).where(T.estado.in_(["pendiente", "urgente"]), *sc(T.empresa_id))) or 0
    urgentes = db.scalar(select(func.count()).select_from(T).where(T.estado == "urgente", *sc(T.empresa_id))) or 0
    total = db.scalar(select(func.count()).select_from(C).where(C.iniciada_en >= inicio_hoy, *sc(C.empresa_id))) or 0
    derivadas = db.scalar(select(func.count()).select_from(C).where(
        C.iniciada_en >= inicio_hoy, C.derivada.is_(True), *sc(C.empresa_id))) or 0
    # tiempo hasta la respuesta que resolvió (envío de la encuesta), solo de tickets cerrados
    seg = db.scalar(select(func.avg(func.extract("epoch", T.encuesta_enviada_en - T.creado_en)))
                    .where(T.estado == "cerrado", T.encuesta_enviada_en.is_not(None), *sc(T.empresa_id)))
    prom = "—" if seg is None else f"{int(seg) // 60}m {int(seg) % 60:02d}s"
    resueltas = total - derivadas
    return s.SystemMetrics(
        open_tickets=abiertos, urgent_tickets=urgentes, avg_resolution_time=prom,
        bot_resolved_today=resueltas, total_conversations_today=total,
        bot_resolution_rate=round(resueltas / total * 100, 1) if total else 0.0,
        escalation_rate=round(derivadas / total * 100, 1) if total else 0.0)


def _mmss(seg: float | None) -> str:
    return "—" if seg is None else f"{int(seg) // 60}m {int(seg) % 60:02d}s"


def _pct(parte: int, total: int) -> float:
    return round(parte / total * 100, 1) if total else 0.0


@router.get("/metricas/analitica", response_model=s.Analytics)
def analitica(dias: int = Query(14, ge=1, le=90), u: m.Usuario = Depends(requiere_rol(*TODOS)),
              db: Session = Depends(get_db)):
    """Vista Analítica. Superadmin: todas las empresas. Resto: solo la suya (una fila en `companies`).

    Una conversación cuenta como derivada si generó ticket; el resto la resolvió el bot.
    Se agrega en Python (no en SQL) para agrupar por día en la zona horaria local.
    """
    ciclo_ticket.cerrar_vencidos(db, None if u.rol == SUPERADMIN else u.empresa_id)
    q = select(m.Empresa).order_by(m.Empresa.creada_en)
    if u.rol != SUPERADMIN:
        q = q.where(m.Empresa.id == u.empresa_id)             # <- aislamiento por tenant
    empresas = db.scalars(q).all()
    ids = [e.id for e in empresas]

    hoy = datetime.now(TZ).replace(hour=0, minute=0, second=0, microsecond=0)
    inicio = hoy - timedelta(days=dias - 1)
    inicio_prev = inicio - timedelta(days=dias)
    filas = db.execute(select(m.Conversacion.empresa_id, m.Conversacion.iniciada_en, m.Conversacion.derivada)
                       .where(m.Conversacion.empresa_id.in_(ids), m.Conversacion.iniciada_en >= inicio_prev)).all()

    por_dia = defaultdict(lambda: [0, 0])          # fecha -> [bot, humano]
    por_empresa = defaultdict(lambda: [0, 0])      # empresa_id -> [bot, humano]
    previo = 0
    for emp_id, ini, derivada in filas:
        local = ini.astimezone(TZ)
        if local < inicio:
            previo += 1
            continue
        i = 1 if derivada else 0
        por_dia[local.date()][i] += 1
        por_empresa[emp_id][i] += 1

    daily = []
    for k in range(dias):
        d = (inicio + timedelta(days=k)).date()
        bot, hum = por_dia[d]
        etiqueta = "Hoy" if k == dias - 1 else f"{d.day:02d} {MESES[d.month - 1]}"
        daily.append(s.AnalyticsDay(date=etiqueta, bot=bot, human=hum, total=bot + hum))

    companies = []
    for e in empresas:
        bot, hum = por_empresa[e.id]
        companies.append(s.AnalyticsCompany(
            id=e.slug, name=e.nombre, industry=e.industria or "", brand_color=e.color_marca or "#4F46E5",
            total_queries=bot + hum, bot_resolved=bot, bot_rate=_pct(bot, bot + hum),
            escalated=hum, escalation_rate=_pct(hum, bot + hum)))

    bot = sum(c.bot_resolved for c in companies)
    hum = sum(c.escalated for c in companies)
    total = bot + hum
    seg = db.scalar(select(func.avg(func.extract("epoch", m.Ticket.encuesta_enviada_en - m.Ticket.creado_en)))
                    .where(m.Ticket.empresa_id.in_(ids), m.Ticket.estado == "cerrado",
                           m.Ticket.encuesta_enviada_en.is_not(None), m.Ticket.creado_en >= inicio))
    return s.Analytics(
        days=dias, total_conversations=total, bot_resolved=bot, human_escalated=hum,
        bot_rate=_pct(bot, total), escalation_rate=_pct(hum, total),
        conversations_delta=round((total - previo) / previo * 100, 1) if previo else None,
        avg_human_resolution=_mmss(seg), daily=daily, companies=companies)
