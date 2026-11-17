"""Búsqueda híbrida: a los vectores (significado) se suman las palabras clave (coincidencias exactas de términos como códigos, nombres de
producto o cifras, donde los embeddings fallan) y un reordenamiento final.

  1. Candidatos por vectores (pgvector o exacta en Python) y candidatos por palabras clave con el texto completo de Postgres
     (diccionario `spanish`, sin tildes, términos unidos con OR).
  2. De cada candidato se calcula su similitud (coseno) y su **cobertura**: qué parte de las palabras importantes de la pregunta aparece en él.
  3. Puntaje final = 0.55·confianza semántica + 0.25·cobertura + 0.1 si está entre los 3 mejores por palabras clave + 0.3 si contiene un
     código o cifra exacta de la pregunta (los embeddings casi no distinguen «ZX9000» de «ZX9001»).
     Sin coincidencias de palabras clave el orden es exactamente el de los vectores (el híbrido no empeora lo que ya funcionaba).

Todo filtra por empresa (regla multi-tenant): el SQL recibe `empresa_id` y el embedder activo, igual que la búsqueda vectorial.
"""
import re
import unicodedata
from sqlalchemy import text
from sqlalchemy.orm import Session

STOP = frozenset("""como cual cuales cuando donde quien quienes cuanto cuantos cuanta cuantas para pero porque pues sobre entre desde hasta hacia
con sin los las del una unos unas que por mas muy tambien tiene tienen puedo puede pueden quiero quisiera necesito saber favor hola buenas
este esta estos estas ese esa esos esas aqui alli ser son esta estan estoy hacer hace tengo hay""".split())
_TOKEN = re.compile(r"[a-z0-9]+")


def _plano(t: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", t.lower()) if unicodedata.category(c) != "Mn")


def palabras(texto: str) -> list[str]:
    """Las palabras que importan de una pregunta: sin tildes, de 4+ letras (o con dígitos) y sin palabras vacías; sin repetidas."""
    vistas: list[str] = []
    for w in _TOKEN.findall(_plano(texto)):
        if w in STOP or w in vistas or (len(w) < 4 and not any(c.isdigit() for c in w)):
            continue
        vistas.append(w)
    return vistas[:12]


def _raiz(w: str) -> str:
    return w[:5]            # comparar por raíz aproximada: «reembolsos» y «reembolso» coinciden


def _peso(w: str) -> int:
    """Códigos, modelos, cifras y fechas (términos con dígitos) casi no se repiten: acertarlos pesa mucho más que acertar una palabra común."""
    return 5 if any(c.isdigit() for c in w) else 1


def cobertura(claves: list[str], texto_fragmento: str) -> float:
    """Fracción (0..1, ponderada) de las palabras clave de la pregunta que aparecen en el fragmento (por raíz)."""
    if not claves:
        return 0.0
    raices = {_raiz(w) for w in _TOKEN.findall(_plano(texto_fragmento))}
    return sum(_peso(w) for w in claves if _raiz(w) in raices) / sum(_peso(w) for w in claves)


def tiene_codigo(claves: list[str], texto_fragmento: str) -> bool:
    """¿El fragmento contiene algún término con dígitos de la pregunta (un código, modelo, cifra)? Un acierto exacto así es casi seguro relevante."""
    cods = [w for w in claves if any(c.isdigit() for c in w)]
    if not cods:
        return False
    raices = {_raiz(w) for w in _TOKEN.findall(_plano(texto_fragmento))}
    return any(_raiz(w) in raices for w in cods)


def tsquery(claves: list[str]) -> str | None:
    """Consulta de texto completo con OR entre los términos (sin caracteres que Postgres interprete como operadores)."""
    seguras = [w for w in claves if re.fullmatch(r"[a-z0-9]{3,}", w)]
    return " | ".join(seguras) if seguras else None


_SQL = text("""
    SELECT f.id AS id, ts_rank_cd(to_tsvector('spanish', translate(lower(f.texto), 'áéíóúüñ', 'aeiouun')), to_tsquery('spanish', :q)) AS rango
    FROM fragmentos_embeddings f JOIN documentos d ON d.id = f.documento_id
    WHERE f.empresa_id = :empresa AND d.empresa_id = :empresa AND f.modelo = :modelo AND f.embedding IS NOT NULL AND d.estado = 'procesado'
      AND to_tsvector('spanish', translate(lower(f.texto), 'áéíóúüñ', 'aeiouun')) @@ to_tsquery('spanish', :q)
    ORDER BY rango DESC LIMIT :k
""")


def por_palabras(db: Session, empresa_id, modelo_embedder: str, consulta_ts: str | None, k: int) -> list[str]:
    """Ids (str) de los fragmentos de la empresa que contienen alguno de los términos, del más al menos relevante."""
    if not consulta_ts:
        return []
    filas = db.execute(_SQL, {"empresa": empresa_id, "modelo": modelo_embedder, "q": consulta_ts, "k": k}).all()
    return [str(f.id) for f in filas]
