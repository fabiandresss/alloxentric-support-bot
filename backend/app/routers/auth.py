import uuid
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app import models as m, schemas as s
from app.db import get_db
from app.deps import usuario_actual, requiere_rol, ADMIN, SUPERADMIN
from app.mappers import usuario_out
from app.ratelimit import verificar
from app.security import hash_password, verificar_password, crear_token

router = APIRouter(tags=["auth y usuarios"])


@router.post("/auth/login", response_model=s.TokenOut)
def login(request: Request, body: s.LoginRequest, db: Session = Depends(get_db)):
    # fuerza bruta: 8 intentos/min por IP y correo, y 30/min por IP en total
    verificar(request, "login", 8, 60, extra=body.email.strip().lower())
    verificar(request, "login_ip", 30, 60)
    u = db.scalar(select(m.Usuario).where(m.Usuario.email == body.email.strip().lower()))
    # mismo mensaje para email inexistente / clave mala / usuario desactivado (no filtra información)
    if not u or not u.activo or not verificar_password(body.password, u.password_hash):
        raise HTTPException(401, "Credenciales inválidas")
    return s.TokenOut(access_token=crear_token(str(u.id), u.rol), user=usuario_out(u))


@router.get("/auth/me", response_model=s.UserOut)
def me(u: m.Usuario = Depends(usuario_actual)):
    return usuario_out(u)


# ----------------------------------------------------------------- gestión de usuarios
def _empresa(slug: str | None, db: Session) -> m.Empresa:
    e = db.scalar(select(m.Empresa).where(m.Empresa.slug == slug)) if slug else None
    if not e:
        raise HTTPException(404, "Empresa no encontrada")
    return e


def _get_usuario(uid: str, actor: m.Usuario, db: Session) -> m.Usuario:
    try:
        u = db.get(m.Usuario, uuid.UUID(uid))
    except ValueError:
        u = None
    if not u or (actor.rol != SUPERADMIN and u.empresa_id != actor.empresa_id):
        raise HTTPException(404, "Usuario no encontrado")   # 404 y no 403: no revela que existe
    return u


def _puede_asignar(actor: m.Usuario, rol: str) -> None:
    if rol == "superadmin" and actor.rol != SUPERADMIN:
        raise HTTPException(403, "Solo un superadmin puede crear o asignar el rol superadmin")


@router.get("/usuarios", response_model=list[s.UserOut])
def listar(company_id: str | None = None, actor: m.Usuario = Depends(requiere_rol(*ADMIN)),
           db: Session = Depends(get_db)):
    q = select(m.Usuario).order_by(m.Usuario.creado_en)
    if actor.rol != SUPERADMIN:
        q = q.where(m.Usuario.empresa_id == actor.empresa_id)
    elif company_id:
        q = q.join(m.Empresa, m.Empresa.id == m.Usuario.empresa_id).where(m.Empresa.slug == company_id)
    return [usuario_out(u) for u in db.scalars(q).all()]


@router.post("/usuarios", response_model=s.UserOut, status_code=201)
def crear(body: s.UserCreate, actor: m.Usuario = Depends(requiere_rol(*ADMIN)), db: Session = Depends(get_db)):
    _puede_asignar(actor, body.role)
    if body.role == "superadmin":
        empresa = None
    elif actor.rol == SUPERADMIN:
        empresa = _empresa(body.company_id, db)
    else:
        empresa = db.get(m.Empresa, actor.empresa_id)   # el admin de empresa solo crea en la suya
    u = m.Usuario(empresa_id=empresa.id if empresa else None, email=body.email.strip().lower(),
                  nombre=body.name, rol=body.role, password_hash=hash_password(body.password))
    db.add(u)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Ya existe un usuario con ese email")
    db.refresh(u)
    return usuario_out(u)


@router.patch("/usuarios/{uid}", response_model=s.UserOut)
def actualizar(uid: str, body: s.UserUpdate, actor: m.Usuario = Depends(requiere_rol(*ADMIN)),
               db: Session = Depends(get_db)):
    u = _get_usuario(uid, actor, db)
    if u.rol == SUPERADMIN and actor.rol != SUPERADMIN:
        raise HTTPException(403, "No puedes modificar a un superadmin")
    if body.role is not None:
        _puede_asignar(actor, body.role)
        if (body.role == SUPERADMIN) != (u.empresa_id is None):
            raise HTTPException(422, "No se puede convertir un usuario de empresa en superadmin (ni al revés)")
        if u.id == actor.id and body.role != u.rol:
            raise HTTPException(409, "No puedes cambiar tu propio rol")
        u.rol = body.role
    if body.active is not None:
        if u.id == actor.id and not body.active:
            raise HTTPException(409, "No puedes desactivarte a ti mismo")
        u.activo = body.active
    if body.name is not None:
        u.nombre = body.name
    if body.password:
        u.password_hash = hash_password(body.password)
    db.commit()
    db.refresh(u)
    return usuario_out(u)


@router.delete("/usuarios/{uid}", status_code=204)
def eliminar(uid: str, actor: m.Usuario = Depends(requiere_rol(*ADMIN)), db: Session = Depends(get_db)):
    u = _get_usuario(uid, actor, db)
    if u.id == actor.id:
        raise HTTPException(409, "No puedes eliminarte a ti mismo")
    if u.rol == SUPERADMIN and actor.rol != SUPERADMIN:
        raise HTTPException(403, "No puedes eliminar a un superadmin")
    db.delete(u)
    db.commit()
