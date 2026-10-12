import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload, joinedload
from app import models as m, schemas as s
from app.db import get_db
from app.deps import requiere_rol, verificar_tenant, SUPERADMIN, ADMIN, GESTION_TICKETS
from app.services import ciclo_ticket
from app.mappers import ticket_out, nombre_usuario

# Roles que atienden tickets: son los únicos a quienes se puede asignar uno
ROLES_ATENCION = ["admin_empresa", "encargado_tickets"]

router = APIRouter(prefix="/tickets", tags=["tickets"])


def _query():
    return select(m.Ticket).options(joinedload(m.Ticket.empresa), joinedload(m.Ticket.agente),
                                    joinedload(m.Ticket.conversacion).selectinload(m.Conversacion.mensajes))


def t_empresa(db: Session, ticket_id: str):
    """empresa_id del ticket (o None si el id no es válido; el 404 lo da _get)."""
    try:
        return db.scalar(select(m.Ticket.empresa_id).where(m.Ticket.id == uuid.UUID(ticket_id)))
    except ValueError:
        return None


def _get(ticket_id: str, db: Session, u: m.Usuario) -> m.Ticket:
    try:
        tid = uuid.UUID(ticket_id)
    except ValueError:
        raise HTTPException(404, "Ticket no encontrado")
    t = db.scalar(_query().where(m.Ticket.id == tid))
    if not t:
        raise HTTPException(404, "Ticket no encontrado")
    verificar_tenant(u, t.empresa_id)
    if t.estado == "escalado" and u.rol not in ADMIN:   # sale de la cola del encargado: lo gestiona el admin
        raise HTTPException(403, "Este ticket fue escalado a gestión y ya no está en tu cola")
    return t


@router.get("", response_model=list[s.Ticket], response_model_exclude_none=True)
def listar(company_id: str | None = None, status: s.TicketStatus | None = None,
           u: m.Usuario = Depends(requiere_rol(*GESTION_TICKETS)), db: Session = Depends(get_db)):
    ciclo_ticket.cerrar_vencidos(db, None if u.rol == SUPERADMIN else u.empresa_id)
    q = _query().order_by(m.Ticket.creado_en.desc())
    if u.rol != SUPERADMIN:                      # cada empresa ve SOLO sus tickets
        q = q.where(m.Ticket.empresa_id == u.empresa_id)
    if u.rol not in ADMIN:                       # los escalados ya no están en la cola del encargado
        q = q.where(m.Ticket.estado != "escalado")
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
    ciclo_ticket.cerrar_vencidos(db, t_empresa(db, ticket_id))
    t = _get(ticket_id, db, u)
    if body.status is not None:
        if t.estado == "cerrado":
            raise HTTPException(409, "El ticket está cerrado y no se puede modificar")
        if body.status in ("pendiente", "urgente"):
            if t.estado == "escalado":
                raise HTTPException(409, "Un ticket escalado se gestiona fuera del chat; solo puede cerrarse")
            t.estado = body.status
            t.encuesta_enviada_en = None          # si había encuesta pendiente, se cancela
        elif body.status == "cerrado":
            # el cierre normal lo decide el cliente (encuesta); a mano solo se cierra un ticket ya escalado
            if t.estado != "escalado":
                raise HTTPException(409, "El ticket solo se cierra cuando el cliente confirma que se resolvió")
            if u.rol not in ADMIN:
                raise HTTPException(403, "Solo el admin de la empresa puede cerrar un ticket escalado")
            t.estado, t.cierre_motivo = "cerrado", "gestion_manual"
        else:
            raise HTTPException(422, "Estado no permitido: lo fijan la encuesta o el cierre automático")
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
    """El agente humano responde al cliente y le envía la encuesta de resolución (el ticket queda
    `esperando_cliente`; lo cierra o escala la respuesta del cliente)."""
    ciclo_ticket.cerrar_vencidos(db, t_empresa(db, ticket_id))
    t = _get(ticket_id, db, u)
    if t.estado in ("cerrado", "escalado"):
        raise HTTPException(409, f"El ticket está {t.estado}: ya no se responde por este chat")
    db.add(m.Mensaje(empresa_id=t.empresa_id, conversacion_id=t.conversacion_id, rol="agente",
                     nombre_remitente=nombre_usuario(u),  # el remitente es quien está autenticado, no lo que diga el cliente
                     contenido=body.text))
    ciclo_ticket.enviar_encuesta(t)
    db.commit()
    db.expire_all()  # recargar la transcripción con el mensaje nuevo
    return ticket_out(_get(ticket_id, db, u))
