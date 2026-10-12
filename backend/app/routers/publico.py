"""Chat público por slug (RF-29): lo usa la página /chat/{slug} y el iframe del widget embebible.

No lleva autenticación: el slug de la ruta identifica a la empresa (es el mismo que expone `webChatUrl`).
Solo responde si el agente está `activo` y solo devuelve datos de marca, nunca documentos ni API keys.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app import models as m, schemas as s
from app.db import get_db
from app.deps import empresa_por_slug
from app.services.chat import procesar_mensaje

router = APIRouter(prefix="/publico", tags=["publico"])


@router.get("/{slug}", response_model=s.PublicAgent)
def agente_publico(e: m.Empresa = Depends(empresa_por_slug)):
    """Datos mínimos para pintar el chat (nombre, marca y si el agente está disponible)."""
    return s.PublicAgent(
        name=e.nombre, agent_name=e.nombre_agente or f"{e.nombre} Assistant",
        logo_initials=e.iniciales_logo or e.nombre[:2].upper(),
        brand_color=e.color_marca or "#4F46E5", brand_bg=e.color_fondo or "#EEF2FF",
        agent_status=e.estado_agente)


@router.post("/{slug}/chat", response_model=s.ChatResponse, response_model_exclude_none=True)
def chat_publico(body: s.ChatRequest, e: m.Empresa = Depends(empresa_por_slug),
                 db: Session = Depends(get_db)):
    if e.estado_agente != "activo":
        raise HTTPException(403, "El agente de esta empresa no está activo")
    return procesar_mensaje(db, e, body)
