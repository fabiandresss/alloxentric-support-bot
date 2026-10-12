"""Motor RAG: embeddings, búsqueda vectorial por empresa, umbral, intención y generación con LLM (mockeado).

Las pruebas usan el embedder determinista `hash` (conftest) y NUNCA llaman a DeepSeek: `llm.generar` se reemplaza.
La calidad con el modelo real se mide aparte (tests_calidad_rag).
"""
import io
import pytest
from sqlalchemy import select, text
from app import models as m
from app.db import SessionLocal, engine
from app.services import embeddings, llm, motor_rag

REEMBOLSOS = "Los reembolsos de consultas medicas tardan cinco dias habiles en llegar a tu cuenta."
HORARIO = "El horario de atencion telefonica es de lunes a viernes de nueve a seis de la tarde."


def _subir(client, slug, nombre, contenido):
    r = client.post(f"/empresas/{slug}/documentos",
                    files={"archivo": (nombre, io.BytesIO(contenido.encode()), "text/plain")})
    assert r.status_code == 201, r.text
    return r.json()


def _preguntar(client, slug, mensaje, **kw):
    r = client.post(f"/empresas/{slug}/probar", json={"message": mensaje, **kw})
    assert r.status_code == 200, r.text
    return r.json()


def _bot(r):
    return r["messages"][-1]


@pytest.fixture
def acme(client, crear_empresa):
    crear_empresa("Acme")
    _subir(client, "acme", "reembolsos.txt", REEMBOLSOS)
    _subir(client, "acme", "horario.txt", HORARIO)


# ------------------------------------------------------------------------------------------ embeddings
def test_embedder_hash_normalizado_y_determinista():
    e = embeddings.HashingEmbedder()
    a, b = e.embed(["reembolsos de consultas medicas", "reembolsos de consultas medicas"])
    assert a == b and len(a) == 384 and abs(sum(x * x for x in a) - 1) < 1e-9
    parecido = sum(x * y for x, y in zip(a, e.embed(["cuanto tardan los reembolsos medicos"])[0]))
    distinto = sum(x * y for x, y in zip(a, e.embed(["mi tarjeta fue clonada en el extranjero"])[0]))
    assert parecido > 0.3 > distinto


def test_la_ingesta_guarda_vectores_con_el_modelo(acme):
    with SessionLocal() as db:
        frs = db.scalars(select(m.FragmentoEmbedding)).all()
    assert len(frs) == 2
    assert all(f.embedding is not None and len(f.embedding) == 384 and f.modelo == "hash-v1" for f in frs)


def test_documento_sin_texto_queda_en_error(client, crear_empresa):
    crear_empresa("Acme")
    d = _subir(client, "acme", "vacio.txt", "   \n\n  ")
    assert client.get("/empresas/acme/documentos").json()[0]["status"] == "error" and d["name"] == "vacio.txt"


# ------------------------------------------------------------------------------------------ búsqueda y umbral
def test_responde_con_el_fragmento_y_la_fuente_correcta(client, acme):
    r = _preguntar(client, "acme", "cuanto tardan los reembolsos de consultas medicas?")
    assert r["derived"] is False
    assert "cinco dias habiles" in _bot(r)["message"] and _bot(r)["ragSources"] == ["reembolsos.txt"]
    r = _preguntar(client, "acme", "a que hora atienden por telefono?")
    assert _bot(r)["ragSources"] == ["horario.txt"]       # elige el documento correcto entre varios


def test_sin_respaldo_deriva_a_un_humano(client, acme):
    r = _preguntar(client, "acme", "mi tarjeta fue clonada en el extranjero")
    assert r["derived"] is True and r["ticketNumber"].startswith("COR-")
    assert "umbral" in client.get("/tickets").json()[0]["escalationReason"]


def test_el_umbral_de_la_empresa_decide(client, acme):
    pregunta = "cuanto tardan los reembolsos medicos?"
    assert _preguntar(client, "acme", pregunta)["derived"] is False
    client.patch("/empresas/acme", json={"ragThreshold": 1.0})        # umbral máximo: casi nada lo supera
    assert _preguntar(client, "acme", pregunta)["derived"] is True
    client.patch("/empresas/acme", json={"ragThreshold": 0.1})        # umbral mínimo: responde incluso con poco respaldo
    assert _preguntar(client, "acme", "reembolsos")["derived"] is False


def test_busqueda_solo_dentro_de_la_empresa(client, crear_empresa):
    crear_empresa("Alfa"), crear_empresa("Beta")
    _subir(client, "alfa", "secreto.txt", "El codigo interno de descuento es ZETA9999 para clientes premium.")
    _subir(client, "beta", "otro.txt", "Atendemos reclamos de lunes a viernes por correo electronico.")
    pregunta = "cual es el codigo interno de descuento para clientes premium?"
    with SessionLocal() as db:
        alfa = db.scalar(select(m.Empresa).where(m.Empresa.slug == "alfa"))
        beta = db.scalar(select(m.Empresa).where(m.Empresa.slug == "beta"))
        de_alfa, de_beta = motor_rag.buscar(db, alfa, pregunta), motor_rag.buscar(db, beta, pregunta)
    assert de_alfa[0].documento == "secreto.txt" and "ZETA9999" in de_alfa[0].texto
    assert all(f.documento == "otro.txt" for f in de_beta)         # nunca aparece el documento de Alfa
    assert "ZETA9999" not in str(_preguntar(client, "beta", pregunta))


def test_vectores_de_otro_modelo_se_ignoran_hasta_reindexar(client, acme):
    import reindexar
    with engine.begin() as c:
        c.execute(text("UPDATE fragmentos_embeddings SET modelo = 'st:otro-modelo'"))
    assert _preguntar(client, "acme", "cuanto tardan los reembolsos medicos?")["derived"] is True   # no usa vectores ajenos
    assert reindexar.main() == 2                                                                    # regenera solo lo necesario
    assert reindexar.main() == 0
    assert _preguntar(client, "acme", "cuanto tardan los reembolsos medicos?")["derived"] is False


def test_documentos_en_proceso_o_con_error_no_se_consultan(client, acme):
    with engine.begin() as c:
        c.execute(text("UPDATE documentos SET estado = 'error' WHERE nombre = 'reembolsos.txt'"))
    assert _preguntar(client, "acme", "cuanto tardan los reembolsos medicos?")["derived"] is True


# ------------------------------------------------------------------------------------------ intención
@pytest.mark.parametrize("texto,esperado", [
    ("hola", "saludo"), ("Buenas tardes", "saludo"), ("muchas gracias", "gracias"), ("gracias!", "gracias"),
    ("chao", "despedida"), ("quiero hablar con un humano", "humano"), ("necesito atención humana por favor", "humano"),
    ("esto es urgente", "humano"), ("tengo un reclamo", "humano"), ("hablar con un ejecutivo", "humano"),
    ("cuanto demoran los reembolsos?", "consulta"), ("como configuro el agente de mi empresa", "consulta"),
    ("hola, quiero saber como cambio mi plan de pago mensual", "consulta"),
])
def test_intencion(texto, esperado):
    assert motor_rag.intencion(texto) == esperado


def test_un_saludo_no_deriva_ni_crea_ticket(client, crear_empresa):
    crear_empresa("Acme")           # sin documentos
    r = _preguntar(client, "acme", "hola")
    assert r["derived"] is False and "Acme" in _bot(r)["message"]
    assert client.get("/tickets").json() == []


def test_pedir_humano_deriva_aunque_haya_respaldo(client, acme):
    r = _preguntar(client, "acme", "quiero un humano para el tema de reembolsos")
    assert r["derived"] is True and "agente humano" in _bot(r)["message"]


# ------------------------------------------------------------------------------------------ LLM (mockeado)
@pytest.fixture
def llm_falso(monkeypatch):
    llamadas = []

    def fake(sistema, usuario, **kw):
        llamadas.append((sistema, usuario))
        return fake.respuesta
    fake.respuesta = "Los reembolsos demoran cinco dias habiles."
    monkeypatch.setattr(llm, "generar", fake)
    fake.llamadas = llamadas
    return fake


def test_con_llm_usa_su_respuesta_y_solo_fragmentos_de_la_empresa(client, crear_empresa, llm_falso):
    crear_empresa("Alfa"), crear_empresa("Beta")
    _subir(client, "alfa", "r.txt", REEMBOLSOS)
    _subir(client, "beta", "s.txt", "El codigo interno de descuento es ZETA9999 para clientes premium.")
    client.patch("/empresas/alfa", json={"customInstructions": "Firma siempre como Soporte Alfa", "tone": "cercano"})
    r = _preguntar(client, "alfa", "cuanto tardan los reembolsos de consultas medicas?")
    assert _bot(r)["message"] == "Los reembolsos demoran cinco dias habiles." and _bot(r)["ragSources"] == ["r.txt"]
    sistema, usuario = llm_falso.llamadas[-1]
    assert "Firma siempre como Soporte Alfa" in sistema and "cercano" in sistema     # instrucciones y tono de la empresa
    assert "cinco dias habiles" in usuario and "ZETA9999" not in usuario + sistema   # nunca datos de otra empresa


def test_si_el_llm_no_sabe_deriva(client, acme, llm_falso):
    llm_falso.respuesta = "NO_SE"
    r = _preguntar(client, "acme", "cuanto tardan los reembolsos de consultas medicas?")
    assert r["derived"] is True
    assert "modelo" in client.get("/tickets").json()[0]["escalationReason"]


def test_si_el_llm_falla_responde_de_forma_extractiva(client, acme, monkeypatch):
    monkeypatch.setattr(llm, "DEEPSEEK_API_KEY", "clave-falsa")
    monkeypatch.setattr(llm.httpx, "post", lambda *a, **k: (_ for _ in ()).throw(llm.httpx.ConnectError("sin red")))
    r = _preguntar(client, "acme", "cuanto tardan los reembolsos de consultas medicas?")
    assert r["derived"] is False and "cinco dias habiles" in _bot(r)["message"]   # el chat no se cae


def test_sin_clave_no_se_llama_al_llm(monkeypatch):
    monkeypatch.setattr(llm, "DEEPSEEK_API_KEY", "")
    assert llm.disponible() is False and llm.generar("s", "u") is None


# ------------------------------------------------------------------------------------------ sugerencia para el agente
def test_sugerencia_del_ticket(client, acme):
    _preguntar(client, "acme", "cuanto tardan los reembolsos?", escalate=True)
    s = client.get("/tickets").json()[0]["aiSuggestion"]
    assert s["sourceDoc"] == "reembolsos.txt" and s["confidence"] > 0.4
    assert "cinco dias habiles" in s["draftResponse"] and "Hola" in s["draftResponse"]
    _preguntar(client, "acme", "mi tarjeta fue clonada en el extranjero")
    sin = next(t for t in client.get("/tickets").json() if "tarjeta" in t["userQueryExcerpt"])["aiSuggestion"]
    assert "cinco dias" not in sin["draftResponse"] and "a la brevedad" in sin["draftResponse"]


def test_health_informa_el_backend_de_embeddings(anon):
    h = anon.get("/health").json()
    assert h["ok"] is True and h["embeddings"]["backend"] == "hash"


# ------------------------------------------------------------------------------------------ fragmentación
def test_dividir_un_fragmento_por_parrafo():
    from app.services.ingesta import dividir
    a, b = "A" * 200, "B" * 200
    assert dividir(f"{a}\n\n{b}") == [a, b]                         # cada párrafo es un fragmento
    assert dividir(f"Politica de reembolsos\n\n{a}") == [f"Politica de reembolsos\n\n{a}"]   # el título se une al siguiente
    largo = ". ".join(f"Oracion numero {i} con algo de texto" for i in range(60))
    partes = dividir(largo, max_chars=300)
    assert len(partes) > 3 and all(len(p) <= 300 for p in partes)
    assert dividir("") == [] and dividir("  \n\n  ") == []
    assert all(len(p) <= 700 for p in dividir("x" * 5000))        # sin saltos: se corta en seco
