"""Tests contra un PostgreSQL REAL con pgvector.

Por defecto usa TEST_DATABASE_URL (p. ej. una BD de pruebas en tu Docker). Si no está definida,
intenta levantar uno temporal con `pip install pixeltable-pgserver`.
"""
import os
import tempfile
import pytest

_srv = None
url = os.getenv("TEST_DATABASE_URL")
if not url:
    import pixeltable_pgserver as pgserver
    _srv = pgserver.get_server(tempfile.mkdtemp())
    url = _srv.get_uri().replace("postgresql://", "postgresql+psycopg://")
os.environ["DATABASE_URL"] = url
os.environ["CORESTREAM_MOCK"] = "true"
os.environ["STORAGE_DIR"] = tempfile.mkdtemp()

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402
from app.db import Base, engine  # noqa: E402
import app.models  # noqa: E402,F401
from app.main import app  # noqa: E402

with engine.begin() as c:
    c.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
Base.metadata.create_all(engine)


SUPER_EMAIL, SUPER_PW = "root@alloxentric.test", "SuperSecreta1"


@pytest.fixture(autouse=True)
def limpiar():
    with engine.begin() as c:
        c.execute(text("TRUNCATE empresas, usuarios CASCADE"))
    yield


@pytest.fixture
def anon():
    """Cliente SIN autenticar."""
    return TestClient(app)


@pytest.fixture
def client():
    """Cliente autenticado como SUPERADMIN (los tests de negocio lo usan por defecto)."""
    from app.db import SessionLocal
    from app import models as m
    from app.security import hash_password
    with SessionLocal() as db:
        db.add(m.Usuario(email=SUPER_EMAIL, nombre="Root", rol="superadmin", password_hash=hash_password(SUPER_PW)))
        db.commit()
    c = TestClient(app)
    tok = c.post("/auth/login", json={"email": SUPER_EMAIL, "password": SUPER_PW}).json()["accessToken"]
    c.headers["Authorization"] = f"Bearer {tok}"
    return c


@pytest.fixture
def crear_empresa(client):
    def _crear(nombre, **kw):
        r = client.post("/empresas", json={"name": nombre, **kw})
        assert r.status_code == 201, r.text
        return r.json()
    return _crear


@pytest.fixture
def usuario_como(client):
    """usuario_como('acme', 'encargado_tickets') -> TestClient autenticado con ese rol."""
    def _mk(slug, rol, email=None):
        email = email or f"{rol}@{slug}.test"
        r = client.post("/usuarios", json={"email": email, "name": rol, "password": "Clave1234!",
                                           "role": rol, "companyId": slug})
        assert r.status_code == 201, r.text
        c = TestClient(app)
        tok = c.post("/auth/login", json={"email": email, "password": "Clave1234!"}).json()["accessToken"]
        c.headers["Authorization"] = f"Bearer {tok}"
        return c
    return _mk
