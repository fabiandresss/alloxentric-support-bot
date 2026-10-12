import hashlib
import secrets
from fastapi import Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from app import models as m
from app.db import get_db


def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def nueva_api_key() -> str:
    return "ak_" + secrets.token_urlsafe(24)


def empresa_por_slug(slug: str, db: Session = Depends(get_db)) -> m.Empresa:
    e = db.scalar(select(m.Empresa).where(m.Empresa.slug == slug))
    if not e:
        raise HTTPException(404, "Empresa no encontrada")
    return e


def empresa_por_api_key(x_api_key: str = Header(...), db: Session = Depends(get_db)) -> m.Empresa:
    """El tenant se deduce de la API key; el cliente NUNCA envía empresa_id."""
    e = db.scalar(select(m.Empresa).where(m.Empresa.api_key_hash == hash_key(x_api_key)))
    if not e:
        raise HTTPException(401, "API key inválida")
    return e


# ---------------------------------------------------------------- autenticación y roles (RF-28)
import uuid
import jwt as _jwt
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from app.security import leer_token

_bearer = HTTPBearer(auto_error=False)

SUPERADMIN = "superadmin"
ADMIN = ("superadmin", "admin_empresa")
GESTION_AGENTE = ("superadmin", "admin_empresa", "encargado_agente")
GESTION_TICKETS = ("superadmin", "admin_empresa", "encargado_tickets")
TODOS = ("superadmin", "admin_empresa", "encargado_tickets", "encargado_agente")


def usuario_actual(cred: HTTPAuthorizationCredentials | None = Depends(_bearer),
                   db: Session = Depends(get_db)) -> m.Usuario:
    if not cred:
        raise HTTPException(401, "Falta el token de autenticación")
    try:
        uid = uuid.UUID(leer_token(cred.credentials)["sub"])
    except (_jwt.PyJWTError, KeyError, ValueError):
        raise HTTPException(401, "Token inválido o expirado")
    u = db.get(m.Usuario, uid)
    if not u or not u.activo:
        raise HTTPException(401, "Usuario inexistente o desactivado")
    return u


def requiere_rol(*roles: str):
    def dep(u: m.Usuario = Depends(usuario_actual)) -> m.Usuario:
        if u.rol not in roles:
            raise HTTPException(403, "Tu rol no tiene permiso para esta acción")
        return u
    return dep


def verificar_tenant(u: m.Usuario, empresa_id) -> None:
    """Un usuario de empresa solo puede tocar datos de SU empresa; el superadmin, de todas."""
    if u.rol != SUPERADMIN and u.empresa_id != empresa_id:
        raise HTTPException(403, "No tienes acceso a esta empresa")


def empresa_con_rol(*roles: str):
    """Carga la empresa del path y exige rol permitido + pertenecer a esa empresa."""
    def dep(slug: str, u: m.Usuario = Depends(requiere_rol(*roles)),
            db: Session = Depends(get_db)) -> m.Empresa:
        e = db.scalar(select(m.Empresa).where(m.Empresa.slug == slug))
        if not e:
            raise HTTPException(404, "Empresa no encontrada")
        verificar_tenant(u, e.id)
        return e
    return dep
