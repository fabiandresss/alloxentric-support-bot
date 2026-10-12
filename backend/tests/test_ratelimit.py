"""Rate limiting de los endpoints sin sesión: chat público, widget y login (app/ratelimit.py)."""
import pytest
from app import ratelimit
from app.ratelimit import VentanaDeslizante


def _activar(client, slug):
    assert client.patch(f"/empresas/{slug}", json={"agentStatus": "activo"}).status_code == 200


def test_ventana_deslizante():
    t = [0.0]
    v = VentanaDeslizante(lambda: t[0])
    assert all(v.permitir("k", 3, 60)[0] for _ in range(3))
    ok, espera = v.permitir("k", 3, 60)
    assert not ok and espera == 60                 # bloqueada hasta que venza la primera marca
    t[0] = 30
    assert v.permitir("k", 3, 60) == (False, 30)
    t[0] = 60.5                                    # la ventana se desliza: vuelve a haber cupo
    assert v.permitir("k", 3, 60)[0]
    assert v.permitir("otra", 3, 60)[0]            # las claves son independientes


@pytest.fixture
def acme(client, crear_empresa):
    crear_empresa("Acme"), crear_empresa("Beta")
    _activar(client, "acme"), _activar(client, "beta")


def test_conversaciones_nuevas_limitadas_por_ip_y_empresa(anon, acme):
    ids = []
    for i in range(6):
        r = anon.post("/publico/acme/chat", json={"message": f"hola {i}"})
        assert r.status_code == 200
        ids.append(r.json()["conversationId"])
    r = anon.post("/publico/acme/chat", json={"message": "una más"})
    assert r.status_code == 429 and int(r.headers["retry-after"]) >= 1
    assert "Demasiadas solicitudes" in r.json()["detail"]
    # seguir una conversación existente no cuenta como "nueva"
    assert anon.post("/publico/acme/chat", json={"message": "sigo", "conversationId": ids[0]}).status_code == 200
    # otra empresa no queda afectada por el abuso contra Acme
    assert anon.post("/publico/beta/chat", json={"message": "hola"}).status_code == 200


def test_mensajes_por_minuto(anon, acme):
    cid = anon.post("/publico/acme/chat", json={"message": "necesito un humano ahora"}).json()["conversationId"]
    for _ in range(19):   # 1 (la anterior) + 19 = 20 por minuto
        assert anon.post("/publico/acme/chat", json={"message": "...", "conversationId": cid}).status_code == 200
    assert anon.post("/publico/acme/chat", json={"message": "...", "conversationId": cid}).status_code == 429


def test_sondeo_de_la_conversacion_limitado(anon, acme):
    cid = anon.post("/publico/acme/chat", json={"message": "hola"}).json()["conversationId"]
    for _ in range(30):
        assert anon.get(f"/publico/acme/conversaciones/{cid}").status_code == 200
    assert anon.get(f"/publico/acme/conversaciones/{cid}").status_code == 429


def test_encuesta_limitada(anon, acme):
    cid = anon.post("/publico/acme/chat", json={"message": "hola"}).json()["conversationId"]
    codigos = [anon.post(f"/publico/acme/conversaciones/{cid}/encuesta", json={"resolved": True}).status_code
               for _ in range(11)]
    assert codigos[:10] == [409] * 10 and codigos[10] == 429     # 409 = no hay encuesta pendiente; el 11.º ya ni se evalúa


def test_login_contra_fuerza_bruta(anon, client, crear_empresa, usuario_como):
    crear_empresa("Acme")
    usuario_como("acme", "encargado_tickets")
    email = "encargado_tickets@acme.test"
    # el login de usuario_como ya contó 1 de los 8 intentos/min de este correo
    for _ in range(7):
        assert anon.post("/auth/login", json={"email": email, "password": "mala"}).status_code == 401
    # ni siquiera la clave correcta pasa durante el bloqueo
    r = anon.post("/auth/login", json={"email": email, "password": "Clave1234!"})
    assert r.status_code == 429 and "retry-after" in r.headers
    # otro correo desde la misma IP sigue pudiendo entrar
    assert anon.post("/auth/login", json={"email": "root@alloxentric.test", "password": "SuperSecreta1"}).status_code == 200


def test_se_puede_desactivar(anon, acme, monkeypatch):
    monkeypatch.setattr(ratelimit, "RATE_LIMIT_ENABLED", False)
    assert all(anon.post("/publico/acme/chat", json={"message": f"hola {i}"}).status_code == 200 for i in range(8))
