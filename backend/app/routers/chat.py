from fastapi import APIRouter, Depends
from app.ratelimit import limite
from sqlalchemy.orm import Session
from app import models as m, schemas as s
from app.db import get_db
from app.deps import empresa_por_api_key, empresa_con_rol, GESTION_AGENTE
from app.services.chat import procesar_mensaje
from fastapi import HTTPException

router = APIRouter(tags=["chat"])


@router.post("/chat", response_model=s.ChatResponse, response_model_exclude_none=True,
             dependencies=[Depends(limite("api_chat", 120, 60))])
def chat_widget(body: s.ChatRequest, e: m.Empresa = Depends(empresa_por_api_key),
                db: Session = Depends(get_db)):
    """Endpoint del widget embebido: el tenant sale de la API key (header X-API-Key)."""
    if e.estado_agente != "activo":
        raise HTTPException(403, "El agente de esta empresa no está activo")
    return procesar_mensaje(db, e, body)


@router.post("/empresas/{slug}/probar", response_model=s.ChatResponse, response_model_exclude_none=True)
def chat_probar(body: s.ChatRequest, e: m.Empresa = Depends(empresa_con_rol(*GESTION_AGENTE)),
                db: Session = Depends(get_db)):
    """Simulador del panel de administración (no exige agente activo ni API key)."""
    return procesar_mensaje(db, e, body)
