import re
import unicodedata
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from app import models as m, schemas as s
from app.db import get_db
from app.deps import (empresa_con_rol, hash_key, nueva_api_key, requiere_rol, usuario_actual, SUPERADMIN,
                      ADMIN, GESTION_AGENTE, TODOS)
from app.deps import normalizar_dominios
from app.mappers import empresa_out
from app.services import horario, modelos, seguridad

router = APIRouter(prefix="/empresas", tags=["empresas"])


def _slug(nombre: str) -> str:
    t = unicodedata.normalize("NFD", nombre.lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-") or "empresa"


@router.get("", response_model=list[s.Company], response_model_exclude_none=True)
def listar(u: m.Usuario = Depends(requiere_rol(*TODOS)), db: Session = Depends(get_db)):
    """Superadmin: todas las empresas. Resto de roles: solo la suya."""
    q = select(m.Empresa).order_by(m.Empresa.creada_en.desc(), m.Empresa.nombre)
    if u.rol != SUPERADMIN:
        q = q.where(m.Empresa.id == u.empresa_id)
    es = db.scalars(q).all()
    return [empresa_out(db, e) for e in es]


@router.post("", response_model=s.Company, response_model_exclude_none=True, status_code=201)
def crear(body: s.CompanyCreate, _: m.Usuario = Depends(requiere_rol(SUPERADMIN)),
          db: Session = Depends(get_db)):
    if db.scalar(select(m.Empresa).where(m.Empresa.nombre == body.name)):
        raise HTTPException(409, "Ya existe una empresa con ese nombre")
    base, slug, n = _slug(body.name), _slug(body.name), 2
    while db.scalar(select(m.Empresa).where(m.Empresa.slug == slug)):
        slug, n = f"{base}-{n}", n + 1
    iniciales = body.logo_initials or "".join(w[0] for w in body.name.split())[:2].upper() or "CO"
    key = nueva_api_key()
    e = m.Empresa(
        nombre=body.name, slug=slug, industria=body.industry or "Software as a Service (SaaS)",
        api_key_hash=hash_key(key), nombre_agente=body.agent_name or f"{body.name} Assistant",
        estado_agente="en_configuracion", tono=body.tone,
        instrucciones=body.custom_instructions or
        f"Eres el asistente inteligente de {body.name}. Responde con precisión a consultas de usuarios "
        f"y deriva a Corestream si falta información en la base RAG.",
        umbral_rag=0.8, iniciales_logo=iniciales, color_marca=body.brand_color, color_fondo=body.brand_bg)
    db.add(e)
    db.commit()
    db.refresh(e)
    return empresa_out(db, e, api_key=key)


@router.get("/{slug}", response_model=s.Company, response_model_exclude_none=True)
def obtener(e: m.Empresa = Depends(empresa_con_rol(*TODOS)), db: Session = Depends(get_db)):
    return empresa_out(db, e)


@router.patch("/{slug}", response_model=s.Company, response_model_exclude_none=True)
def actualizar(body: s.CompanyUpdate, e: m.Empresa = Depends(empresa_con_rol(*GESTION_AGENTE)),
               u: m.Usuario = Depends(usuario_actual), db: Session = Depends(get_db)):
    # Los datos de la empresa (nombre, industria) los cambia solo su admin o el superadmin; el encargado
    # del agente configura el agente. Reenviar el mismo valor no cuenta como cambio.
    cambios = body.model_dump(exclude_unset=True)
    if u.rol not in ADMIN and (cambios.get("name", e.nombre) != e.nombre
                               or (cambios.get("industry", e.industria) or "") != (e.industria or "")):
        raise HTTPException(403, "Solo el admin de la empresa puede cambiar su nombre o industria")
    mapa = {"name": "nombre", "industry": "industria", "agent_name": "nombre_agente",
            "agent_status": "estado_agente", "tone": "tono", "custom_instructions": "instrucciones",
            "rag_threshold": "umbral_rag", "brand_color": "color_marca", "brand_bg": "color_fondo",
            "logo_initials": "iniciales_logo", "ai_model": "modelo_ia", "allowed_domains": "dominios_permitidos"}
    if "name" in cambios and cambios["name"] != e.nombre and db.scalar(
            select(m.Empresa).where(m.Empresa.nombre == cambios["name"])):
        raise HTTPException(409, "Ya existe una empresa con ese nombre")
    if cambios.get("allowed_domains") is not None:
        try:
            cambios["allowed_domains"] = normalizar_dominios(cambios["allowed_domains"])
        except ValueError as exc:
            raise HTTPException(422, str(exc))
    if cambios.get("agent_status") == "activo" and e.chatbot_pendiente:
        raise HTTPException(409, "Primero crea el chatbot de tu empresa")
    if cambios.get("ai_model") is not None and not modelos.existe(cambios["ai_model"]):
        raise HTTPException(422, "Modelo de IA desconocido: consulta GET /modelos-ia")
    seg, hor = cambios.pop("security", None), cambios.pop("schedule", None)
    if seg is not None:
        if u.rol not in ADMIN:    # bajar las defensas de la IA es decisión del admin, no del encargado del agente
            raise HTTPException(403, "Solo el admin de la empresa puede cambiar la configuración de seguridad de la IA")
        e.seguridad = {"pii": bool(seg["pii"]), "inyeccion": bool(seg["injection"]),
                       "temasProhibidos": seguridad.limpiar_temas(seg["forbidden_topics"]), "fuentesPublicas": seg["public_sources"]}
    if hor is not None:
        try:
            dias = horario.validar(hor["days"])
        except ValueError as exc:
            raise HTTPException(422, str(exc))
        e.horario = {"activo": bool(hor["enabled"]) and bool(dias), "dias": dias,
                     "mensajeFuera": " ".join(seguridad.limpiar(hor["out_of_hours_message"]).split())[:300]}
    if seg is not None or hor is not None:
        cambios["_cfg"] = True
    for k, v in cambios.items():
        if v is not None and k != "_cfg":
            setattr(e, mapa[k], v)          # allowed_domains=[] es válido: significa «cualquier sitio»
    if cambios:
        e.version += 1
    db.commit()
    db.refresh(e)
    return empresa_out(db, e)


@router.post("/{slug}/api-key", response_model=s.Company, response_model_exclude_none=True)
def rotar_api_key(e: m.Empresa = Depends(empresa_con_rol(*GESTION_AGENTE)), db: Session = Depends(get_db)):
    key = nueva_api_key()
    e.api_key_hash = hash_key(key)
    db.commit()
    return empresa_out(db, e, api_key=key)
