"""Valoración 👍/👎 de las respuestas, fuentes citadas con su fragmento, horario de atención humana, resumen con IA del ticket y
panel de preguntas sin respuesta. Bedrock es siempre un cliente falso."""
import json
import pytest
from datetime import datetime
from app.config import TZ
from app.services import horario, llm
from tests.test_rag import HORARIO, REEMBOLSOS, _subir

PREGUNTA = "cuanto tardan los reembolsos de consultas medicas?"
FUERA = "mi tarjeta fue clonada en el extranjero, es un fraude urgente"


@pytest.fixture
def acme(client, crear_empresa):
    crear_empresa("Acme")
    _subir(client, "acme", "reembolsos.txt", REEMBOLSOS)
    _subir(client, "acme", "horario.txt", HORARIO)
    client.patch("/empresas/acme", json={"agentStatus": "activo"})


def _publico(anon, mensaje, slug="acme", **kw):
    r = anon.post(f"/publico/{slug}/chat", json={"message": mensaje, **kw})
    assert r.status_code == 200, r.text
    return r.json()


def _valorar(anon, cid, mid, rating, comment=None, slug="acme"):
    return anon.put(f"/publico/{slug}/conversaciones/{cid}/mensajes/{mid}/valoracion", json={"rating": rating, "comment": comment})


# ------------------------------------------------------------------------------------------ valoración
def test_el_cliente_valora_la_respuesta_y_se_ve_en_el_registro_y_la_analitica(client, anon, acme):
    r = _publico(anon, PREGUNTA)
    cid, bot = r["conversationId"], r["messages"][-1]
    ok = _valorar(anon, cid, bot["id"], "down", "no me sirvió, mi rut es 12.345.678-5")
    assert ok.status_code == 200 and ok.json()["rating"] == "down"
    assert "12.345.678" not in ok.json()["ratingComment"] and "[RUT]" in ok.json()["ratingComment"]

    lista = client.get("/empresas/acme/conversaciones", params={"valoracion": "abajo"}).json()
    assert lista["total"] == 1 and lista["items"][0]["thumbsDown"] == 1 and lista["items"][0]["thumbsUp"] == 0
    assert client.get("/empresas/acme/conversaciones", params={"valoracion": "arriba"}).json()["total"] == 0
    detalle = client.get(f"/conversaciones/{cid}").json()
    assert [x.get("rating") for x in detalle["messages"]] == [None, "down"]

    a = client.get("/metricas/analitica", params={"dias": 7}).json()
    assert a["satisfaction"]["rated"] == 1 and a["satisfaction"]["down"] == 1 and a["satisfaction"]["rate"] == 0.0
    assert a["companies"][0]["satisfaction"] == 0.0

    _valorar(anon, cid, bot["id"], "up")                      # cambia de idea
    a = client.get("/metricas/analitica", params={"dias": 7}).json()
    assert a["satisfaction"]["up"] == 1 and a["satisfaction"]["rate"] == 100.0
    quitada = _valorar(anon, cid, bot["id"], None).json()
    assert "rating" not in quitada
    assert client.get("/metricas/analitica").json()["satisfaction"]["rate"] is None


def test_solo_se_valoran_respuestas_del_bot_de_la_misma_conversacion_y_empresa(client, crear_empresa, anon, acme):
    crear_empresa("Beta")
    client.patch("/empresas/beta", json={"agentStatus": "activo"})
    r = _publico(anon, PREGUNTA)
    cid, usuario, bot = r["conversationId"], r["messages"][0], r["messages"][1]
    assert _valorar(anon, cid, usuario["id"], "up").status_code == 404          # un mensaje del cliente no se valora
    assert _valorar(anon, cid, bot["id"], "up", slug="beta").status_code == 404   # la conversación es de otra empresa
    otra = _publico(anon, "a que hora atienden por telefono?")
    assert _valorar(anon, cid, otra["messages"][1]["id"], "up").status_code == 404  # mensaje de otra conversación
    assert _valorar(anon, cid, "no-es-uuid", "up").status_code == 404
    assert anon.put(f"/publico/acme/conversaciones/{cid}/mensajes/{bot['id']}/valoracion", json={"rating": "meh"}).status_code == 422


def test_la_valoracion_tiene_limite_de_peticiones(anon, acme):
    r = _publico(anon, PREGUNTA)
    cid, bot = r["conversationId"], r["messages"][1]
    codigos = [_valorar(anon, cid, bot["id"], "up").status_code for _ in range(32)]
    assert 429 in codigos


# ------------------------------------------------------------------------------------------ fuentes citadas
def test_el_equipo_ve_la_fuente_con_su_fragmento_y_puede_abrirla(client, anon, acme):
    r = client.post("/empresas/acme/probar", json={"message": PREGUNTA}).json()
    det = r["messages"][-1]["sourceDetails"][0]
    assert det["documentName"] == "reembolsos.txt" and "cinco dias" in det["excerpt"] and det["documentId"] and det["fragmentId"]
    frs = client.get("/empresas/acme/kb/fragmentos", params={"documento_id": det["documentId"]}).json()["items"]
    assert det["fragmentId"] in [f["id"] for f in frs]                              # el id apunta a un fragmento real de la KB


def test_el_cliente_ve_las_fuentes_segun_la_politica_de_la_empresa(client, anon, acme):
    def fuente(modo):
        client.patch("/empresas/acme", json={"security": {"pii": True, "injection": True, "forbiddenTopics": [], "publicSources": modo}})
        return _publico(anon, PREGUNTA)["messages"][-1]
    m = fuente("extracto")
    assert m["sourceDetails"][0]["excerpt"] and "documentId" not in m["sourceDetails"][0] and "fragmentId" not in m["sourceDetails"][0]
    m = fuente("nombre")
    assert m["ragSources"] == ["reembolsos.txt"] and "excerpt" not in m["sourceDetails"][0]
    m = fuente("ninguna")
    assert "ragSources" not in m and "sourceDetails" not in m


# ------------------------------------------------------------------------------------------ horario
def _franja_hoy_y_cerrado():
    return DIAS_CERRADO()


def DIAS_CERRADO():
    hoy = datetime.now(TZ).weekday()
    return horario.DIAS[(hoy + 1) % 7]


def test_validacion_del_horario(client, acme):
    mal = lambda dias: client.patch("/empresas/acme", json={"schedule": {"enabled": True, "days": dias, "outOfHoursMessage": ""}})
    assert mal({"lun": ["25:00", "26:00"]}).status_code == 422
    assert mal({"lun": ["18:00", "09:00"]}).status_code == 422
    assert mal({"xyz": ["09:00", "18:00"]}).status_code == 422
    assert mal({"lun": ["09:00"]}).status_code == 422


def test_horario_abierto_y_cerrado(client, anon, acme):
    dias_abiertos = {d: ["00:00", "23:59"] for d in horario.DIAS}
    r = client.patch("/empresas/acme", json={"schedule": {"enabled": True, "days": dias_abiertos, "outOfHoursMessage": ""}})
    assert r.status_code == 200 and r.json()["schedule"]["enabled"] is True
    ag = anon.get("/publico/acme").json()["humanSupport"]
    assert ag["enabled"] is True and ag["open"] is True and ag["message"] is None and ag["schedule"].startswith("Lun–Dom")

    client.patch("/empresas/acme", json={"schedule": {"enabled": True, "days": {DIAS_CERRADO(): ["09:00", "18:00"]}, "outOfHoursMessage": "Volvemos mañana a las 9."}})
    ag = anon.get("/publico/acme").json()["humanSupport"]
    assert ag["open"] is False and ag["message"] == "Volvemos mañana a las 9."


def test_fuera_de_horario_el_ticket_se_crea_igual_y_se_avisa(client, anon, acme):
    client.patch("/empresas/acme", json={"schedule": {"enabled": True, "days": {DIAS_CERRADO(): ["09:00", "18:00"]}, "outOfHoursMessage": "Volvemos mañana a las 9."}})
    r = _publico(anon, FUERA)
    assert r["derived"] is True and r["ticketNumber"].startswith("COR-")
    assert "Volvemos mañana a las 9." in r["messages"][-1]["message"]
    assert len(client.get("/tickets").json()) == 1


def test_sin_horario_configurado_se_asume_atencion_continua(client, anon, acme):
    ag = anon.get("/publico/acme").json()["humanSupport"]
    assert ag["enabled"] is False and ag["open"] is True
    r = _publico(anon, FUERA)
    assert "fuera del horario" not in r["messages"][-1]["message"]


def test_el_encargado_del_agente_puede_cambiar_el_horario(usuario_como, acme):
    c = usuario_como("acme", "encargado_agente")
    r = c.patch("/empresas/acme", json={"schedule": {"enabled": True, "days": {"lun": ["09:00", "13:00"], "mar": ["09:00", "13:00"]}, "outOfHoursMessage": ""}})
    assert r.status_code == 200 and r.json()["schedule"]["days"]["lun"] == ["09:00", "13:00"]


# ------------------------------------------------------------------------------------------ resumen del ticket
class Falso:
    def __init__(self, urgencia="media"):
        self.urgencia, self.llamadas = urgencia, []

    def converse(self, **kw):
        sistema, usuario = kw["system"][0]["text"], kw["messages"][0]["content"][0]["text"]
        self.llamadas.append((sistema, usuario))
        if "Resumes conversaciones" in sistema:
            texto = json.dumps({"resumen": "El cliente reporta una tarjeta clonada en el extranjero y pide ayuda. <b>Urgente</b> https://evil.io/x",
                                "motivo": "La documentación no cubre fraudes.", "urgencia": self.urgencia})
        else:
            texto = "Hola, recibimos tu caso."
        return {"output": {"message": {"content": [{"text": texto}]}}, "usage": {"inputTokens": 500, "outputTokens": 50}}


def test_el_ticket_trae_un_resumen_por_reglas_sin_bedrock(client, anon, acme):
    _publico(anon, FUERA)
    t = client.get("/tickets").json()[0]
    assert t["aiSummary"]["source"] == "reglas" and t["aiSummary"]["urgency"] == "alta"
    assert "tarjeta fue clonada" in t["aiSummary"]["summary"]


def test_el_resumen_con_ia_se_valida_y_nunca_baja_la_urgencia_de_las_reglas(client, anon, acme, monkeypatch):
    f = Falso(urgencia="baja")
    monkeypatch.setattr(llm, "BEDROCK_HABILITADO", True)
    monkeypatch.setattr(llm, "_cliente", f)
    _publico(anon, FUERA)
    res = client.get("/tickets").json()[0]["aiSummary"]
    assert res["source"] == "ia" and res["urgency"] == "alta"          # el modelo dijo «baja», pero «fraude urgente» sube a alta
    assert "<b>" not in res["summary"] and "evil.io" not in res["summary"]   # lo que escribe el modelo se sanea
    resumen_prompts = [u for s, u in f.llamadas if "Resumes conversaciones" in s]
    assert resumen_prompts and "<conversacion_" in resumen_prompts[0]


def test_resumen_con_respuesta_invalida_del_modelo_cae_a_reglas(client, anon, acme, monkeypatch):
    class Roto(Falso):
        def converse(self, **kw):
            r = super().converse(**kw)
            if "Resumes conversaciones" in kw["system"][0]["text"]:
                r["output"]["message"]["content"][0]["text"] = "esto no es json"
            return r
    monkeypatch.setattr(llm, "BEDROCK_HABILITADO", True)
    monkeypatch.setattr(llm, "_cliente", Roto())
    _publico(anon, FUERA)
    assert client.get("/tickets").json()[0]["aiSummary"]["source"] == "reglas"


def test_regenerar_el_resumen_y_aislamiento(client, crear_empresa, anon, acme, usuario_como):
    crear_empresa("Beta")
    _publico(anon, FUERA)
    tid = client.get("/tickets").json()[0]["id"]
    assert client.post(f"/tickets/{tid}/resumen").json()["aiSummary"]["urgency"] == "alta"
    assert usuario_como("beta", "encargado_tickets").post(f"/tickets/{tid}/resumen").status_code in (403, 404)
    assert usuario_como("acme", "encargado_agente").post(f"/tickets/{tid}/resumen").status_code == 403


# ------------------------------------------------------------------------------------------ preguntas sin respuesta
def test_agrupa_lo_que_el_bot_no_pudo_resolver(client, crear_empresa, anon, acme, usuario_como):
    crear_empresa("Beta")
    client.patch("/empresas/beta", json={"agentStatus": "activo"})
    _publico(anon, PREGUNTA)                                              # resuelta: no cuenta
    _publico(anon, "quiero hablar con un humano")                         # pedir una persona no es un vacío de la KB
    _publico(anon, "como cambio mi plan de suscripcion mensual?")
    _publico(anon, "quiero cambiar mi plan de suscripcion mensual")
    _publico(anon, "necesito factura de mi plan de suscripcion mensual")
    _publico(anon, "mi mascota se comio mi tarjeta del banco")
    _publico(anon, "como cambio mi plan de suscripcion mensual?", slug="beta")      # de otra empresa: no debe aparecer en Acme
    r = client.get("/empresas/acme/kb/vacios", params={"dias": 30}).json()
    assert r["totalQuestions"] == 4
    g = r["groups"][0]
    assert g["count"] >= 2 and "plan de suscripcion" in g["topic"] and g["reason"] == "sin_informacion"
    assert "documento" in g["suggestion"] and len(g["questions"]) == g["count"]
    assert all(q["conversationId"] for q in g["questions"])
    assert sum(x["count"] for x in r["groups"]) == 4
    assert client.get("/empresas/beta/kb/vacios").json()["totalQuestions"] == 1
    assert usuario_como("acme", "encargado_tickets").get("/empresas/acme/kb/vacios").status_code == 403
    assert usuario_como("beta", "admin_empresa").get("/empresas/acme/kb/vacios").status_code in (403, 404)


def test_las_respuestas_valoradas_abajo_tambien_son_un_vacio(client, anon, acme):
    r = _publico(anon, PREGUNTA)
    _valorar(anon, r["conversationId"], r["messages"][1]["id"], "down")
    g = client.get("/empresas/acme/kb/vacios").json()["groups"]
    assert len(g) == 1 and g[0]["reason"] == "baja_valoracion" and g[0]["closestDocument"] == "reembolsos.txt"


def test_sin_vacios_el_informe_viene_vacio(client, anon, acme):
    _publico(anon, PREGUNTA)
    assert client.get("/empresas/acme/kb/vacios").json() == {"days": 30, "totalQuestions": 0, "groups": []}
