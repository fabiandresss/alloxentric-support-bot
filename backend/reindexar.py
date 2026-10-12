"""Regenera los embeddings de los fragmentos existentes con el embedder activo.

Úsalo después de cambiar EMBEDDINGS_BACKEND / EMBEDDING_MODEL, de instalar el modelo real por primera vez, o para
fragmentos que quedaron sin vector. No toca el texto ni los documentos.

    python reindexar.py              # solo los fragmentos que no tienen el vector del embedder activo
    python reindexar.py --todo       # todos
    python reindexar.py --empresa wellq
"""
import sys
from sqlalchemy import select
from app import models as m
from app.db import SessionLocal
from app.services import embeddings


def main(todo: bool = False, slug: str | None = None, lote: int = 64) -> int:
    emb = embeddings.get_embedder()
    db = SessionLocal()
    try:
        q = select(m.FragmentoEmbedding)
        if slug:
            q = q.join(m.Empresa, m.Empresa.id == m.FragmentoEmbedding.empresa_id).where(m.Empresa.slug == slug)
        if not todo:
            q = q.where((m.FragmentoEmbedding.modelo.is_(None)) | (m.FragmentoEmbedding.modelo != emb.id)
                        | (m.FragmentoEmbedding.embedding.is_(None)))
        frags = db.scalars(q).all()
        for i in range(0, len(frags), lote):
            tanda = frags[i:i + lote]
            for f, v in zip(tanda, emb.embed([f.texto for f in tanda])):
                f.embedding, f.modelo = v, emb.id
            db.commit()
            print(f"  {min(i + lote, len(frags))}/{len(frags)}")
        print(f"Listo: {len(frags)} fragmentos con el embedder {emb.id}.")
        return len(frags)
    finally:
        db.close()


if __name__ == "__main__":
    a = sys.argv[1:]
    main(todo="--todo" in a, slug=a[a.index("--empresa") + 1] if "--empresa" in a else None)
