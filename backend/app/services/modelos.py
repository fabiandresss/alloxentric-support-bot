"""Catálogo de modelos de IA que una empresa puede elegir para su agente. Todos se invocan por AWS Bedrock (API Converse),
que sigue siendo el único servicio externo (regla 6 del CLAUDE.md): cambiar de modelo no cambia de proveedor de nube.

El id público (`id`) es el que se guarda en `empresas.modelo_ia` y viaja por la API; el id de Bedrock no sale del backend.
Los IDs se probaron en vivo (us-east-1, perfil `chatbot`) con una pregunta con respuesta y otra sin ella (debe contestar NO_SE).
"""
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from app.config import BEDROCK_MODEL_ID, BEDROCK_RESPALDO


@dataclass(frozen=True)
class Modelo:
    id: str
    nombre: str
    proveedor: str          # nombre visible de la empresa que lo creó
    proveedor_id: str       # clave del logo en el front: anthropic | openai | amazon | deepseek | qwen
    bedrock_id: str
    descripcion: str
    recomendado: bool = False
    razona: bool = False    # gasta tokens "pensando" antes de responder: se le da más margen de salida
    # USD por millón de tokens (entrada / salida). REFERENCIALES: confirmar contra la tabla de precios de Bedrock antes de cobrar.
    precio_entrada: float = 0.0
    precio_salida: float = 0.0


DEFECTO = "haiku-5-5"

CATALOGO: tuple[Modelo, ...] = (
    Modelo("haiku-5-5", "Claude Haiku 5.5", "Anthropic", "anthropic", BEDROCK_MODEL_ID,
           "Rápido y muy fiel a la documentación. El mejor equilibrio para soporte.", recomendado=True,
           precio_entrada=1.00, precio_salida=5.00),
    Modelo("gpt-oss-20b", "GPT-OSS 20B", "OpenAI", "openai", "openai.gpt-oss-20b-1:0",
           "Modelo abierto de OpenAI, muy económico. Razona antes de responder.", razona=True,
           precio_entrada=0.07, precio_salida=0.30),
    Modelo("nova-lite", "Nova Lite", "Amazon", "amazon", "us.amazon.nova-lite-v1:0",
           "El más veloz y barato de Amazon. Respuestas más escuetas.",
           precio_entrada=0.06, precio_salida=0.24),
    Modelo("deepseek-v3-2", "DeepSeek V3.2", "DeepSeek", "deepseek", "deepseek.v3.2",
           "Modelo chino de uso general, buena relación calidad-precio.",
           precio_entrada=0.62, precio_salida=1.85),
    Modelo("qwen3-32b", "Qwen3 32B", "Qwen (Alibaba)", "qwen", "qwen.qwen3-32b-v1:0",
           "Modelo chino abierto, económico y muy rápido.",
           precio_entrada=0.15, precio_salida=0.60),
)
_POR_ID = {m.id: m for m in CATALOGO}


def existe(modelo_id: str) -> bool:
    return modelo_id in _POR_ID


def obtener(modelo_id: str | None) -> Modelo:
    """El modelo pedido, o el de por defecto si es desconocido (p. ej. uno retirado del catálogo)."""
    return _POR_ID.get(modelo_id or "", _POR_ID[DEFECTO])


def costo_usd(modelo: Modelo, tokens_entrada: int, tokens_salida: int) -> float:
    return (tokens_entrada * modelo.precio_entrada + tokens_salida * modelo.precio_salida) / 1_000_000


_forzado: ContextVar[str | None] = ContextVar("modelo_forzado", default=None)


@contextmanager
def forzando(modelo_id: str | None):
    """Dentro del bloque el agente usa `modelo_id` en vez del configurado en la empresa (comparar modelos con un golden set)
    sin tocar la configuración real ni cambiar las firmas del motor RAG."""
    token = _forzado.set(modelo_id)
    try:
        yield
    finally:
        _forzado.reset(token)


def del_agente(empresa) -> Modelo:
    """El modelo con el que responde el agente de la empresa (o el forzado por una comparativa)."""
    return obtener(_forzado.get() or empresa.modelo_ia)


def respaldo_de(modelo: Modelo) -> Modelo | None:
    """El modelo que responde si el de la empresa falla (BEDROCK_RESPALDO; si es el mismo, el recomendado). None = sin respaldo."""
    if not BEDROCK_RESPALDO:
        return None
    r = _POR_ID.get(BEDROCK_RESPALDO)
    if r is None or r.id == modelo.id:
        r = _POR_ID[DEFECTO] if modelo.id != DEFECTO else next((x for x in CATALOGO if x.id != modelo.id), None)
    return r
