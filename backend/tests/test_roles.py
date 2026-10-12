"""Roles y permisos (RF-28): superadmin, admin_empresa, encargado_tickets, encargado_agente."""
import io
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from app.db import engine
from app.main import app


@pytest.fixture
def dos_empresas(client, crear_empresa, usuario_como):
    """Acme y Beta, cada una con un ticket, un documento y los 3 roles de empresa."""
    out = {}
    for slug, nombre in (("acme", "Acme"), ("beta", "Beta")):
        e = crear_empresa(nombre)
        client.post(f"/empresas/{slug}/probar", json={"message": "ayuda humano", "escalate": True})
        client.post(f"/empresas/{slug}/documentos",
                    files={"archivo": ("faq.txt", io.BytesIO(b"Los reembolsos tardan cinco dias."), "text/plain")})
        out[slug] = {"empresa": e,
                     **{r: usuario_como(slug, r) for r in ("admin_empresa", "encargado_tickets", "encargado_agente")}}
    return out


# ------------------------------------------------------------------ autenticación
def test_login_me_y_errores(client, anon):
    r = anon.post("/auth/login", json={"email": "root@alloxentric.test", "password": "SuperSecreta1"})
    assert r.status_code == 200 and r.json()["tokenType"] == "bearer"
    u = r.json()["user"]
    assert u["role"] == "superadmin" and u["companyId"] is None
    assert anon.post("/auth/login", json={"email": "root@alloxentric.test", "password": "mala"}).status_code == 401
    assert anon.post("/auth/login", json={"email": "nadie@x.cl", "password": "SuperSecreta1"}).status_code == 401
    assert client.get("/auth/me").json()["email"] == "root@alloxentric.test"
    assert anon.get("/auth/me").status_code == 401
    assert anon.get("/auth/me", headers={"Authorization": "Bearer basura"}).status_code == 401


def test_endpoints_protegidos_sin_token(anon, client, crear_empresa):
    crear_empresa("Acme")
    for met, url in [("get", "/empresas"), ("get", "/empresas/acme"), ("get", "/tickets"), ("get", "/metricas"),
                     ("get", "/empresas/acme/documentos"), ("get", "/usuarios"), ("post", "/empresas")]:
        assert getattr(anon, met)(url).status_code == 401, (met, url)
    assert anon.get("/health").status_code == 200


def test_usuario_desactivado_pierde_acceso(client, crear_empresa, usuario_como):
    crear_empresa("Acme")
    c = usuario_como("acme", "encargado_tickets")
    uid = c.get("/auth/me").json()["id"]
    assert client.patch(f"/usuarios/{uid}", json={"active": False}).status_code == 200
    assert c.get("/tickets").status_code == 401          # el token ya emitido deja de servir
    assert TestClient(app).post("/auth/login", json={"email": "encargado_tickets@acme.test",
                                                     "password": "Clave1234!"}).status_code == 401


# ------------------------------------------------------------------ matriz de permisos
# (rol, método, ruta) -> permitido?  Ruta con {slug} propio.
PERMISOS = [
    # empresas
    ("GET /empresas/acme",            dict(admin_empresa=1, encargado_tickets=1, encargado_agente=1)),
    ("PATCH /empresas/acme",          dict(admin_empresa=1, encargado_tickets=0, encargado_agente=1)),
    ("POST /empresas/acme/api-key",   dict(admin_empresa=1, encargado_tickets=0, encargado_agente=1)),
    ("POST /empresas/acme/probar",    dict(admin_empresa=1, encargado_tickets=0, encargado_agente=1)),
    # documentos (base de conocimiento)
    ("GET /empresas/acme/documentos", dict(admin_empresa=1, encargado_tickets=0, encargado_agente=1)),
    # tickets
    ("GET /tickets",                  dict(admin_empresa=1, encargado_tickets=1, encargado_agente=0)),
    ("GET /tickets/agentes",          dict(admin_empresa=1, encargado_tickets=1, encargado_agente=0)),
    # usuarios
    ("GET /usuarios",                 dict(admin_empresa=1, encargado_tickets=0, encargado_agente=0)),
    # solo superadmin
    ("POST /empresas",                dict(admin_empresa=0, encargado_tickets=0, encargado_agente=0)),
    # métricas: todos
    ("GET /metricas",                 dict(admin_empresa=1, encargado_tickets=1, encargado_agente=1)),
    ("GET /metricas/analitica",       dict(admin_empresa=1, encargado_tickets=1, encargado_agente=1)),
]
CUERPOS = {"PATCH /empresas/acme": {"agentName": "X"}, "POST /empresas/acme/probar": {"message": "hola"},
           "POST /empresas": {"name": "Otra"}}


@pytest.mark.parametrize("ruta,esperado", PERMISOS, ids=[p[0] for p in PERMISOS])
def test_matriz_de_permisos(dos_empresas, ruta, esperado):
    met, url = ruta.split(" ")
    for rol, ok in esperado.items():
        r = dos_empresas["acme"][rol].request(met, url, json=CUERPOS.get(ruta))
        if ok:
            assert r.status_code < 300, (rol, ruta, r.status_code, r.text)
        else:
            assert r.status_code == 403, (rol, ruta, r.status_code)


def test_superadmin_puede_todo(dos_empresas, client):
    assert client.get("/empresas/acme").status_code == 200
    assert client.get("/empresas/acme/documentos").status_code == 200
    assert len(client.get("/tickets").json()) == 2
    assert len(client.get("/empresas").json()) == 2


# ------------------------------------------------------------------ aislamiento entre empresas
def test_nadie_cruza_de_empresa(dos_empresas, client):
    beta_ticket = client.get("/tickets", params={"company_id": "beta"}).json()[0]["id"]
    beta_doc = client.get("/empresas/beta/documentos").json()[0]["id"]
    for rol in ("admin_empresa", "encargado_tickets", "encargado_agente"):
        c = dos_empresas["acme"][rol]
        assert [e["id"] for e in c.get("/empresas").json()] == ["acme"]           # solo ve la suya
        assert c.get("/empresas/beta").status_code == 403
        assert c.patch("/empresas/beta", json={"agentName": "x"}).status_code == 403
    t = dos_empresas["acme"]["encargado_tickets"]
    assert {x["companyId"] for x in t.get("/tickets").json()} == {"acme"}
    assert t.get("/tickets", params={"company_id": "beta"}).json()[0]["companyId"] == "acme"  # filtro ignorado
    assert t.get(f"/tickets/{beta_ticket}").status_code == 403
    assert t.patch(f"/tickets/{beta_ticket}", json={"status": "urgente"}).status_code == 403
    assert t.post(f"/tickets/{beta_ticket}/respuesta", json={"text": "hola"}).status_code == 403
    a = dos_empresas["acme"]["encargado_agente"]
    assert a.get("/empresas/beta/documentos").status_code == 403
    assert a.delete(f"/documentos/{beta_doc}").status_code == 403
    assert a.get(f"/documentos/{beta_doc}/fragmentos").status_code == 403
    assert client.get(f"/tickets/{beta_ticket}").json()["status"] == "pendiente"      # nada se tocó


def test_metricas_por_empresa(dos_empresas, client):
    assert client.get("/metricas").json()["openTickets"] == 2                         # global
    assert dos_empresas["acme"]["encargado_tickets"].get("/metricas").json()["openTickets"] == 1


def test_el_widget_sigue_usando_api_key_sin_jwt(client, crear_empresa, anon):
    e = crear_empresa("Acme")
    client.patch("/empresas/acme", json={"agentStatus": "activo"})
    r = anon.post("/chat", json={"message": "hola"}, headers={"X-API-Key": e["apiKey"]})
    assert r.status_code == 200


# ------------------------------------------------------------------ gestión de usuarios
def test_admin_empresa_gestiona_solo_su_empresa(dos_empresas, client):
    adm = dos_empresas["acme"]["admin_empresa"]
    r = adm.post("/usuarios", json={"email": "nuevo@acme.test", "name": "Nuevo", "password": "Clave1234!",
                                    "role": "encargado_tickets", "companyId": "beta"})   # intenta colar otra empresa
    assert r.status_code == 201 and r.json()["companyId"] == "acme"                     # se fuerza la suya
    assert {u["companyId"] for u in adm.get("/usuarios").json()} == {"acme"}
    assert len(adm.get("/usuarios").json()) == 4
    assert adm.post("/usuarios", json={"email": "root2@x.cl", "password": "Clave1234!",
                                       "role": "superadmin"}).status_code == 403
    beta_user = dos_empresas["beta"]["encargado_agente"].get("/auth/me").json()["id"]
    assert adm.patch(f"/usuarios/{beta_user}", json={"active": False}).status_code == 404
    assert adm.delete(f"/usuarios/{beta_user}").status_code == 404
    assert adm.post("/usuarios", json={"email": "nuevo@acme.test", "password": "Clave1234!",
                                       "role": "encargado_agente"}).status_code == 409   # email duplicado


def test_encargados_no_gestionan_usuarios(dos_empresas):
    for rol in ("encargado_tickets", "encargado_agente"):
        c = dos_empresas["acme"][rol]
        assert c.post("/usuarios", json={"email": "z@z.cl", "password": "Clave1234!", "role": rol}).status_code == 403


def test_cambio_de_rol_y_reglas_de_seguridad(dos_empresas, client):
    adm = dos_empresas["acme"]["admin_empresa"]
    yo = adm.get("/auth/me").json()["id"]
    otro = dos_empresas["acme"]["encargado_agente"].get("/auth/me").json()["id"]
    assert adm.patch(f"/usuarios/{otro}", json={"role": "encargado_tickets"}).json()["role"] == "encargado_tickets"
    assert adm.patch(f"/usuarios/{yo}", json={"role": "encargado_agente"}).status_code == 409   # auto-degradarse
    assert adm.patch(f"/usuarios/{yo}", json={"active": False}).status_code == 409
    assert adm.delete(f"/usuarios/{yo}").status_code == 409
    assert adm.patch(f"/usuarios/{otro}", json={"role": "superadmin"}).status_code == 403
    assert client.patch(f"/usuarios/{otro}", json={"role": "superadmin"}).status_code == 422
    assert adm.patch(f"/usuarios/{otro}", json={"password": "corta"}).status_code == 422
    sa = client.get("/auth/me").json()["id"]
    assert adm.patch(f"/usuarios/{sa}", json={"active": False}).status_code == 404            # ni lo ve
    assert adm.delete(f"/usuarios/{otro}").status_code == 204


def test_superadmin_crea_admins_y_otros_superadmins(client, crear_empresa):
    crear_empresa("Acme")
    r = client.post("/usuarios", json={"email": "admin@acme.cl", "password": "Clave1234!",
                                       "role": "admin_empresa", "companyId": "acme"})
    assert r.status_code == 201
    assert client.post("/usuarios", json={"email": "admin2@acme.cl", "password": "Clave1234!",
                                          "role": "admin_empresa"}).status_code == 404       # falta empresa
    s2 = client.post("/usuarios", json={"email": "otro@root.cl", "password": "Clave1234!", "role": "superadmin"})
    assert s2.status_code == 201 and s2.json()["companyId"] is None


def test_constraints_de_la_bd():
    """Defensa en profundidad: aunque falle la API, la BD rechaza combinaciones inválidas."""
    with pytest.raises(IntegrityError), engine.begin() as c:
        c.execute(text("INSERT INTO usuarios (id,email,password_hash,rol,nombre,activo) "
                       "VALUES (gen_random_uuid(),'a@a.cl','x','admin_empresa','',true)"))   # sin empresa
    with pytest.raises(IntegrityError), engine.begin() as c:
        c.execute(text("INSERT INTO usuarios (id,email,password_hash,rol,nombre,activo) "
                       "VALUES (gen_random_uuid(),'b@b.cl','x','dios','',true)"))            # rol inventado


def test_la_clave_no_se_guarda_en_claro(client, crear_empresa):
    crear_empresa("Acme")
    client.post("/usuarios", json={"email": "a@acme.cl", "password": "Clave1234!", "role": "admin_empresa",
                                   "companyId": "acme"})
    with engine.begin() as c:
        h = c.execute(text("SELECT password_hash FROM usuarios WHERE email='a@acme.cl'")).scalar()
    assert h.startswith("pbkdf2$") and "Clave1234" not in h


# ------------------------------------------------------------------ campos de empresa, remitente y asignación
def _uid(cli, email):
    return next(x["id"] for x in cli.get("/usuarios").json() if x["email"] == email)


def test_encargado_agente_no_cambia_nombre_ni_industria_de_la_empresa(dos_empresas):
    ag, adm = dos_empresas["acme"]["encargado_agente"], dos_empresas["acme"]["admin_empresa"]
    assert ag.patch("/empresas/acme", json={"name": "Acme Hackeada"}).status_code == 403
    assert ag.patch("/empresas/acme", json={"industry": "Otra"}).status_code == 403
    # el front reenvía la ficha completa: reenviar los mismos valores no es un cambio
    emp = ag.get("/empresas/acme").json()
    r = ag.patch("/empresas/acme", json={"name": emp["name"], "industry": emp["industry"], "agentName": "Bot Nuevo"})
    assert r.status_code == 200 and r.json()["agentName"] == "Bot Nuevo"
    assert adm.patch("/empresas/acme", json={"name": "Acme SpA", "industry": "Retail"}).json()["name"] == "Acme SpA"


def test_el_remitente_de_la_respuesta_es_el_usuario_autenticado(dos_empresas):
    tk = dos_empresas["acme"]["encargado_tickets"]
    t = tk.get("/tickets").json()[0]
    r = tk.post(f"/tickets/{t['id']}/respuesta", json={"text": "Hola", "agentName": "Gerente General"}).json()
    assert r["transcript"][-1]["senderName"] == "encargado_tickets"   # nombre del usuario; agentName se ignora


def test_asignacion_solo_a_usuarios_de_atencion_de_la_misma_empresa(dos_empresas, client):
    a, b = dos_empresas["acme"], dos_empresas["beta"]
    tk = a["encargado_tickets"]
    t = tk.get("/tickets").json()[0]
    ag = tk.get("/tickets/agentes").json()
    assert {x["role"] for x in ag} == {"encargado_tickets", "admin_empresa"} and {x["companyId"] for x in ag} == {"acme"}
    mio = next(x for x in ag if x["role"] == "encargado_tickets")
    p = tk.patch(f"/tickets/{t['id']}", json={"assignedAgentId": mio["id"]}).json()
    assert p["assignedAgentId"] == mio["id"] and p["assignedAgent"] == "encargado_tickets"
    # no se puede asignar a un usuario de otra empresa, a quien no atiende tickets, ni a un id inventado
    ajeno = b["encargado_tickets"].get("/tickets/agentes").json()[0]["id"]
    sin_rol = _uid(a["admin_empresa"], "encargado_agente@acme.test")
    for malo in (ajeno, sin_rol, "no-es-uuid", "00000000-0000-0000-0000-000000000000"):
        assert tk.patch(f"/tickets/{t['id']}", json={"assignedAgentId": malo}).status_code == 422, malo
    assert tk.get(f"/tickets/{t['id']}").json()["assignedAgentId"] == mio["id"]   # sigue igual
    # null explícito = sin asignar
    p = tk.patch(f"/tickets/{t['id']}", json={"assignedAgentId": None}).json()
    assert p["assignedAgent"] == "Sin asignar" and "assignedAgentId" not in p
    # la lista es por empresa; el encargado del agente no la ve; el superadmin ve todas
    assert a["encargado_agente"].get("/tickets/agentes").status_code == 403
    assert {x["companyId"] for x in client.get("/tickets/agentes").json()} == {"acme", "beta"}


def test_analitica_real_por_rol_y_empresa(dos_empresas, client):
    # cada empresa tiene 1 conversación derivada (fixture); sumamos una resuelta por el bot en acme
    client.post("/empresas/acme/probar", json={"message": "Los reembolsos tardan cinco dias"})
    a = dos_empresas["acme"]["encargado_agente"].get("/metricas/analitica").json()
    assert [c["id"] for c in a["companies"]] == ["acme"]                       # no ve a beta
    assert (a["totalConversations"], a["botResolved"], a["humanEscalated"]) == (2, 1, 1)
    assert a["botRate"] == 50.0 and a["escalationRate"] == 50.0
    assert len(a["daily"]) == 14 and a["daily"][-1] == {"date": "Hoy", "bot": 1, "human": 1, "total": 2}
    b = dos_empresas["beta"]["admin_empresa"].get("/metricas/analitica").json()
    assert [c["id"] for c in b["companies"]] == ["beta"] and b["totalConversations"] == 1
    r = client.get("/metricas/analitica", params={"dias": 7})
    assert r.status_code == 200, r.text
    g = r.json()
    assert {c["id"] for c in g["companies"]} == {"acme", "beta"} and g["totalConversations"] == 3
    assert len(g["daily"]) == 7 and g["conversationsDelta"] is None            # sin periodo anterior
    assert client.get("/metricas/analitica", params={"dias": 0}).status_code == 422
    assert client.get("/metricas/analitica", params={"dias": 91}).status_code == 422
