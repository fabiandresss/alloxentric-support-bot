from fastapi import APIRouter, Depends
from app import models as m, schemas as s
from app.deps import requiere_rol, GESTION_AGENTE
from app.services import modelos

router = APIRouter(tags=["modelos"])


@router.get("/modelos-ia", response_model=list[s.AiModel])
def listar(u: m.Usuario = Depends(requiere_rol(*GESTION_AGENTE))):
    """Catálogo de modelos que se pueden elegir al configurar un agente. Es igual para todas las empresas (no hay datos de tenant)."""
    return [s.AiModel(id=x.id, name=x.nombre, provider=x.proveedor, provider_id=x.proveedor_id,
                      description=x.descripcion, recommended=x.recomendado) for x in modelos.CATALOGO]
