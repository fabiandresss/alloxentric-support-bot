"""Formato de fechas/tamaños en el estilo que espera el front."""
from datetime import datetime, timezone
from app.config import TZ

MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]


def ahora() -> datetime:
    return datetime.now(timezone.utc)


def tiempo_relativo(dt: datetime) -> str:
    seg = max(0, int((ahora() - dt).total_seconds()))
    if seg < 60:
        return "hace un momento"
    m = seg // 60
    if m < 60:
        return f"hace {m} minuto{'s' if m != 1 else ''}"
    h = m // 60
    if h < 24:
        return f"hace {h} hora{'s' if h != 1 else ''}"
    d = h // 24
    return f"hace {d} día{'s' if d != 1 else ''}"


def fecha_corta(dt: datetime) -> str:
    l = dt.astimezone(TZ)
    return f"{l.day:02d} {MESES[l.month - 1]} {l.year}"


def hora(dt: datetime) -> str:
    return dt.astimezone(TZ).strftime("%H:%M")


def fecha_exacta(dt: datetime) -> str:
    l = dt.astimezone(TZ)
    if l.date() == datetime.now(TZ).date():
        return f"Hoy a las {l:%H:%M}"
    return f"{l.day:02d} {MESES[l.month - 1]} a las {l:%H:%M}"


def tamano(n: int) -> str:
    if n >= 1024 * 1024:
        return f"{n / 1024 / 1024:.1f} MB"
    return f"{max(1, round(n / 1024))} KB"
