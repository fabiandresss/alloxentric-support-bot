"""Cliente de DeepSeek (API compatible con OpenAI). Único servicio externo del proyecto (regla 6 del CLAUDE.md).

Se usa solo si hay DEEPSEEK_API_KEY. Ante cualquier falla (sin clave, sin red, timeout, respuesta rara) devuelve None y el
motor RAG responde de forma extractiva con el fragmento, así el chat no se cae. Al LLM solo se le envían los fragmentos
recuperados DE LA EMPRESA que consulta y la pregunta del cliente, nunca documentos de otras empresas.
"""
import logging
import httpx
from app.config import DEEPSEEK_API_KEY, DEEPSEEK_MODEL, DEEPSEEK_URL

log = logging.getLogger("rag.llm")


def disponible() -> bool:
    return bool(DEEPSEEK_API_KEY)


def generar(sistema: str, usuario: str, temperatura: float = 0.2, max_tokens: int = 500, timeout: float = 20.0) -> str | None:
    if not disponible():
        return None
    try:
        r = httpx.post(
            DEEPSEEK_URL, timeout=timeout,
            headers={"Authorization": f"Bearer {DEEPSEEK_API_KEY}", "Content-Type": "application/json"},
            json={"model": DEEPSEEK_MODEL, "temperature": temperatura, "max_tokens": max_tokens,
                  "messages": [{"role": "system", "content": sistema}, {"role": "user", "content": usuario}]})
        r.raise_for_status()
        texto = (r.json()["choices"][0]["message"]["content"] or "").strip()
        return texto or None
    except Exception as exc:   # noqa: BLE001 — cualquier falla degrada a la respuesta extractiva
        log.warning("DeepSeek no respondió (%s); se usa la respuesta extractiva", exc.__class__.__name__)
        return None
