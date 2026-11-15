from datetime import date
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from app import models as m, schemas as s
from app.db import get_db
from app.deps import empresa_con_rol, ADMIN, SUPERADMIN
from app.services import finops

router = APIRouter(prefix="/empresas/{slug}", tags=["finops"])


def _plan(e: m.Empresa) -> s.SpendPlan:
    limite = float(e.limite_mensual_usd) if e.plan_gasto == "limitado" and e.limite_mensual_usd is not None else None
    diario = float(e.limite_diario_usd) if e.plan_gasto == "limitado" and e.limite_diario_usd is not None else None
    return s.SpendPlan(mode=e.plan_gasto, monthly_limit_usd=limite, daily_limit_usd=diario)


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


@router.patch("/plan", response_model=s.SpendPlan, response_model_exclude_none=True)
def cambiar_plan(body: s.SpendPlanUpdate, e: m.Empresa = Depends(empresa_con_rol(SUPERADMIN)), db: Session = Depends(get_db)):
    """Las condiciones comerciales (límite mensual o sin límite) las define solo la plataforma (superadmin)."""
    if body.mode == "limitado" and body.monthly_limit_usd is None:
        raise HTTPException(422, "El plan limitado necesita un monto mensual (monthlyLimitUsd)")
    if body.mode == "limitado" and body.daily_limit_usd is not None and body.daily_limit_usd > body.monthly_limit_usd:
        raise HTTPException(422, "El límite diario no puede superar al mensual")
    e.plan_gasto = body.mode
    e.limite_mensual_usd = body.monthly_limit_usd if body.mode == "limitado" else None
    e.limite_diario_usd = body.daily_limit_usd if body.mode == "limitado" else None
    e.version += 1
    db.commit()
    return _plan(e)
