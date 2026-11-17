import uuid
from datetime import date, datetime, time, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, or_, exists
from sqlalchemy.orm import Session
from app import models as m, schemas as s
from app.config import TZ
from app.db import get_db
from app.deps import empresa_con_rol, requiere_rol, verificar_tenant, GESTION_AGENTE
from app.mappers import mensaje_out

router = APIRouter(tags=["conversaciones"])


def _extracto(t: str, n: int = 140) -> str:
    t = " ".join((t or "").split())
    return t[:n] + ("…" if len(t) > n else "")


def _items(db: Session, filas, empresa_id) -> list[s.ConversationListItem]:
    """Arma las filas de la lista (primer y último mensaje) para una página de conversaciones ya consultada."""
    ids = [f.id for f in filas]
    primero: dict = {}
    ultimo: dict = {}
    arriba: dict = {}
    abajo: dict = {}
    if ids:
        for msg in db.scalars(select(m.Mensaje).where(m.Mensaje.empresa_id == empresa_id, m.Mensaje.conversacion_id.in_(ids))
                              .order_by(m.Mensaje.creado_en)):
            if msg.rol == "usuario":
                primero.setdefault(msg.conversacion_id, msg.contenido)
            ultimo[msg.conversacion_id] = msg.contenido
            if msg.valoracion == "arriba":
                arriba[msg.conversacion_id] = arriba.get(msg.conversacion_id, 0) + 1
            elif msg.valoracion == "abajo":
                abajo[msg.conversacion_id] = abajo.get(msg.conversacion_id, 0) + 1
    return [s.ConversationListItem(
        id=str(f.id), customer_name=f.nombre_cliente or "Visitante", customer_email=f.email_cliente, channel=f.canal,
        started_at=f.iniciada_en.isoformat(), last_activity_at=(f.ultima or f.iniciada_en).isoformat(),
        message_count=int(f.n or 0), escalated=bool(f.derivada), ticket_number=f.numero, ticket_status=f.estado,
        first_message=_extracto(primero.get(f.id, "")), last_message=_extracto(ultimo.get(f.id, "")),
        cost_usd=round(float(f.costo or 0), 6), thumbs_up=arriba.get(f.id, 0), thumbs_down=abajo.get(f.id, 0)) for f in filas]


def _base(empresa_id):
    """Conversación + nº de mensajes + último mensaje + ticket (si lo hay) + costo de IA. TODO filtrado por empresa."""
    C, M, T, U = m.Conversacion, m.Mensaje, m.Ticket, m.UsoIA
    msgs = (select(M.conversacion_id.label("cid"), func.count().label("n"), func.max(M.creado_en).label("ultima"))
            .where(M.empresa_id == empresa_id).group_by(M.conversacion_id).subquery())
    costo = (select(U.conversacion_id.label("cid"), func.sum(U.costo_usd).label("costo"))
             .where(U.empresa_id == empresa_id).group_by(U.conversacion_id).subquery())
    q = (select(C.id, C.nombre_cliente, C.email_cliente, C.canal, C.derivada, C.iniciada_en, msgs.c.n, msgs.c.ultima,
                T.numero, T.estado, costo.c.costo)
         .outerjoin(msgs, msgs.c.cid == C.id).outerjoin(costo, costo.c.cid == C.id)
         .outerjoin(T, (T.conversacion_id == C.id) & (T.empresa_id == empresa_id))
         .where(C.empresa_id == empresa_id))
    return q, msgs


def _dia(d: date) -> datetime:
    return datetime.combine(d, time.min, tzinfo=TZ)


@router.get("/empresas/{slug}/conversaciones", response_model=s.ConversationList, response_model_exclude_none=True)
def listar(q: str | None = Query(None, max_length=120, description="Texto en el nombre, correo, ticket o los mensajes"),
           ticket: str | None = Query(None, pattern="^(con|sin)$", description="con = derivadas a un ticket; sin = resueltas por el bot"),
           canal: str | None = Query(None, max_length=30),
           valoracion: str | None = Query(None, pattern="^(abajo|arriba)$", description="abajo = con alguna respuesta valorada 👎"),
           desde: date | None = None, hasta: date | None = None,
           limit: int = Query(25, ge=1, le=100), offset: int = Query(0, ge=0),
           e: m.Empresa = Depends(empresa_con_rol(*GESTION_AGENTE)), db: Session = Depends(get_db)):
    """Registro de TODAS las conversaciones del chatbot de la empresa, tengan ticket o no (la más reciente primero)."""
    C, M, T = m.Conversacion, m.Mensaje, m.Ticket
    base, msgs = _base(e.id)
    if ticket == "con":
        base = base.where(T.id.is_not(None))
    elif ticket == "sin":
        base = base.where(T.id.is_(None))
    if canal:
        base = base.where(C.canal == canal)
    if valoracion:
        base = base.where(exists().where(M.conversacion_id == C.id, M.empresa_id == e.id, M.valoracion == valoracion))
    if desde:
        base = base.where(C.iniciada_en >= _dia(desde))
    if hasta:
        base = base.where(C.iniciada_en < _dia(hasta + timedelta(days=1)))
    if q and q.strip():
        like = f"%{q.strip()}%"
        base = base.where(or_(C.nombre_cliente.ilike(like), C.email_cliente.ilike(like), T.numero.ilike(like),
                              exists().where(M.conversacion_id == C.id, M.empresa_id == e.id, M.contenido.ilike(like))))
    total = db.scalar(select(func.count()).select_from(base.with_only_columns(C.id).subquery())) or 0
    filas = db.execute(base.order_by(func.coalesce(msgs.c.ultima, C.iniciada_en).desc()).limit(limit).offset(offset)).all()
    return s.ConversationList(total=int(total), items=_items(db, filas, e.id))


@router.get("/conversaciones/{conv_id}", response_model=s.ConversationDetail, response_model_exclude_none=True)
def detalle(conv_id: str, u: m.Usuario = Depends(requiere_rol(*GESTION_AGENTE)), db: Session = Depends(get_db)):
    """Transcripción completa de una conversación, con o sin ticket, y lo que costó la IA en ella."""
    try:
        cid = uuid.UUID(conv_id)
    except ValueError:
        raise HTTPException(404, "Conversación no encontrada")
    c = db.get(m.Conversacion, cid)
    if not c:
        raise HTTPException(404, "Conversación no encontrada")
    verificar_tenant(u, c.empresa_id)          # <- aislamiento por tenant
    base, _ = _base(c.empresa_id)
    fila = db.execute(base.where(m.Conversacion.id == cid)).all()
    msgs = db.scalars(select(m.Mensaje).where(m.Mensaje.conversacion_id == cid, m.Mensaje.empresa_id == c.empresa_id)
                      .order_by(m.Mensaje.creado_en)).all()
    U = m.UsoIA
    t_in, t_out, n = db.execute(select(func.coalesce(func.sum(U.tokens_entrada), 0), func.coalesce(func.sum(U.tokens_salida), 0), func.count())
                                .where(U.conversacion_id == cid, U.empresa_id == c.empresa_id)).one()
    return s.ConversationDetail(summary=_items(db, fila, c.empresa_id)[0], messages=[mensaje_out(x) for x in msgs],
                                input_tokens=int(t_in), output_tokens=int(t_out), ai_calls=int(n))
