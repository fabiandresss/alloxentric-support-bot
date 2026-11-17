"""Rendimiento de la IA de una empresa: latencia, errores, uso del modelo de respaldo y ahorro por la caché, calculado de las trazas de `usos_ia`.

Cada llamada al modelo deja una fila (tokens, costo, latencia, si funcionó y qué error dio). Una respuesta servida desde la caché deja una fila
`tipo=cache` sin tokens, así se ve cuántas veces se evitó llamar al modelo y cuánto se ahorró (a costo promedio de una respuesta).
"""
import math
from datetime import timedelta
from sqlalchemy import select
from sqlalchemy.orm import Session
from app import models as m
from app.services import cache, modelos
from app.utils import ahora

MAX_FILAS = 20000


def percentil(valores: list[int], p: float) -> int:
    if not valores:
        return 0
    v = sorted(valores)
    return v[min(len(v) - 1, max(0, math.ceil(p / 100 * len(v)) - 1))]


def resumen(db: Session, empresa: m.Empresa, dias: int = 7) -> dict:
    U = m.UsoIA
    desde = ahora() - timedelta(days=dias)
    filas = db.execute(select(U.modelo, U.tipo, U.latencia_ms, U.exito, U.error, U.respaldo, U.costo_usd)
                       .where(U.empresa_id == empresa.id, U.creado_en >= desde).limit(MAX_FILAS)).all()       # <- tenant
    llamadas = [f for f in filas if f.tipo != "cache"]
    lat = [f.latencia_ms for f in llamadas if f.exito and f.latencia_ms > 0]
    errores = [f for f in llamadas if not f.exito]
    hits = sum(1 for f in filas if f.tipo == "cache")
    costos = [float(f.costo_usd) for f in llamadas if f.tipo == "respuesta" and f.exito and float(f.costo_usd) > 0]
    por_modelo: dict[str, list] = {}
    for f in llamadas:
        por_modelo.setdefault(f.modelo, []).append(f)
    por_tipo: dict[str, int] = {}
    for f in filas:
        por_tipo[f.tipo] = por_tipo.get(f.tipo, 0) + 1
    entradas, _ = cache.estadisticas(db, empresa.id)
    return {
        "days": dias, "calls": len(llamadas), "errors": len(errores),
        "error_rate": round(len(errores) / len(llamadas) * 100, 1) if llamadas else 0.0,
        "p50_ms": percentil(lat, 50), "p95_ms": percentil(lat, 95),
        "fallbacks": sum(1 for f in llamadas if f.respaldo),
        "cache_hits": hits, "cache_entries": entradas,
        "cache_saved_usd": round(hits * (sum(costos) / len(costos)), 6) if costos else 0.0,
        "by_model": sorted([{"model_id": mid, "name": modelos.obtener(mid).nombre, "calls": len(fs), "errors": sum(1 for f in fs if not f.exito),
                             "p50_ms": percentil([f.latencia_ms for f in fs if f.exito and f.latencia_ms > 0], 50),
                             "p95_ms": percentil([f.latencia_ms for f in fs if f.exito and f.latencia_ms > 0], 95)} for mid, fs in por_modelo.items()],
                           key=lambda r: -r["calls"]),
        "by_type": [{"type": t, "count": n} for t, n in sorted(por_tipo.items(), key=lambda x: -x[1])],
        "top_errors": sorted(({"error": e, "count": sum(1 for f in errores if f.error == e)} for e in {f.error or "desconocido" for f in errores}),
                             key=lambda r: -r["count"])[:5],
    }
