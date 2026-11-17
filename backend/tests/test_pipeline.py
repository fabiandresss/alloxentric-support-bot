"""Ajustes del pipeline de ingesta y recuperación por empresa: GET/PUT /empresas/{slug}/kb/pipeline y POST .../kb/reprocesar."""
from sqlalchemy import select
from app import models as m
from app.db import SessionLocal
from app.services import ingesta, motor_rag
from tests.test_rag import _subir

DEFECTO = {"chunkMax": 700, "chunkMin": 120, "chunkOverlap": 0, "topK": 4, "hybrid": True, "ocr": True}


def _empresa(slug):
    with SessionLocal() as db:
        return db.scalar(select(m.Empresa).where(m.Empresa.slug == slug)).id


def test_defectos_guardado_y_rangos(client, crear_empresa):
    crear_empresa("Acme")
    est = client.get("/empresas/acme/kb/pipeline").json()
    assert est["config"] == DEFECTO and est["defaults"] == DEFECTO and est["customized"] is False
    assert est["limits"]["topK"] == [1, 10] and est["limits"]["chunkMax"] == [200, 2000]
    r = client.put("/empresas/acme/kb/pipeline", json={**DEFECTO, "topK": 2, "chunkMax": 400, "hybrid": False})
    assert r.status_code == 200, r.text
    assert r.json()["config"]["topK"] == 2 and r.json()["config"]["hybrid"] is False and r.json()["customized"] is True
    assert client.get("/empresas/acme/kb/pipeline").json()["config"]["chunkMax"] == 400          # persiste
    vuelta = client.put("/empresas/acme/kb/pipeline", json=DEFECTO).json()                        # volver al defecto
    assert vuelta["customized"] is False
    with SessionLocal() as db:
        assert db.scalar(select(m.Empresa).where(m.Empresa.slug == "acme")).pipeline == {}       # no guarda lo que es defecto


def test_validacion(client, crear_empresa):
    crear_empresa("Acme")
    for malo in ({"topK": 0}, {"topK": 11}, {"chunkMax": 100}, {"chunkMin": 700}, {"chunkOverlap": 400}, {"chunkMax": 300, "chunkOverlap": 150}):
        r = client.put("/empresas/acme/kb/pipeline", json={**DEFECTO, **malo})
        assert r.status_code == 422, (malo, r.text)
    assert client.put("/empresas/acme/kb/pipeline", json={**DEFECTO, "topK": "muchos"}).status_code == 422
    assert client.get("/empresas/acme/kb/pipeline").json()["customized"] is False                # nada se guardó


def test_roles_y_aislamiento(client, crear_empresa, usuario_como):
    crear_empresa("Acme")
    crear_empresa("Beta")
    agente, tickets = usuario_como("acme", "encargado_agente"), usuario_como("acme", "encargado_tickets")
    assert tickets.get("/empresas/acme/kb/pipeline").status_code == 403
    assert tickets.put("/empresas/acme/kb/pipeline", json=DEFECTO).status_code == 403
    assert tickets.post("/empresas/acme/kb/reprocesar").status_code == 403
    assert agente.put("/empresas/acme/kb/pipeline", json={**DEFECTO, "topK": 3}).status_code == 200
    for r in (agente.get("/empresas/beta/kb/pipeline"), agente.put("/empresas/beta/kb/pipeline", json=DEFECTO), agente.post("/empresas/beta/kb/reprocesar")):
        assert r.status_code in (403, 404)                                                       # otra empresa: no
    assert client.get("/empresas/beta/kb/pipeline").json()["config"]["topK"] == 4               # el cambio de Acme no toca a Beta


def test_overlap_en_dividir():
    p1, p2, p3 = ("Primera idea " * 20).strip(), ("Segunda idea " * 20).strip(), ("Tercera idea " * 20).strip()
    base = ingesta.dividir(f"{p1}\n\n{p2}\n\n{p3}", max_chars=400, min_chars=50)
    con = ingesta.dividir(f"{p1}\n\n{p2}\n\n{p3}", max_chars=400, min_chars=50, overlap=40)
    assert len(base) == len(con) == 3 and con[0] == base[0]
    for previo, actual in zip(con, con[1:]):
        cola = actual.split(" ", 2)[0]
        assert cola and cola in previo                      # el fragmento arranca con el final del anterior
    assert all(len(c) > len(b) for c, b in zip(con[1:], base[1:]))
    assert all(c.split(" ", 1)[0] in {"Primera", "Segunda", "Tercera", "idea"} for c in con)


def test_chunking_y_reprocesar(client, crear_empresa):
    crear_empresa("Acme")
    texto = "\n\n".join(f"Tema {i}: " + ("la garantia cubre defectos de fabricacion y reparaciones. " * 6) for i in range(3))
    _subir(client, "acme", "garantia.txt", texto)
    antes = client.get("/empresas/acme/documentos").json()[0]["chunkCount"]
    assert antes == 3                                                                            # un fragmento por párrafo (defecto)
    client.put("/empresas/acme/kb/pipeline", json={**DEFECTO, "chunkMax": 200, "chunkMin": 40})
    assert client.get("/empresas/acme/documentos").json()[0]["chunkCount"] == antes             # lo ya ingestado no cambia solo
    r = client.post("/empresas/acme/kb/reprocesar")
    assert r.status_code == 202 and r.json() == {"queued": 1, "skipped": 0}
    doc = client.get("/empresas/acme/documentos").json()[0]
    assert doc["status"] == "procesado" and doc["chunkCount"] > antes                           # ahora sí, con el nuevo tamaño
    frs = client.get(f"/documentos/{doc['id']}/fragmentos").json()
    assert len(frs) == doc["chunkCount"] and all(len(f["text"]) <= 200 for f in frs)             # sin duplicados de la pasada anterior
    assert client.get("/empresas/acme/kb/pipeline").json()["reprocessable"] == 1


def test_reprocesar_omite_documentos_sin_archivo(client, crear_empresa):
    crear_empresa("Acme")
    eid = _empresa("acme")
    with SessionLocal() as db:
        db.add(m.Documento(empresa_id=eid, nombre="seed.docx", tipo="docx", tamano_bytes=1, ruta_local="/no/existe/seed.docx", estado="procesado"))
        db.commit()
    est = client.get("/empresas/acme/kb/pipeline").json()
    assert est["documents"] == 1 and est["reprocessable"] == 0
    assert client.post("/empresas/acme/kb/reprocesar").json() == {"queued": 0, "skipped": 1}


def test_top_k_de_la_empresa(client, crear_empresa):
    crear_empresa("Acme")
    for i, tema in enumerate(("reembolsos", "garantias", "envios", "facturas", "cambios")):
        _subir(client, "acme", f"doc{i}.txt", f"Politica de {tema}: los {tema} de consultas medicas se gestionan con documentacion respaldatoria y plazos definidos.")
    with SessionLocal() as db:
        emp = db.scalar(select(m.Empresa).where(m.Empresa.slug == "acme"))
        assert len(motor_rag.buscar(db, emp, "consultas medicas documentacion plazos")) == 4         # defecto
    client.put("/empresas/acme/kb/pipeline", json={**DEFECTO, "topK": 2})
    with SessionLocal() as db:
        emp = db.scalar(select(m.Empresa).where(m.Empresa.slug == "acme"))
        assert len(motor_rag.buscar(db, emp, "consultas medicas documentacion plazos")) == 2
        assert len(motor_rag.buscar(db, emp, "consultas medicas documentacion plazos", k=3)) == 3    # k explícito manda
