"""Base de datos local SIN Docker: levanta un PostgreSQL con pgvector y deja los datos en backend/.pgdata.

    pip install pixeltable-pgserver
    python dev_db.py            # déjalo corriendo en una terminal; Ctrl+C lo detiene (los datos quedan)

Imprime la DATABASE_URL que debes poner en .env. Redis no hace falta todavía (Celery está pendiente).
"""
import time
from pathlib import Path
import pixeltable_pgserver as pgserver

DATA = Path(__file__).parent / ".pgdata"
srv = pgserver.get_server(DATA)
url = srv.get_uri().replace("postgresql://", "postgresql+psycopg://")
print("\nPostgreSQL listo. Pon esto en .env (y deja esta terminal abierta):\n")
print(f"DATABASE_URL={url}\n")
try:
    while True:
        time.sleep(3600)
except KeyboardInterrupt:
    print("Deteniendo…")
