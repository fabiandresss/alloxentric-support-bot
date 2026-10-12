"""Ciclo de vida del ticket con encuesta de resolución (definición de negocio).

pendiente/urgente -> (el encargado responde y se envía la encuesta) -> esperando_cliente
  -> SÍ: cerrado (final)   -> NO: escalado (gestión fuera del chat)   -> sin respuesta en 72 h: cerrado
"""
import pytest
from sqlalchemy import text
from app.db import engine


def _activar(client, slug):
    assert client.patch(f"/empresas/{slug}", json={"agentStatus": "activo"}).status_code == 200


@pytest.fixture
def caso(client, crear_empresa, usuario_como, anon):
    """Empresa Acme con agente activo, un ticket derivado por un cliente y los roles de empresa."""
    crear_empresa("Acme"), crear_empresa("Beta")
    _activar(client, "acme")
    r = anon.post("/publico/acme/chat", json={"message": "mi tarjeta fue clonada, necesito un humano"}).json()
    tk = usuario_como("acme", "encargado_tickets")
    return {"anon": anon, "cid": r["conversationId"], "tk": tk, "adm": usuario_como("acme", "admin_empresa"),
            "ticket": tk.get("/tickets").json()[0]}


def _responder(caso, texto="Ya bloqueamos tu tarjeta."):
    r = caso["tk"].post(f"/tickets/{caso['ticket']['id']}/respuesta", json={"text": texto})
    assert r.status_code == 200, r.text
    return r.json()


def _estado(caso):
    return caso["tk"].get(f"/tickets/{caso['ticket']['id']}").json()


def test_la_respuesta_del_encargado_envia_la_encuesta(caso):
    assert caso["ticket"]["status"] == "pendiente"
    t = _responder(caso)
    assert t["status"] == "esperando_cliente" and t["transcript"][-1]["sender"] == "agent"
    c = caso["anon"].get(f"/publico/acme/conversaciones/{caso['cid']}").json()
    assert c["ticketStatus"] == "esperando_cliente"      # el cliente ve que tiene una encuesta por responder


def test_cliente_dice_si_el_ticket_se_cierra_y_no_se_reabre(caso, client):
    _responder(caso)
    c = caso["anon"].post(f"/publico/acme/conversaciones/{caso['cid']}/encuesta", json={"resolved": True}).json()
    assert c["ticketStatus"] == "cerrado"
    assert [x["sender"] for x in c["messages"][-2:]] == ["user", "bot"]          # queda constancia en la transcripción
    t = _estado(caso)
    assert t["status"] == "cerrado" and t["closeReason"] == "confirmado_cliente"
    # no se reabre: ni el cliente, ni el encargado, ni se puede volver a responder la encuesta
    assert caso["anon"].post("/publico/acme/chat",
                             json={"message": "otra cosa", "conversationId": caso["cid"]}).status_code == 409
    assert caso["tk"].patch(f"/tickets/{t['id']}", json={"status": "urgente"}).status_code == 409
    assert caso["tk"].post(f"/tickets/{t['id']}/respuesta", json={"text": "hola"}).status_code == 409
    assert caso["adm"].patch(f"/tickets/{t['id']}", json={"status": "pendiente"}).status_code == 409
    assert caso["anon"].post(f"/publico/acme/conversaciones/{caso['cid']}/encuesta",
                             json={"resolved": False}).status_code == 409
    assert client.get("/metricas").json()["openTickets"] == 0
    # una conversación nueva sí es posible (ticket nuevo)
    nueva = caso["anon"].post("/publico/acme/chat", json={"message": "tengo otro problema, quiero un humano"}).json()
    assert nueva["conversationId"] != caso["cid"] and nueva["derived"] is True


def test_cliente_dice_no_el_ticket_se_escala_y_sale_de_la_cola(caso):
    _responder(caso)
    c = caso["anon"].post(f"/publico/acme/conversaciones/{caso['cid']}/encuesta", json={"resolved": False}).json()
    assert c["ticketStatus"] == "escalado" and c["messages"][-1]["isEscalationNotice"] is True
    tid = caso["ticket"]["id"]
    # el encargado de tickets ya no lo ve ni lo puede atender; el bot tampoco responde
    assert caso["tk"].get("/tickets").json() == []
    assert caso["tk"].get(f"/tickets/{tid}").status_code == 403
    assert caso["tk"].post(f"/tickets/{tid}/respuesta", json={"text": "hola"}).status_code == 403
    assert caso["anon"].post("/publico/acme/chat",
                             json={"message": "hola?", "conversationId": caso["cid"]}).status_code == 409
    # lo gestiona el admin de la empresa, fuera del chat; no puede reabrirlo ni responderlo por el chat
    assert [x["status"] for x in caso["adm"].get("/tickets").json()] == ["escalado"]
    assert caso["adm"].patch(f"/tickets/{tid}", json={"status": "pendiente"}).status_code == 409
    assert caso["adm"].post(f"/tickets/{tid}/respuesta", json={"text": "hola"}).status_code == 409
    # el encargado no puede cerrarlo; el admin sí (gestión manual) y queda cerrado para siempre
    assert caso["tk"].patch(f"/tickets/{tid}", json={"status": "cerrado"}).status_code == 403
    t = caso["adm"].patch(f"/tickets/{tid}", json={"status": "cerrado"}).json()
    assert t["status"] == "cerrado" and t["closeReason"] == "gestion_manual"


def test_sin_respuesta_a_la_encuesta_se_cierra_a_las_72_horas(caso):
    _responder(caso)
    with engine.begin() as c:   # simulamos que la encuesta se envió hace 73 h
        c.execute(text("UPDATE tickets SET encuesta_enviada_en = now() - interval '73 hours'"))
    t = caso["tk"].get("/tickets").json()[0]
    assert t["status"] == "cerrado" and t["closeReason"] == "sin_respuesta"
    assert caso["anon"].post(f"/publico/acme/conversaciones/{caso['cid']}/encuesta",
                             json={"resolved": True}).status_code == 409


def test_antes_de_las_72_horas_sigue_esperando(caso):
    _responder(caso)
    with engine.begin() as c:
        c.execute(text("UPDATE tickets SET encuesta_enviada_en = now() - interval '71 hours'"))
    assert caso["tk"].get("/tickets").json()[0]["status"] == "esperando_cliente"


def test_si_el_cliente_escribe_en_vez_de_contestar_vuelve_a_la_cola(caso):
    _responder(caso)
    caso["anon"].post("/publico/acme/chat", json={"message": "no, sigo con el problema", "conversationId": caso["cid"]})
    assert _estado(caso)["status"] == "pendiente"
    # y la encuesta anterior ya no es válida
    assert caso["anon"].post(f"/publico/acme/conversaciones/{caso['cid']}/encuesta",
                             json={"resolved": True}).status_code == 409


def test_la_encuesta_no_cruza_de_empresa_ni_acepta_cualquier_cosa(caso):
    _responder(caso)
    url = f"/conversaciones/{caso['cid']}/encuesta"
    assert caso["anon"].post(f"/publico/beta{url}", json={"resolved": True}).status_code == 404
    assert caso["anon"].post(f"/publico/acme{url}", json={}).status_code == 422
    assert caso["anon"].post("/publico/acme/conversaciones/no-es-uuid/encuesta", json={"resolved": True}).status_code == 404
    assert _estado(caso)["status"] == "esperando_cliente"      # nada cambió


def test_un_ticket_no_se_cierra_a_mano_si_no_esta_escalado(caso):
    tid = caso["ticket"]["id"]
    assert caso["adm"].patch(f"/tickets/{tid}", json={"status": "cerrado"}).status_code == 409
    assert caso["adm"].patch(f"/tickets/{tid}", json={"status": "esperando_cliente"}).status_code == 422
    assert caso["adm"].patch(f"/tickets/{tid}", json={"status": "escalado"}).status_code == 422
    assert caso["adm"].patch(f"/tickets/{tid}", json={"status": "urgente"}).json()["status"] == "urgente"


def test_el_tiempo_de_resolucion_cuenta_hasta_la_respuesta_que_resolvio(caso, client):
    assert client.get("/metricas").json()["avgResolutionTime"] == "—"      # nada cerrado todavía
    _responder(caso)
    caso["anon"].post(f"/publico/acme/conversaciones/{caso['cid']}/encuesta", json={"resolved": True})
    assert client.get("/metricas").json()["avgResolutionTime"] != "—"
    assert client.get("/metricas/analitica").json()["avgHumanResolution"] != "—"
