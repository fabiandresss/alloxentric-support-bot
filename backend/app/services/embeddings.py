"""Embeddings de texto (RF-04): convierten fragmentos y preguntas en vectores de EMBED_DIM (384) para la búsqueda por similitud.

Dos backends, elegidos con EMBEDDINGS_BACKEND:

* `sentence-transformers` (por defecto): `paraphrase-multilingual-MiniLM-L12-v2`, multilingüe, 384 dimensiones, corre en local (CPU).
  La primera vez descarga el modelo (~470 MB) a la caché de Hugging Face; después funciona sin conexión.
* `hash`: embedder determinista por palabras (sin modelo ni descargas). Solo captura coincidencia léxica; sirve para las pruebas, para
  CI y como respaldo si el modelo no se puede cargar. NO es comparable con el anterior: por eso cada fragmento guarda el `id` del
  embedder que lo generó y la búsqueda solo usa fragmentos del embedder activo (se regeneran con `python reindexar.py`).

Cada embedder declara `sim_min`/`sim_max`: el rango de similitud coseno que se mapea a confianza 0..1 (ver motor_rag.confianza_de).
"""
import hashlib
import logging
import re
import threading
import unicodedata
from typing import Protocol
from app.config import EMBEDDINGS_BACKEND, EMBEDDING_MODEL

log = logging.getLogger("rag.embeddings")
DIM = 384  # = models.EMBED_DIM (se valida al guardar); no se importa models aquí para evitar ciclos

_STOP = frozenset("""
a al algo ante con contra cual cuando de del desde donde e el ella ellos en entre es esa ese eso esta este esto
fue ha han hay la las le les lo los me mi mis muy ni no nos o para pero por que se si sin sobre son su sus te
tu tus un una uno y ya yo mas como puedo puede quiero necesito cuanto cuantos cuanta cuantas cual cuales
""".split())


class Embedder(Protocol):
    id: str
    sim_min: float
    sim_max: float

    def embed(self, textos: list[str]) -> list[list[float]]: ...


def _normalizar(texto: str) -> list[str]:
    t = unicodedata.normalize("NFD", texto.lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return [w for w in re.findall(r"[a-z0-9]+", t) if len(w) > 2 and w not in _STOP]


class HashingEmbedder:
    """Bolsa de palabras con hashing a DIM dimensiones (con raíz recortada a 5 letras para unir singular/plural)."""
    id = "hash-v1"
    # calibrado con calidad_rag/evaluar.py --backend hash: respaldo conservador (AUC 0.80), responde poco y deriva
    sim_min, sim_max = 0.05, 0.30

    def embed(self, textos: list[str]) -> list[list[float]]:
        return [self._uno(t) for t in textos]

    def _uno(self, texto: str) -> list[float]:
        v = [0.0] * DIM
        for w in _normalizar(texto):
            h = int.from_bytes(hashlib.blake2b(w[:5].encode(), digest_size=8).digest(), "big")
            v[h % DIM] += 1.0 if (h >> 63) & 1 else -1.0
        n = sum(x * x for x in v) ** 0.5
        return [x / n for x in v] if n else v


class SentenceTransformerEmbedder:
    # Calibrado con calidad_rag/evaluar.py (45 preguntas, AUC 0.93): el ruido y lo no documentado quedan en 0.1–0.3 y lo
    # relevante en 0.45–0.65. Con este rango, el umbral por defecto (0.8) equivale a una similitud ≈0.46 (corte de Youden).
    sim_min, sim_max = 0.25, 0.51

    def __init__(self, nombre: str):
        from sentence_transformers import SentenceTransformer   # import perezoso: es pesado
        self._modelo = SentenceTransformer(nombre)
        self.id = f"st:{nombre}"
        medir = getattr(self._modelo, "get_embedding_dimension", None) or self._modelo.get_sentence_embedding_dimension
        dim = medir()
        if dim != DIM:
            raise RuntimeError(f"El modelo {nombre} produce {dim} dimensiones y la BD espera {DIM} (cambia EMBED_DIM y migra)")

    def embed(self, textos: list[str]) -> list[list[float]]:
        if not textos:
            return []
        return self._modelo.encode(textos, batch_size=32, normalize_embeddings=True,
                                   show_progress_bar=False).tolist()


_lock = threading.Lock()
_activo: Embedder | None = None
_degradado = False   # True si se pidió el modelo y no se pudo cargar (se usa el respaldo léxico)


def get_embedder() -> Embedder:
    global _activo, _degradado
    if _activo is None:
        with _lock:
            if _activo is None:
                if EMBEDDINGS_BACKEND == "hash":
                    _activo = HashingEmbedder()
                else:
                    try:
                        _activo = SentenceTransformerEmbedder(EMBEDDING_MODEL)
                    except Exception as exc:   # sin paquete, sin modelo en caché ni red, etc.
                        log.warning("No se pudo cargar el modelo de embeddings %r (%s). Se usa el respaldo léxico "
                                    "'hash': la calidad de las respuestas BAJA. Revisa la instalación o usa "
                                    "EMBEDDINGS_BACKEND=hash de forma explícita.", EMBEDDING_MODEL, exc)
                        _activo, _degradado = HashingEmbedder(), True
    return _activo


def reset() -> None:
    """Para las pruebas: vuelve a elegir el embedder según la configuración."""
    global _activo, _degradado
    with _lock:
        _activo, _degradado = None, False


def estado() -> dict:
    """Para /health: no carga el modelo si todavía no se usó."""
    return {"backend": EMBEDDINGS_BACKEND, "modelo": EMBEDDING_MODEL if EMBEDDINGS_BACKEND != "hash" else None,
            "activo": _activo.id if _activo else None, "degradado": _degradado}
