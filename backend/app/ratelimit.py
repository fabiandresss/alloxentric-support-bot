"""Límite de peticiones (rate limiting) para los endpoints sin sesión: chat público, widget y login.

Ventana deslizante en memoria, sin dependencias ni servicios externos. Es **por proceso**: con varios workers de
uvicorn cada uno cuenta aparte (suficiente para el despliegue local de un solo proceso; si se escala, se mueve a Redis,
que ya está en docker-compose). La clave siempre incluye la IP del cliente, así que un abusador no bloquea a los demás.

Con RATELIMIT_BACKEND=redis los contadores viven en Redis y se comparten entre procesos y reinicios (varios workers de uvicorn, o
varias réplicas). Si Redis no responde se vuelve a la memoria del proceso (nunca se deja pasar todo ni se cae el endpoint) y se avisa en el log.

Se desactiva con RATE_LIMIT_ENABLED=false. Detrás de un proxy de confianza, TRUST_PROXY_HEADERS=true usa X-Forwarded-For.
"""
import math
import threading
import time
from collections import deque
from typing import Callable
from fastapi import HTTPException, Request
import logging
import uuid
from app.config import RATE_LIMIT_ENABLED, RATELIMIT_BACKEND, REDIS_URL, TRUST_PROXY_HEADERS

log = logging.getLogger("ratelimit")

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


class VentanaRedis:
    """Ventana deslizante en Redis (un conjunto ordenado por clave). Misma interfaz que VentanaDeslizante."""
    def __init__(self, cliente, prefijo: str = "rl:"):
        self._r, self._p = cliente, prefijo

    def permitir(self, clave: str, maximo: int, ventana: int) -> tuple[bool, int]:
        k, ahora = self._p + clave, time.time()
        pipe = self._r.pipeline()
        pipe.zremrangebyscore(k, 0, ahora - ventana)
        pipe.zcard(k)
        pipe.zrange(k, 0, 0, withscores=True)
        _, n, primero = pipe.execute()
        if n >= maximo:
            return False, max(1, math.ceil((primero[0][1] if primero else ahora) + ventana - ahora))
        pipe = self._r.pipeline()
        pipe.zadd(k, {f"{ahora}-{uuid.uuid4().hex[:8]}": ahora})
        pipe.expire(k, ventana + 1)
        pipe.execute()
        return True, 0

    def reset(self) -> None:
        for k in self._r.scan_iter(self._p + "*"):
            self._r.delete(k)


class ConRespaldo:
    """Usa Redis; si falla, la memoria del proceso (y lo avisa una sola vez por caída)."""
    def __init__(self, principal, respaldo: VentanaDeslizante):
        self._a, self._b, self._avisado = principal, respaldo, False

    def permitir(self, clave: str, maximo: int, ventana: int) -> tuple[bool, int]:
        try:
            r = self._a.permitir(clave, maximo, ventana)
            self._avisado = False
            return r
        except Exception as exc:   # noqa: BLE001 — cualquier falla de Redis degrada a memoria
            if not self._avisado:
                log.warning("Redis no responde (%s): el límite de peticiones usa la memoria del proceso", exc.__class__.__name__)
                self._avisado = True
            return self._b.permitir(clave, maximo, ventana)

    def reset(self) -> None:
        self._b.reset()
        try:
            self._a.reset()
        except Exception:   # noqa: BLE001
            pass


def usar_redis(cliente) -> None:
    """Cambia a Redis con ese cliente (lo usa el arranque con RATELIMIT_BACKEND=redis y las pruebas)."""
    global _ventanas
    _ventanas = ConRespaldo(VentanaRedis(cliente), VentanaDeslizante())


def _crear():
    if RATELIMIT_BACKEND == "redis":
        try:
            import redis
            return ConRespaldo(VentanaRedis(redis.Redis.from_url(REDIS_URL, socket_timeout=0.3, socket_connect_timeout=0.3)), VentanaDeslizante())
        except Exception as exc:   # noqa: BLE001
            log.warning("No se pudo preparar Redis para el límite de peticiones (%s): se usa la memoria", exc.__class__.__name__)
    return VentanaDeslizante()


_ventanas = _crear()


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
