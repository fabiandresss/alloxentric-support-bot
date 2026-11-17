"""Cliente de AWS Bedrock (API Converse). Único servicio externo del proyecto (regla 6 del CLAUDE.md).

Se usa solo si BEDROCK_HABILITADO=true. Las credenciales salen del perfil de AWS CLI (AWS_PROFILE) o de la cadena por defecto
de boto3; nunca van en el código ni en .env. Ante cualquier falla (sin habilitar, sin credenciales, sin red, timeout, respuesta
rara) devuelve None y el motor RAG responde de forma extractiva con el fragmento, así el chat no se cae. Al LLM solo se le
envían los fragmentos recuperados DE LA EMPRESA que consulta y la pregunta del cliente, nunca documentos de otras empresas.

Cada llamada deja una traza (`Uso`): tokens, latencia, si funcionó y de qué tipo fue el error; alimenta el panel FinOps y el de rendimiento.
"""
import logging
import time
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Iterator
from app.config import AWS_PROFILE, AWS_REGION, BEDROCK_HABILITADO, BEDROCK_MODEL_ID
from app.services.modelos import Modelo

log = logging.getLogger("rag.llm")
_cliente = None


@dataclass
class Uso:
    """Traza de una llamada al modelo (tokens y latencia los informa Bedrock / se miden aquí). Alimenta FinOps y el panel de rendimiento."""
    modelo: str | None      # id del catálogo; None si se usó BEDROCK_MODEL_ID sin modelo de empresa
    tipo: str               # respuesta | sugerencia | resumen | memoria | ocr | cache
    entrada: int
    salida: int
    latencia_ms: int = 0
    exito: bool = True
    error: str | None = None
    respaldo: bool = False  # la respondió el modelo de respaldo porque el de la empresa falló


_captura: ContextVar[list | None] = ContextVar("llm_captura", default=None)


@contextmanager
def capturando():
    """Junta los `Uso` de todas las llamadas hechas dentro del bloque (services/chat.py los guarda con su conversación)."""
    usos: list[Uso] = []
    token = _captura.set(usos)
    try:
        yield usos
    finally:
        _captura.reset(token)


def anotar(uso: Uso) -> None:
    """Agrega una traza a la captura en curso (también para eventos que no llaman al modelo, como un acierto de la caché)."""
    usos = _captura.get()
    if usos is not None:
        usos.append(uso)


def disponible() -> bool:
    return bool(BEDROCK_HABILITADO)


def _bedrock(timeout: float):
    """Cliente bedrock-runtime, creado la primera vez que se necesita (boto3 no se carga si Bedrock está apagado)."""
    global _cliente
    if _cliente is None:
        import boto3
        from botocore.config import Config
        sesion = boto3.Session(profile_name=AWS_PROFILE or None, region_name=AWS_REGION)
        _cliente = sesion.client("bedrock-runtime", config=Config(
            read_timeout=timeout, connect_timeout=5, retries={"max_attempts": 2, "mode": "standard"}))
    return _cliente


def _uso(modelo: Modelo | None, tipo: str, r: dict | None, t0: float, respaldo: bool, error: Exception | None = None) -> Uso:
    u = (r or {}).get("usage") or {}
    return Uso(modelo.id if modelo else None, tipo, int(u.get("inputTokens", 0)), int(u.get("outputTokens", 0)),
               latencia_ms=int((time.monotonic() - t0) * 1000), exito=error is None,
               error=error.__class__.__name__[:60] if error else None, respaldo=respaldo)


def generar(sistema: str, usuario: str, temperatura: float | None = None, max_tokens: int = 500, timeout: float = 20.0,
            modelo: Modelo | None = None, tipo: str = "respuesta", respaldo: bool = False) -> str | None:
    """`modelo` es el del catálogo que eligió la empresa; sin él se usa BEDROCK_MODEL_ID. `temperatura` se ignora a propósito.
    `respaldo` solo marca la traza: quién decide usar un modelo de respaldo es el motor RAG."""
    if not disponible():
        return None
    t0 = time.monotonic()
    try:
        # los modelos que razonan gastan parte de la salida "pensando": con el tope normal podrían quedar sin respuesta
        tope = max_tokens * 3 if modelo and modelo.razona else max_tokens
        r = _bedrock(timeout).converse(
            modelId=modelo.bedrock_id if modelo else BEDROCK_MODEL_ID,
            system=[{"text": sistema}],
            messages=[{"role": "user", "content": [{"text": usuario}]}],
            inferenceConfig={"maxTokens": tope})   # Haiku 5.5 rechaza `temperature` (deprecado), por eso no se envía
        anotar(_uso(modelo, tipo, r, t0, respaldo))   # costo: se paga aunque la respuesta salga vacía, por eso se anota antes de leerla
        partes = r["output"]["message"]["content"]
        texto = "".join(p.get("text", "") for p in partes).strip()
        return texto or None
    except Exception as exc:   # noqa: BLE001 — cualquier falla degrada a la respuesta extractiva
        anotar(_uso(modelo, tipo, None, t0, respaldo, exc))
        log.warning("Bedrock no respondió (%s); se usa la respuesta extractiva o el modelo de respaldo", exc.__class__.__name__)
        return None


def generar_stream(sistema: str, usuario: str, max_tokens: int = 500, timeout: float = 30.0, modelo: Modelo | None = None,
                   tipo: str = "respuesta") -> Iterator[str]:
    """Igual que `generar` pero entrega el texto a medida que el modelo lo escribe (API ConverseStream). Si falla antes de empezar no
    entrega nada y deja la traza del error; si se corta a la mitad, entrega lo que alcanzó."""
    if not disponible():
        return
    t0 = time.monotonic()
    entrada = salida = 0
    try:
        tope = max_tokens * 3 if modelo and modelo.razona else max_tokens
        r = _bedrock(timeout).converse_stream(
            modelId=modelo.bedrock_id if modelo else BEDROCK_MODEL_ID,
            system=[{"text": sistema}], messages=[{"role": "user", "content": [{"text": usuario}]}],
            inferenceConfig={"maxTokens": tope})
        for ev in r["stream"]:
            if "contentBlockDelta" in ev:
                trozo = (ev["contentBlockDelta"].get("delta") or {}).get("text")
                if trozo:
                    yield trozo
            elif "metadata" in ev:
                u = ev["metadata"].get("usage") or {}
                entrada, salida = int(u.get("inputTokens", 0)), int(u.get("outputTokens", 0))
        anotar(Uso(modelo.id if modelo else None, tipo, entrada, salida, latencia_ms=int((time.monotonic() - t0) * 1000)))
    except Exception as exc:   # noqa: BLE001
        anotar(Uso(modelo.id if modelo else None, tipo, entrada, salida, latencia_ms=int((time.monotonic() - t0) * 1000),
                   exito=False, error=exc.__class__.__name__[:60]))
        log.warning("Bedrock (stream) no respondió (%s)", exc.__class__.__name__)


def transcribir(imagen_png: bytes, modelo: Modelo, instruccion: str, timeout: float = 60.0) -> str | None:
    """Pasa una imagen (una página escaneada) a texto con un modelo de visión de Bedrock. Es OCR: cuesta tokens y se registra como tal."""
    if not disponible():
        return None
    t0 = time.monotonic()
    try:
        r = _bedrock(timeout).converse(
            modelId=modelo.bedrock_id,
            messages=[{"role": "user", "content": [{"image": {"format": "png", "source": {"bytes": imagen_png}}}, {"text": instruccion}]}],
            inferenceConfig={"maxTokens": 2500})
        anotar(_uso(modelo, "ocr", r, t0, False))
        texto = "".join(p.get("text", "") for p in r["output"]["message"]["content"]).strip()
        return texto or None
    except Exception as exc:   # noqa: BLE001
        anotar(_uso(modelo, "ocr", None, t0, False, exc))
        log.warning("OCR con Bedrock falló (%s)", exc.__class__.__name__)
        return None
