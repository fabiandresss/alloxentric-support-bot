"""Registro en autoservicio: una persona crea su cuenta, registra su empresa y crea el chatbot de su empresa.

  1. POST /registro/usuario   (sin sesión)           -> cuenta con rol `registrado` (sin empresa) y su token
  2. POST /registro/empresa   (rol `registrado`)     -> crea la empresa y la deja como su admin (`admin_empresa`)
  3. POST /empresas/{slug}/chatbot (admin de la empresa) -> crea el chatbot; UNO por empresa. Otro: contactar a Alloxentric

Seguridad: los endpoints sin sesión llevan límite de peticiones (regla 9); el tenant del paso 2 sale del usuario autenticado, nunca del
cuerpo; `REGISTRO_ABIERTO=false` apaga todo el módulo. No hay verificación del correo (SMTP es opcional): una cuenta solo da acceso a
la empresa que ella misma registre. Ver docs/01 §registro.
"""
import re
from datetime import datetime, timezone
from urllib.parse import urlparse
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app import models as m, schemas as s
from app.config import REGISTRO_ABIERTO
from app.db import get_db
from app.deps import empresa_con_rol, hash_key, nueva_api_key, requiere_rol, ADMIN
from app.mappers import empresa_out, usuario_out
from app.ratelimit import verificar
from app.routers.empresas import _slug
from app.security import crear_token, hash_password
from app.services import finops, seguridad

router = APIRouter(tags=["registro"])
EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-]{1,64}@[A-Za-z0-9\-]+(\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}$")
CONTACTO = "Cada empresa tiene un solo chatbot; si necesitas otro, contacta a Alloxentric."


def _abierto() -> None:
    if not REGISTRO_ABIERTO:
        raise HTTPException(403, "El registro está cerrado. Contacta a Alloxentric para crear tu cuenta.")


def validar_password(pw: str, email: str, nombre: str) -> None:
    """Mínimo 10 caracteres (lo exige el schema), con letras y números, y que no sea el correo ni el nombre."""
    if not (re.search(r"[A-Za-z]", pw) and re.search(r"\d", pw)):
        raise HTTPException(422, "La contraseña debe tener letras y números")
    bajo = pw.lower()
    if bajo in (email.lower(), nombre.lower()) or email.lower() in bajo or email.split("@")[0].lower() in bajo and len(email.split("@")[0]) >= 4:
        raise HTTPException(422, "La contraseña no puede contener tu correo ni tu nombre")
    if len(set(pw)) < 5:
        raise HTTPException(422, "La contraseña es demasiado repetitiva")


def _tinte(hex_color: str, mezcla: float = 0.9) -> str:
    """El color de marca mezclado con blanco (fondo suave de los chips y del chat)."""
    r, g, b = (int(hex_color[i:i + 2], 16) for i in (1, 3, 5))
    return "#{:02X}{:02X}{:02X}".format(*(round(c + (255 - c) * mezcla) for c in (r, g, b)))


@router.post("/registro/usuario", response_model=s.TokenOut, status_code=201)
def registrar_usuario(request: Request, body: s.RegisterUser, db: Session = Depends(get_db)):
    """Paso 1: crea la cuenta. Sin sesión: 5 cuentas por hora y por IP, y 3 intentos por hora por correo."""
    _abierto()
    verificar(request, "registro_ip", 5, 3600)
    email = body.email.strip().lower()
    verificar(request, "registro_correo", 3, 3600, extra=email)
    if body.website:                      # un bot llenó el campo oculto
        raise HTTPException(422, "Solicitud inválida")
    if not EMAIL_RE.match(email):
        raise HTTPException(422, "Ingresa un correo válido")
    nombre = " ".join(seguridad.limpiar(body.name).split())
    if len(nombre) < 2:
        raise HTTPException(422, "Ingresa tu nombre")
    validar_password(body.password, email, nombre)
    u = m.Usuario(empresa_id=None, email=email, nombre=nombre, rol="registrado", password_hash=hash_password(body.password))
    db.add(u)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Ya existe una cuenta con ese correo. Inicia sesión.")
    db.refresh(u)
    return s.TokenOut(access_token=crear_token(str(u.id), u.rol), user=usuario_out(u))


@router.post("/registro/empresa", response_model=s.Company, response_model_exclude_none=True, status_code=201)
def registrar_empresa(request: Request, body: s.RegisterCompany, u: m.Usuario = Depends(requiere_rol("registrado")),
                      db: Session = Depends(get_db)):
    """Paso 2: la persona registrada crea su empresa y queda como su admin. Una cuenta registra una sola empresa (después deja de ser
    `registrado`). El chatbot se crea aparte (paso 3)."""
    _abierto()
    verificar(request, "registro_empresa", 5, 3600)
    nombre = " ".join(seguridad.limpiar(body.name).split())
    if len(nombre) < 2:
        raise HTTPException(422, "Ingresa el nombre de la empresa")
    if db.scalar(select(m.Empresa).where(m.Empresa.nombre == nombre)):
        raise HTTPException(409, "Ya existe una empresa con ese nombre. Si es la tuya, pide a su administrador que te invite o contacta a Alloxentric.")
    sitio = None
    if body.site_url and body.site_url.strip():
        p = urlparse(body.site_url.strip() if "://" in body.site_url else f"https://{body.site_url.strip()}")
        if p.scheme not in ("http", "https") or not p.hostname or "." not in p.hostname:
            raise HTTPException(422, "El sitio web no es válido (ej. https://miempresa.cl)")
        sitio = f"{p.scheme}://{p.hostname}{p.path.rstrip('/')}"[:255]
    base, slug, n = _slug(nombre), _slug(nombre), 2
    while db.scalar(select(m.Empresa).where(m.Empresa.slug == slug)):
        slug, n = f"{base}-{n}", n + 1
    e = m.Empresa(nombre=nombre, slug=slug, industria=" ".join(seguridad.limpiar(body.industry or "").split()) or None, url_sitio=sitio,
                  api_key_hash=hash_key(nueva_api_key()),          # la clave se genera al pedirla en el panel (se muestra una sola vez)
                  nombre_agente=None, estado_agente="en_configuracion", tono="cercano", umbral_rag=0.8,
                  iniciales_logo="".join(w[0] for w in nombre.split())[:2].upper() or "CO", color_marca="#D20A2E", color_fondo="#FCEDEF",
                  chatbot_pendiente=True)
    db.add(e)
    db.flush()
    u.empresa_id, u.rol = e.id, "admin_empresa"
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Ya existe una empresa con ese nombre. Contacta a Alloxentric si es la tuya.")
    db.refresh(e)
    return empresa_out(db, e)


@router.post("/empresas/{slug}/chatbot", response_model=s.Company, response_model_exclude_none=True, status_code=201)
def crear_chatbot(body: s.ChatbotCreate, e: m.Empresa = Depends(empresa_con_rol(*ADMIN)), db: Session = Depends(get_db)):
    """Paso 3: crea el chatbot de la empresa (nombre, tono, instrucciones, color y **plan de gasto**: ilimitado o con límite). **Uno por
    empresa**: si ya lo tiene, 409. Queda «en configuración»: se publica cuando suba su documentación y active el agente."""
    if not e.chatbot_pendiente:
        raise HTTPException(409, f"Tu empresa ya tiene un chatbot. {CONTACTO}")
    e.nombre_agente = " ".join(seguridad.limpiar(body.agent_name).split())
    if len(e.nombre_agente) < 2:
        raise HTTPException(422, "Ingresa el nombre del chatbot")
    e.tono = body.tone
    instr = seguridad.limpiar(body.custom_instructions or "")
    e.instrucciones = instr or (f"Eres {e.nombre_agente}, el asistente de {e.nombre}. Responde con precisión usando la documentación "
                                f"de la empresa y deriva a una persona si falta información.")
    e.color_marca, e.color_fondo = body.brand_color.upper(), _tinte(body.brand_color)
    try:
        finops.aplicar_plan(e, body.spend_plan.mode, body.spend_plan.monthly_limit_usd, body.spend_plan.daily_limit_usd)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    e.estado_agente, e.chatbot_pendiente = "en_configuracion", False
    e.version += 1
    db.commit()
    db.refresh(e)
    return empresa_out(db, e)
