"""Cliente de AWS Bedrock (API Converse). Único servicio externo del proyecto (regla 6 del CLAUDE.md).

Se usa solo si BEDROCK_HABILITADO=true. Las credenciales salen del perfil de AWS CLI (AWS_PROFILE) o de la cadena por defecto
de boto3; nunca van en el código ni en .env. Ante cualquier falla (sin habilitar, sin credenciales, sin red, timeout, respuesta
rara) devuelve None y el motor RAG responde de forma extractiva con el fragmento, así el chat no se cae. Al LLM solo se le
envían los fragmentos recuperados DE LA EMPRESA que consulta y la pregunta del cliente, nunca documentos de otras empresas.
"""
import logging
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from app.config import AWS_PROFILE, AWS_REGION, BEDROCK_HABILITADO, BEDROCK_MODEL_ID
from app.services.modelos import Modelo

log = logging.getLogger("rag.llm")
_cliente = None


@dataclass
class Uso:
    """Tokens de una llamada al modelo (los informa Bedrock en `usage`). Alimenta el panel FinOps."""
    modelo: str | None      # id del catálogo; None si se usó BEDROCK_MODEL_ID sin modelo de empresa
    tipo: str               # respuesta | sugerencia
    entrada: int
    salida: int


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


def generar(sistema: str, usuario: str, temperatura: float | None = None, max_tokens: int = 500, timeout: float = 20.0,
            modelo: Modelo | None = None, tipo: str = "respuesta") -> str | None:
    """`modelo` es el del catálogo que eligió la empresa; sin él se usa BEDROCK_MODEL_ID. `temperatura` se ignora a propósito."""
    if not disponible():
        return None
    try:
        # los modelos que razonan gastan parte de la salida "pensando": con el tope normal podrían quedar sin respuesta
        tope = max_tokens * 3 if modelo and modelo.razona else max_tokens
        r = _bedrock(timeout).converse(
            modelId=modelo.bedrock_id if modelo else BEDROCK_MODEL_ID,
            system=[{"text": sistema}],
            messages=[{"role": "user", "content": [{"text": usuario}]}],
            inferenceConfig={"maxTokens": tope})   # Haiku 5.5 rechaza `temperature` (deprecado), por eso no se envía
        usos = _captura.get()
        if usos is not None:   # costo: se paga aunque la respuesta salga vacía, por eso se anota antes de leerla
            u = r.get("usage") or {}
            usos.append(Uso(modelo.id if modelo else None, tipo, int(u.get("inputTokens", 0)), int(u.get("outputTokens", 0))))
        partes = r["output"]["message"]["content"]
        texto = "".join(p.get("text", "") for p in partes).strip()
        return texto or None
    except Exception as exc:   # noqa: BLE001 — cualquier falla degrada a la respuesta extractiva
        log.warning("Bedrock no respondió (%s); se usa la respuesta extractiva", exc.__class__.__name__)
        return None
