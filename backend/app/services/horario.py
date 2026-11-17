"""Horario de atención humana de cada empresa. Fuera de horario el bot sigue respondiendo y, si deriva, el ticket se crea igual:
el cliente recibe un aviso de cuándo lo atenderá una persona.

Se guarda en `empresas.horario`: {"activo": bool, "dias": {"lun": ["09:00", "18:00"], ...}, "mensajeFuera": str}.
Un día que no aparece en `dias` es día sin atención. Las horas son de la zona horaria de la plataforma (APP_TZ).
"""
import re
from datetime import datetime
from app import models as m
from app.config import TZ

DIAS = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"]
NOMBRES = {"lun": "lunes", "mar": "martes", "mie": "miércoles", "jue": "jueves", "vie": "viernes", "sab": "sábado", "dom": "domingo"}
MENSAJE_DEFECTO = ("Ahora estamos fuera del horario de atención humana. Tu consulta quedó registrada y un agente te responderá "
                   "apenas volvamos a atender.")
_HORA = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def config_de(empresa: m.Empresa) -> dict:
    raw = getattr(empresa, "horario", None) or {}
    dias = {}
    for d in DIAS:
        v = (raw.get("dias") or {}).get(d)
        if isinstance(v, (list, tuple)) and len(v) == 2 and _HORA.match(str(v[0])) and _HORA.match(str(v[1])) and str(v[0]) < str(v[1]):
            dias[d] = [str(v[0]), str(v[1])]
    msg = " ".join(str(raw.get("mensajeFuera") or "").split())[:300] or MENSAJE_DEFECTO
    return {"activo": bool(raw.get("activo")) and bool(dias), "dias": dias, "mensajeFuera": msg}


def validar(dias: dict[str, list[str]]) -> dict[str, list[str]]:
    """Valida lo que envía el panel; lanza ValueError con un mensaje legible."""
    out = {}
    for d, v in (dias or {}).items():
        if d not in DIAS:
            raise ValueError(f"Día inválido: {d}")
        if len(v) != 2 or not _HORA.match(v[0]) or not _HORA.match(v[1]):
            raise ValueError(f"Horario inválido para {NOMBRES[d]}: usa HH:MM")
        if v[0] >= v[1]:
            raise ValueError(f"En {NOMBRES[d]} la hora de inicio debe ser anterior a la de término")
        out[d] = [v[0], v[1]]
    return out


def abierto(empresa: m.Empresa, ahora: datetime | None = None) -> bool:
    cfg = config_de(empresa)
    if not cfg["activo"]:
        return True                      # sin horario configurado se asume atención continua
    ahora = (ahora or datetime.now(TZ)).astimezone(TZ)
    franja = cfg["dias"].get(DIAS[ahora.weekday()])
    return bool(franja) and franja[0] <= ahora.strftime("%H:%M") < franja[1]


def resumen_texto(empresa: m.Empresa) -> str | None:
    """«Lun–Vie 09:00–18:00» agrupando días consecutivos con la misma franja; None si no hay horario."""
    cfg = config_de(empresa)
    if not cfg["activo"]:
        return None
    grupos: list[list] = []
    for d in DIAS:
        f = cfg["dias"].get(d)
        if not f:
            continue
        if grupos and grupos[-1][2] == f and DIAS.index(grupos[-1][1]) == DIAS.index(d) - 1:
            grupos[-1][1] = d
        else:
            grupos.append([d, d, f])
    corto = {k: v[:3].capitalize() for k, v in NOMBRES.items()}
    partes = [(corto[a] if a == b else f"{corto[a]}–{corto[b]}") + f" {f[0]}–{f[1]}" for a, b, f in grupos]
    return " · ".join(partes)


def estado(empresa: m.Empresa) -> dict:
    """Lo que ve el cliente en el chat: si hoy hay atención humana, el horario y el aviso para fuera de horario."""
    cfg = config_de(empresa)
    return {"enabled": cfg["activo"], "open": abierto(empresa), "schedule": resumen_texto(empresa),
            "message": None if abierto(empresa) else cfg["mensajeFuera"]}
