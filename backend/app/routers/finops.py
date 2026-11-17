from datetime import date
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from app import models as m, schemas as s
from app.db import get_db
from app.deps import empresa_con_rol, ADMIN, GESTION_AGENTE, SUPERADMIN
from app.mappers import plan_out
from app.services import finops, rendimiento

router = APIRouter(prefix="/empresas/{slug}", tags=["finops"])


_plan = plan_out


@router.get("/finops", response_model=s.FinOpsSummary, response_model_exclude_none=True)
def resumen(desde: date | None = Query(None, description="Primer día del rango (junto con hasta); por defecto el mes en curso"),
            hasta: date | None = Query(None, description="Último día del rango, incluido"),
            modelo: str | None = Query(None, max_length=40, description="id de un modelo de GET /modelos-ia; filtra totales y gráfico"),
            agrupar: Literal["dia", "semana", "mes"] = "dia",
            e: m.Empresa = Depends(empresa_con_rol(*ADMIN)), db: Session = Depends(get_db)):
    """Consumo de IA del rango (tokens, costo, por modelo y por día/semana/mes) y estado del plan. Solo admin de la empresa y superadmin."""
    try:
        return finops.resumen(db, e, desde, hasta, modelo, agrupar)
    except ValueError as exc:
        raise HTTPException(422, str(exc))


@router.get("/ia/rendimiento", response_model=s.Performance)
def rendimiento_ia(dias: int = Query(7, ge=1, le=90), e: m.Empresa = Depends(empresa_con_rol(*GESTION_AGENTE)), db: Session = Depends(get_db)):
    """Latencia (p50/p95), errores, uso del modelo de respaldo y ahorro de la caché de las llamadas a la IA de la empresa en los últimos `dias`."""
    return rendimiento.resumen(db, e, dias)


@router.patch("/plan", response_model=s.SpendPlan, response_model_exclude_none=True)
def cambiar_plan(body: s.SpendPlanUpdate, e: m.Empresa = Depends(empresa_con_rol(*ADMIN)), db: Session = Depends(get_db)):
    """El admin de la empresa (o el superadmin) decide si el gasto del chatbot es ilimitado o tiene un tope mensual (y diario opcional)."""
    try:
        finops.aplicar_plan(e, body.mode, body.monthly_limit_usd, body.daily_limit_usd)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    e.version += 1
    db.commit()
    return _plan(e)
