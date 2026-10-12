"""Límite de peticiones (rate limiting) para los endpoints sin sesión: chat público, widget y login.

Ventana deslizante en memoria, sin dependencias ni servicios externos. Es **por proceso**: con varios workers de
uvicorn cada uno cuenta aparte (suficiente para el despliegue local de un solo proceso; si se escala, se mueve a Redis,
que ya está en docker-compose). La clave siempre incluye la IP del cliente, así que un abusador no bloquea a los demás.

Se desactiva con RATE_LIMIT_ENABLED=false. Detrás de un proxy de confianza, TRUST_PROXY_HEADERS=true usa X-Forwarded-For.
"""
import math
import threading
import time
from collections import deque
from typing import Callable
from fastapi import HTTPException, Request
from app.config import RATE_LIMIT_ENABLED, TRUST_PROXY_HEADERS

_MAX_CLAVES = 20000   # tope de memoria: al superarlo se purgan las ventanas vencidas


class VentanaDeslizante:
    def __init__(self, reloj: Callable[[], float] = time.monotonic):
        self._reloj = reloj
        self._lock = threading.Lock()
        self._claves: dict[str, tuple[deque, int]] = {}

    def permitir(self, clave: str, maximo: int, ventana: int) -> tuple[bool, int]:
        """(permitido, segundos hasta poder reintentar). Registra la petición solo si se permite."""
        ahora = self._reloj()
        with self._lock:
            if len(self._claves) > _MAX_CLAVES:
                self._purgar(ahora)
            marcas, _ = self._claves.setdefault(clave, (deque(), ventana))
            while marcas and marcas[0] <= ahora - ventana:
                marcas.popleft()
            if len(marcas) >= maximo:
                return False, max(1, math.ceil(marcas[0] + ventana - ahora))
            marcas.append(ahora)
            self._claves[clave] = (marcas, ventana)
            return True, 0

    def _purgar(self, ahora: float) -> None:
        for k in [k for k, (m, v) in self._claves.items() if not m or m[-1] <= ahora - v]:
            del self._claves[k]

    def reset(self) -> None:
        with self._lock:
            self._claves.clear()


_ventanas = VentanaDeslizante()


def reset() -> None:
    """Para las pruebas: cada una parte con los contadores en cero."""
    _ventanas.reset()


def ip_cliente(request: Request) -> str:
    if TRUST_PROXY_HEADERS:
        xff = request.headers.get("x-forwarded-for")
        if xff:
            return xff.split(",")[0].strip()
    return request.client.host if request.client else "desconocida"


def verificar(request: Request, nombre: str, maximo: int, ventana: int = 60, extra: str = "") -> None:
    """Lanza 429 (con Retry-After) si esta IP superó `maximo` peticiones en `ventana` segundos para ese `nombre`+`extra`."""
    if not RATE_LIMIT_ENABLED:
        return
    ok, espera = _ventanas.permitir(f"{nombre}|{ip_cliente(request)}|{extra}", maximo, ventana)
    if not ok:
        raise HTTPException(429, f"Demasiadas solicitudes. Intenta de nuevo en {espera} s.",
                            headers={"Retry-After": str(espera)})


def limite(nombre: str, maximo: int, ventana: int = 60, por: tuple[str, ...] = ()):
    """Dependencia para un endpoint: cuenta por IP y por los parámetros de ruta indicados (p. ej. slug)."""
    def dep(request: Request) -> None:
        verificar(request, nombre, maximo, ventana, ":".join(str(request.path_params.get(p, "")) for p in por))
    return dep
