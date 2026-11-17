"""Ajustes del pipeline de ingesta y recuperación por empresa (RF de configuración del RAG).

Se guarda solo lo que la empresa cambió (`empresas.pipeline`, JSONB); lo demás usa el defecto de `config.py`.
  · chunking (`chunkMax`, `chunkMin`, `chunkOverlap`): afecta a los documentos que se ingesten desde ahora; los ya ingestados
    cambian al reprocesarlos (POST /empresas/{slug}/kb/reprocesar).
  · recuperación (`topK`, `hybrid`) y `ocr`: se aplican en el siguiente mensaje / documento.
El modelo de embeddings NO es configurable por empresa: vectores de modelos distintos no se pueden comparar.
"""
from app import config, models as m

# clave → (mínimo, máximo) de los números; los booleanos no tienen rango
LIMITES = {"chunkMax": (200, 2000), "chunkMin": (20, 500), "chunkOverlap": (0, 300), "topK": (1, 10)}
BOOLEANOS = ("hybrid", "ocr")
CLAVES = tuple(LIMITES) + BOOLEANOS


def defectos() -> dict:
    return {"chunkMax": 700, "chunkMin": 120, "chunkOverlap": 0, "topK": config.RAG_TOP_K, "hybrid": config.RAG_HIBRIDO, "ocr": True}


def guardada(empresa: m.Empresa) -> dict:
    """Solo lo que la empresa cambió, ya filtrado a claves conocidas (un JSON viejo o raro no rompe nada)."""
    raw = empresa.pipeline if isinstance(empresa.pipeline, dict) else {}
    return {k: raw[k] for k in CLAVES if k in raw}


def config_de(empresa: m.Empresa) -> dict:
    """La configuración efectiva: defectos + lo que la empresa cambió."""
    return {**defectos(), **guardada(empresa)}


def validar(cfg: dict) -> dict:
    """Devuelve la configuración limpia o levanta ValueError con un mensaje para el usuario."""
    out: dict = {}
    for k, (lo, hi) in LIMITES.items():
        v = cfg.get(k)
        if isinstance(v, bool) or not isinstance(v, int) or not lo <= v <= hi:
            raise ValueError(f"{k} debe ser un entero entre {lo} y {hi}")
        out[k] = v
    for k in BOOLEANOS:
        if not isinstance(cfg.get(k), bool):
            raise ValueError(f"{k} debe ser verdadero o falso")
        out[k] = cfg[k]
    if out["chunkMin"] >= out["chunkMax"]:
        raise ValueError("El tamaño mínimo del fragmento debe ser menor que el máximo")
    if out["chunkOverlap"] > out["chunkMax"] // 3:
        raise ValueError("El solapamiento no puede superar un tercio del tamaño máximo")
    return out
