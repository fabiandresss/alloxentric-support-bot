import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload, joinedload
from app import models as m, schemas as s
from app.db import get_db
from app.deps import requiere_rol, verificar_tenant, SUPERADMIN, GESTION_TICKETS
from app.mappers import ticket_out, nombre_usuario

# Roles que atienden tickets: son los únicos a quienes se puede asignar uno
ROLES_ATENCION = ["admin_empresa", "encargado_tickets"]

router = APIRouter(prefix="/tickets", tags=["tickets"])


def _query():
    return select(m.Ticket).options(joinedload(m.Ticket.empresa), joinedload(m.Ticket.agente),
                                    joinedload(m.Ticket.conversacion).selectinload(m.Conversacion.mensajes))


def _get(ticket_id: str, db: Session, u: m.Usuario) -> m.Ticket:
    try:
        tid = uuid.UUID(ticket_id)
    except ValueError:
        raise HTTPException(404, "Ticket no encontrado")
    t = db.scalar(_query().where(m.Ticket.id == tid))
    if not t:
        raise HTTPException(404, "Ticket no encontrado")
    verificar_tenant(u, t.empresa_id)
    return t


@router.get("", response_model=list[s.Ticket], response_model_exclude_none=True)
def listar(company_id: str | None = None, status: s.TicketStatus | None = None,
           u: m.Usuario = Depends(requiere_rol(*GESTION_TICKETS)), db: Session = Depends(get_db)):
    q = _query().order_by(m.Ticket.creado_en.desc())
    if u.rol != SUPERADMIN:                      # cada empresa ve SOLO sus tickets
        q = q.where(m.Ticket.empresa_id == u.empresa_id)
    elif company_id:
        q = q.join(m.Empresa, m.Empresa.id == m.Ticket.empresa_id).where(m.Empresa.slug == company_id)
    if status:
        q = q.where(m.Ticket.estado == status)
    return [ticket_out(t) for t in db.scalars(q).unique().all()]


@router.get("/agentes", response_model=list[s.AssignableAgent])
def agentes_asignables(u: m.Usuario = Depends(requiere_rol(*GESTION_TICKETS)), db: Session = Depends(get_db)):
    """Usuarios activos que pueden atender tickets. Cada empresa ve solo los suyos; el superadmin, todos."""
    q = (select(m.Usuario).options(joinedload(m.Usuario.empresa))
         .where(m.Usuario.activo.is_(True), m.Usuario.rol.in_(ROLES_ATENCION))
         .order_by(m.Usuario.nombre, m.Usuario.email))
    if u.rol != SUPERADMIN:
        q = q.where(m.Usuario.empresa_id == u.empresa_id)
    return [s.AssignableAgent(id=str(a.id), name=nombre_usuario(a), role=a.rol, company_id=a.empresa.slug)
            for a in db.scalars(q).all()]


@router.get("/{ticket_id}", response_model=s.Ticket, response_model_exclude_none=True)
def obtener(ticket_id: str, u: m.Usuario = Depends(requiere_rol(*GESTION_TICKETS)),
            db: Session = Depends(get_db)):
    return ticket_out(_get(ticket_id, db, u))


@router.patch("/{ticket_id}", response_model=s.Ticket, response_model_exclude_none=True)
def actualizar(ticket_id: str, body: s.TicketUpdate, u: m.Usuario = Depends(requiere_rol(*GESTION_TICKETS)),
               db: Session = Depends(get_db)):
    t = _get(ticket_id, db, u)
    if body.status is not None:
        t.estado = body.status
    if "assigned_agent_id" in body.model_fields_set:       # null explícito = dejar sin asignar
        if body.assigned_agent_id is None:
            t.agente_asignado_id = None
        else:
            try:
                aid = uuid.UUID(body.assigned_agent_id)
            except ValueError:
                raise HTTPException(422, "Agente inválido")
            ag = db.scalar(select(m.Usuario).where(
                m.Usuario.id == aid, m.Usuario.empresa_id == t.empresa_id,   # <- misma empresa del ticket
                m.Usuario.activo.is_(True), m.Usuario.rol.in_(ROLES_ATENCION)))
            if not ag:
                raise HTTPException(422, "El agente no existe o no pertenece a la empresa del ticket")
            t.agente_asignado_id = ag.id
    db.commit()
    db.refresh(t)
    return ticket_out(t)


@router.post("/{ticket_id}/respuesta", response_model=s.Ticket, response_model_exclude_none=True)
def responder(ticket_id: str, body: s.AgentReply, u: m.Usuario = Depends(requiere_rol(*GESTION_TICKETS)),
              db: Session = Depends(get_db)):
    """El agente humano responde al cliente: queda en la transcripción y el ticket pasa a resuelto."""
    t = _get(ticket_id, db, u)
    db.add(m.Mensaje(empresa_id=t.empresa_id, conversacion_id=t.conversacion_id, rol="agente",
                     nombre_remitente=nombre_usuario(u),  # el remitente es quien está autenticado, no lo que diga el cliente
                     contenido=body.text))
    t.estado = "resuelto"
    db.commit()
    db.expire_all()  # recargar la transcripción con el mensaje nuevo
    return ticket_out(_get(ticket_id, db, u))
