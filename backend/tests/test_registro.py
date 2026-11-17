"""Registro en autoservicio: cuenta -> empresa -> chatbot (uno por empresa), con aislamiento, validaciones y límites."""
import pytest
from fastapi.testclient import TestClient
from app.main import app
from tests.test_rag import REEMBOLSOS, _subir

CLAVE = "Clave-segura-2026"


def _registrar(anon, email="ana@miempresa.cl", nombre="Ana Pérez", password=CLAVE, **extra):
    return anon.post("/registro/usuario", json={"email": email, "name": nombre, "password": password, **extra})


def _sesion(r) -> TestClient:
    """Cliente autenticado con el token que devolvió el registro."""
    c = TestClient(app)
    c.headers["Authorization"] = f"Bearer {r.json()['accessToken']}"
    return c


def _persona(anon, email="ana@miempresa.cl"):
    r = _registrar(anon, email=email)
    assert r.status_code == 201, r.text
    return _sesion(r)


def _con_empresa(anon, nombre="Mi Empresa", email="ana@miempresa.cl"):
    c = _persona(anon, email)
    r = c.post("/registro/empresa", json={"name": nombre, "industry": "Salud", "siteUrl": "miempresa.cl"})
    assert r.status_code == 201, r.text
    return c, r.json()


CHATBOT = {"agentName": "Mia", "tone": "cercano", "customInstructions": "", "brandColor": "#1D4ED8", "spendPlan": {"mode": "sin_limite"}}


# ------------------------------------------------------------------------------------------ flujo completo
def test_flujo_completo_cuenta_empresa_y_chatbot(anon, client):
    r = _registrar(anon)
    assert r.status_code == 201
    u = r.json()["user"]
    assert u["role"] == "registrado" and u.get("companyId") is None
    c = _sesion(r)
    assert c.get("/auth/me").json()["role"] == "registrado"

    emp = c.post("/registro/empresa", json={"name": "Mi Empresa", "industry": "Salud", "siteUrl": "https://miempresa.cl/"})
    assert emp.status_code == 201
    e = emp.json()
    assert e["slug"] == "mi-empresa" and e["chatbotCreated"] is False and e["agentStatus"] == "en_configuracion"
    me = c.get("/auth/me").json()
    assert me["role"] == "admin_empresa" and me["companyId"] == "mi-empresa"      # el mismo token ya sirve con el rol nuevo

    # no se puede activar un agente que no existe todavía
    assert c.patch("/empresas/mi-empresa", json={"agentStatus": "activo"}).status_code == 409

    bot = c.post("/empresas/mi-empresa/chatbot", json=CHATBOT)
    assert bot.status_code == 201
    b = bot.json()
    assert b["chatbotCreated"] is True and b["agentName"] == "Mia" and b["tone"] == "cercano" and b["brandColor"] == "#1D4ED8"
    assert b["brandBg"] != "#FCEDEF" and b["customInstructions"].startswith("Eres Mia")     # color de fondo derivado y instrucciones por defecto

    _subir(c, "mi-empresa", "reembolsos.txt", REEMBOLSOS)
    assert c.patch("/empresas/mi-empresa", json={"agentStatus": "activo"}).status_code == 200
    r = anon.post("/publico/mi-empresa/chat", json={"message": "cuanto tardan los reembolsos de consultas medicas?"})
    assert r.status_code == 200 and "cinco dias habiles" in r.json()["messages"][-1]["message"]


def test_un_solo_chatbot_por_empresa(anon):
    c, _ = _con_empresa(anon)
    assert c.post("/empresas/mi-empresa/chatbot", json=CHATBOT).status_code == 201
    r = c.post("/empresas/mi-empresa/chatbot", json={**CHATBOT, "agentName": "Otro"})
    assert r.status_code == 409 and "Alloxentric" in r.json()["detail"]
    assert c.get("/empresas/mi-empresa").json()["agentName"] == "Mia"            # el primero no se tocó


def test_empresas_creadas_por_el_superadmin_ya_traen_su_chatbot(client, crear_empresa):
    crear_empresa("Acme")
    r = client.post("/empresas/acme/chatbot", json=CHATBOT)
    assert r.status_code == 409 and "Alloxentric" in r.json()["detail"]
    assert client.get("/empresas/acme").json()["chatbotCreated"] is True


# ------------------------------------------------------------------------------------------ aislamiento y roles
def test_un_registrado_no_toca_nada_de_la_plataforma(anon, client, crear_empresa):
    crear_empresa("Acme")
    c = _persona(anon)
    for metodo, ruta in [("get", "/empresas"), ("get", "/empresas/acme"), ("get", "/tickets"), ("get", "/metricas"), ("get", "/metricas/analitica"),
                         ("get", "/usuarios"), ("get", "/empresas/acme/documentos"), ("get", "/empresas/acme/conversaciones"),
                         ("get", "/empresas/acme/kb/resumen"), ("get", "/empresas/acme/seguridad/eventos"), ("get", "/empresas/acme/finops")]:
        assert getattr(c, metodo)(ruta).status_code == 403, ruta
    assert c.post("/empresas", json={"name": "Otra"}).status_code == 403
    assert c.post("/empresas/acme/chatbot", json=CHATBOT).status_code == 403
    assert c.post("/usuarios", json={"email": "x@y.cl", "name": "x", "password": "Clave1234!", "role": "admin_empresa", "companyId": "acme"}).status_code == 403


def test_un_admin_no_crea_el_chatbot_de_otra_empresa(anon):
    a, _ = _con_empresa(anon, "Empresa A", "a@a.cl")
    b, _ = _con_empresa(anon, "Empresa B", "b@b.cl")
    assert b.post("/empresas/empresa-a/chatbot", json=CHATBOT).status_code == 403
    assert a.get("/empresas/empresa-a").json()["chatbotCreated"] is False          # sigue pendiente: B no pudo crearlo
    assert [x["slug"] for x in b.get("/empresas").json()] == ["empresa-b"]          # y cada uno ve solo la suya
    assert b.get("/empresas/empresa-a").status_code == 403


def test_una_cuenta_registra_una_sola_empresa(anon):
    c, _ = _con_empresa(anon)
    r = c.post("/registro/empresa", json={"name": "Segunda Empresa"})
    assert r.status_code == 403                                                    # ya es admin_empresa: dejó de ser «registrado»


def test_nadie_se_asigna_el_rol_registrado_ni_se_convierte_en_superadmin(client, anon):
    assert client.post("/usuarios", json={"email": "r@r.cl", "name": "r", "password": "Clave1234!", "role": "registrado"}).status_code == 422
    _persona(anon)
    lista = client.get("/usuarios").json()
    reg = next(x for x in lista if x["email"] == "ana@miempresa.cl")
    assert reg["role"] == "registrado"                                             # el superadmin ve las cuentas pendientes
    assert client.patch(f"/usuarios/{reg['id']}", json={"role": "superadmin"}).status_code == 422
    assert client.patch(f"/usuarios/{reg['id']}", json={"role": "admin_empresa"}).status_code == 422   # sin empresa no puede ser admin de una


def test_un_admin_de_empresa_no_ve_a_los_registrados(anon, client):
    c, _ = _con_empresa(anon, "Empresa A", "a@a.cl")
    _persona(anon, "otra@persona.cl")
    assert "otra@persona.cl" not in [x["email"] for x in c.get("/usuarios").json()]


# ------------------------------------------------------------------------------------------ validaciones
@pytest.mark.parametrize("email,nombre,password,codigo", [
    ("sin-arroba", "Ana", CLAVE, 422),
    ("a@b", "Ana", CLAVE, 422),
    ("ana@miempresa.cl", "Ana", "corta1", 422),                  # menos de 10 caracteres
    ("ana@miempresa.cl", "Ana", "soloLetrasAquiii", 422),         # sin números
    ("ana@miempresa.cl", "Ana", "12345678901234", 422),           # sin letras
    ("ana@miempresa.cl", "Ana", "xana@miempresa.cl1", 422),       # contiene su correo
    ("ana@miempresa.cl", "Ana", "aaaaaaaaa1", 422),               # repetitiva
    ("ana@miempresa.cl", "A", CLAVE, 422),                        # nombre muy corto
])
def test_validaciones_del_registro(anon, email, nombre, password, codigo):
    assert _registrar(anon, email=email, nombre=nombre, password=password).status_code == codigo


def test_correo_repetido_y_normalizado(anon):
    assert _registrar(anon, email="Ana@MiEmpresa.cl").status_code == 201
    r = _registrar(anon, email="ana@miempresa.cl")
    assert r.status_code == 409 and "Inicia sesión" in r.json()["detail"]
    login = anon.post("/auth/login", json={"email": "ANA@miempresa.cl", "password": CLAVE})
    assert login.status_code == 200 and login.json()["user"]["role"] == "registrado"


def test_campo_trampa_para_bots(anon):
    assert _registrar(anon, website="http://spam.example").status_code == 422


def test_validaciones_de_la_empresa(anon, client, crear_empresa):
    crear_empresa("Acme")
    c = _persona(anon)
    assert c.post("/registro/empresa", json={"name": "Acme"}).status_code == 409            # ya existe (de otra empresa)
    assert c.post("/registro/empresa", json={"name": "Nueva", "siteUrl": "javascript:alert(1)"}).status_code == 422
    assert c.post("/registro/empresa", json={"name": "Nueva", "siteUrl": "no es un sitio"}).status_code == 422
    assert c.post("/registro/empresa", json={"name": "X"}).status_code == 422
    assert c.get("/auth/me").json()["role"] == "registrado"                                   # los intentos fallidos no cambiaron nada


def test_slug_unico_si_solo_cambian_las_tildes(anon, client, crear_empresa):
    crear_empresa("Mi Empresa")
    c = _persona(anon)
    r = c.post("/registro/empresa", json={"name": "Mí Empresa"})
    assert r.status_code == 201 and r.json()["slug"] == "mi-empresa-2"


def test_validaciones_del_chatbot(anon):
    c, _ = _con_empresa(anon)
    assert c.post("/empresas/mi-empresa/chatbot", json={**CHATBOT, "brandColor": "rojo"}).status_code == 422
    assert c.post("/empresas/mi-empresa/chatbot", json={**CHATBOT, "agentName": "x"}).status_code == 422
    assert c.post("/empresas/mi-empresa/chatbot", json={**CHATBOT, "tone": "grosero"}).status_code == 422
    assert c.post("/empresas/mi-empresa/chatbot", json={**CHATBOT, "customInstructions": "a" * 2001}).status_code == 422
    assert c.get("/empresas/mi-empresa").json()["chatbotCreated"] is False                    # nada se creó a medias


def test_el_encargado_del_agente_no_crea_el_chatbot(anon, client):
    c, _ = _con_empresa(anon)
    r = c.post("/usuarios", json={"email": "ag@miempresa.cl", "name": "Ag", "password": "Clave1234!", "role": "encargado_agente"})
    assert r.status_code == 201
    ag = TestClient(app)
    ag.headers["Authorization"] = f"Bearer {ag.post('/auth/login', json={'email': 'ag@miempresa.cl', 'password': 'Clave1234!'}).json()['accessToken']}"
    assert ag.post("/empresas/mi-empresa/chatbot", json=CHATBOT).status_code == 403


# ------------------------------------------------------------------------------------------ límites y apagado
def test_limite_de_cuentas_por_ip(anon):
    codigos = [_registrar(anon, email=f"u{i}@miempresa.cl").status_code for i in range(7)]
    assert codigos[:5] == [201] * 5 and codigos[5] == 429


def test_limite_de_intentos_por_correo(anon):
    codigos = [_registrar(anon, email="ana@miempresa.cl", password="soloLetrasAquiii").status_code for _ in range(4)]
    assert codigos[-1] == 429


def test_registro_cerrado(anon, monkeypatch):
    c = _persona(anon)
    monkeypatch.setattr("app.routers.registro.REGISTRO_ABIERTO", False)
    r = _registrar(anon, email="otra@persona.cl")
    assert r.status_code == 403 and "Alloxentric" in r.json()["detail"]
    assert c.post("/registro/empresa", json={"name": "Mi Empresa"}).status_code == 403


def test_el_login_sigue_igual_para_el_registrado(anon):
    _registrar(anon)
    r = anon.post("/auth/login", json={"email": "ana@miempresa.cl", "password": CLAVE})
    assert r.status_code == 200 and r.json()["user"]["role"] == "registrado"
    assert anon.post("/auth/login", json={"email": "ana@miempresa.cl", "password": "otra-clave-1"}).status_code == 401


# ------------------------------------------------------------------------------------------ plan de gasto (ilimitado o con límite)
def test_el_plan_de_gasto_se_define_al_crear_el_chatbot_y_se_refleja_en_el_panel(anon):
    c, e = _con_empresa(anon)
    assert e["spendPlan"] == {"mode": "sin_limite"}
    b = c.post("/empresas/mi-empresa/chatbot", json={**CHATBOT, "spendPlan": {"mode": "limitado", "monthlyLimitUsd": 100, "dailyLimitUsd": 8}}).json()
    assert b["spendPlan"] == {"mode": "limitado", "monthlyLimitUsd": 100.0, "dailyLimitUsd": 8.0}
    assert c.get("/empresas").json()[0]["spendPlan"]["monthlyLimitUsd"] == 100.0           # lo que ve el panel
    f = c.get("/empresas/mi-empresa/finops").json()
    assert f["plan"]["mode"] == "limitado" and f["plan"]["monthlyLimitUsd"] == 100.0           # y lo que mide el consumo


def test_plan_sin_limite_al_crear_el_chatbot(anon):
    c, _ = _con_empresa(anon)
    b = c.post("/empresas/mi-empresa/chatbot", json=CHATBOT).json()
    assert b["spendPlan"] == {"mode": "sin_limite"}


@pytest.mark.parametrize("plan", [
    {"mode": "limitado"},                                         # falta el monto
    {"mode": "limitado", "monthlyLimitUsd": 0},
    {"mode": "limitado", "monthlyLimitUsd": -5},
    {"mode": "limitado", "monthlyLimitUsd": 10, "dailyLimitUsd": 20},   # el tope diario supera al mensual
    {"mode": "gratis"},
])
def test_plan_invalido_no_crea_el_chatbot(anon, plan):
    c, _ = _con_empresa(anon)
    assert c.post("/empresas/mi-empresa/chatbot", json={**CHATBOT, "spendPlan": plan}).status_code == 422
    assert c.get("/empresas/mi-empresa").json()["chatbotCreated"] is False                  # nada se creó a medias


def test_el_plan_es_obligatorio_para_crear_el_chatbot(anon):
    c, _ = _con_empresa(anon)
    sin_plan = {k: v for k, v in CHATBOT.items() if k != "spendPlan"}
    assert c.post("/empresas/mi-empresa/chatbot", json=sin_plan).status_code == 422


def test_el_admin_cambia_el_plan_despues_y_el_limite_corta_la_ia(anon):
    c, _ = _con_empresa(anon)
    c.post("/empresas/mi-empresa/chatbot", json=CHATBOT)
    r = c.patch("/empresas/mi-empresa/plan", json={"mode": "limitado", "monthlyLimitUsd": 25})
    assert r.status_code == 200 and c.get("/empresas/mi-empresa").json()["spendPlan"]["monthlyLimitUsd"] == 25.0
    assert c.patch("/empresas/mi-empresa/plan", json={"mode": "sin_limite"}).status_code == 200
    assert c.get("/empresas/mi-empresa").json()["spendPlan"] == {"mode": "sin_limite"}
