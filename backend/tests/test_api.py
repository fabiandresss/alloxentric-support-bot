import io
import subprocess
import sys
from pathlib import Path


def activar(client, slug):
    r = client.patch(f"/empresas/{slug}", json={"agentStatus": "activo"})
    assert r.status_code == 200
    return r.json()


def subir_txt(client, slug, nombre, contenido):
    r = client.post(f"/empresas/{slug}/documentos",
                    files={"archivo": (nombre, io.BytesIO(contenido.encode()), "text/plain")})
    assert r.status_code == 201, r.text
    return r.json()


def test_empresas_crud_y_forma_camelcase(client, crear_empresa):
    e = crear_empresa("Acme Salud", industry="Salud", tone="cercano")
    assert e["slug"] == "acme-salud" and e["id"] == "acme-salud"
    assert e["agentStatus"] == "en_configuracion" and e["apiKey"].startswith("ak_")
    assert {"logoInitials", "brandColor", "brandBg", "agentName", "documentsCount", "webChatUrl",
            "monthlyQueries", "botResolutionRate", "ragThreshold", "lastUpdated", "version",
            "customInstructions", "documents"} <= set(e)
    lista = client.get("/empresas").json()
    assert len(lista) == 1 and "apiKey" not in lista[0]
    u = client.patch("/empresas/acme-salud", json={"ragThreshold": 0.6, "agentName": "Sana"}).json()
    assert u["ragThreshold"] == 0.6 and u["agentName"] == "Sana" and u["version"] == "v2.0.0"
    assert client.post("/empresas", json={"name": "Acme Salud"}).status_code == 409
    assert client.get("/empresas/no-existe").status_code == 404


def test_subida_ingesta_y_borrado(client, crear_empresa):
    crear_empresa("Acme")
    d = subir_txt(client, "acme", "faq.txt", "Para reembolsos adjunta tu boleta.\n\nLos reembolsos tardan 5 dias.")
    docs = client.get("/empresas/acme/documentos").json()
    assert docs[0]["status"] == "procesado" and docs[0]["chunkCount"] >= 1  # BackgroundTask ya corrió
    frs = client.get(f"/documentos/{d['id']}/fragmentos").json()
    assert "reembolsos" in frs[0]["text"]
    assert client.post("/empresas/acme/documentos",
                       files={"archivo": ("virus.exe", io.BytesIO(b"x"), "application/octet-stream")}).status_code == 415
    assert client.delete(f"/documentos/{d['id']}").status_code == 204
    assert client.get("/empresas/acme/documentos").json() == []


def test_chat_responde_con_rag_y_deriva_con_ticket(client, crear_empresa):
    e = crear_empresa("Acme")
    subir_txt(client, "acme", "manual.txt", "Los reembolsos de consultas medicas tardan cinco dias habiles en llegar.")
    key = e["apiKey"]
    h = {"X-API-Key": key}
    # agente aún en configuración -> el widget real no responde
    assert client.post("/chat", json={"message": "hola"}, headers=h).status_code == 403
    activar(client, "acme")
    assert client.post("/chat", json={"message": "hola"}).status_code == 422          # falta key
    assert client.post("/chat", json={"message": "hola"}, headers={"X-API-Key": "x"}).status_code == 401
    r = client.post("/chat", json={"message": "cuanto tardan los reembolsos de consultas medicas?",
                                   "customerName": "Ana"}, headers=h).json()
    assert r["derived"] is False and len(r["messages"]) == 2
    bot = r["messages"][1]
    assert bot["sender"] == "bot" and bot["ragSources"] == ["manual.txt"] and bot["confidenceScore"] >= 0.8
    # pregunta sin respaldo -> deriva y crea ticket
    r2 = client.post("/chat", json={"message": "mi tarjeta fue clonada en el extranjero",
                                    "conversationId": r["conversationId"]}, headers=h).json()
    assert r2["derived"] is True and r2["ticketNumber"].startswith("COR-")
    assert r2["messages"][1]["isEscalationNotice"] is True
    # ya derivada: el bot no vuelve a responder, solo se guarda el mensaje del usuario
    r3 = client.post("/chat", json={"message": "sigo esperando", "conversationId": r["conversationId"]},
                     headers=h).json()
    assert len(r3["messages"]) == 1 and r3["ticketNumber"] == r2["ticketNumber"]
    tickets = client.get("/tickets").json()
    assert len(tickets) == 1
    t = tickets[0]
    assert t["ticketNumber"] == r2["ticketNumber"] and t["companyId"] == "acme" and t["status"] == "pendiente"
    assert t["customerName"] == "Ana" and len(t["transcript"]) == 5
    assert t["transcript"][0]["sender"] == "user" and t["assignedAgent"] == "Sin asignar"
    assert t["aiSuggestion"]["summary"]


def test_pedir_humano_deriva(client, crear_empresa):
    crear_empresa("Acme")
    r = client.post("/empresas/acme/probar", json={"message": "quiero hablar", "escalate": True}).json()
    assert r["derived"] is True and r["ticketNumber"]


def test_flujo_ticket_agente(client, crear_empresa):
    crear_empresa("Acme")
    client.post("/empresas/acme/probar", json={"message": "ayuda", "escalate": True})
    t = client.get("/tickets").json()[0]
    p = client.patch(f"/tickets/{t['id']}", json={"status": "urgente", "assignedAgent": "Felipe"}).json()
    assert p["status"] == "urgente" and p["assignedAgent"] == "Felipe"
    assert client.patch(f"/tickets/{t['id']}", json={"status": "inventado"}).status_code == 422
    done = client.post(f"/tickets/{t['id']}/respuesta", json={"text": "Listo, resuelto."}).json()
    assert done["status"] == "resuelto" and done["transcript"][-1]["sender"] == "agent"
    assert done["transcript"][-1]["senderName"] == "Felipe"
    assert client.get("/tickets?status=resuelto").json()[0]["id"] == t["id"]
    assert client.get("/tickets?status=pendiente").json() == []
    assert client.get("/tickets/no-es-uuid").status_code == 404


def test_numeracion_de_tickets_consecutiva(client, crear_empresa):
    crear_empresa("Acme")
    a = client.post("/empresas/acme/probar", json={"message": "x", "escalate": True}).json()["ticketNumber"]
    b = client.post("/empresas/acme/probar", json={"message": "y", "escalate": True}).json()["ticketNumber"]
    assert int(b[4:]) == int(a[4:]) + 1


def test_aislamiento_multitenant(client, crear_empresa):
    """RNF-01 / RF-25: nada de una empresa se filtra a otra."""
    a, b = crear_empresa("Empresa A"), crear_empresa("Empresa B")
    subir_txt(client, "empresa-a", "secreto.txt", "El codigo interno de descuento es ZETA9999 para clientes premium.")
    subir_txt(client, "empresa-b", "otro.txt", "Atendemos de lunes a viernes de nueve a seis.")
    pregunta = {"message": "cual es el codigo interno de descuento para clientes premium?"}
    ra = client.post("/empresas/empresa-a/probar", json=pregunta).json()
    rb = client.post("/empresas/empresa-b/probar", json=pregunta).json()
    assert "ZETA9999" in ra["messages"][1]["message"] and ra["derived"] is False
    assert "ZETA9999" not in str(rb) and rb["derived"] is True
    assert client.get("/empresas/empresa-b/documentos").json()[0]["name"] == "otro.txt"
    # una conversación de A no se puede usar con la key de B
    client.patch("/empresas/empresa-b", json={"agentStatus": "activo"})
    r = client.post("/chat", json={"message": "hola", "conversationId": ra["conversationId"]},
                    headers={"X-API-Key": b["apiKey"]})
    assert r.status_code == 404
    # la lista de documentos de una empresa no mezcla otra
    assert [d["name"] for d in client.get("/empresas/empresa-a/documentos").json()] == ["secreto.txt"]


def test_metricas(client, crear_empresa):
    crear_empresa("Acme")
    activar(client, "acme")
    assert client.get("/metricas").json()["totalConversationsToday"] == 0
    client.post("/empresas/acme/probar", json={"message": "x", "escalate": True})
    m = client.get("/metricas").json()
    assert m["totalConversationsToday"] == 1 and m["openTickets"] == 1 and m["escalationRate"] == 100.0
    assert m["avgResolutionTime"] == "—"
    t = client.get("/tickets").json()[0]
    client.post(f"/tickets/{t['id']}/respuesta", json={"text": "ok"})
    m = client.get("/metricas").json()
    assert m["openTickets"] == 0 and m["avgResolutionTime"] != "—"


def test_seed_carga_el_mock_del_front(client):
    import seed
    seed.main(reset=True)   # el reset borra también al superadmin del fixture: entramos con el del seed
    tok = client.post("/auth/login", json={"email": seed.SUPER_EMAIL, "password": seed.SUPER_PW}).json()["accessToken"]
    client.headers["Authorization"] = f"Bearer {tok}"
    empresas = client.get("/empresas").json()
    assert [e["id"] for e in empresas] == ["wellq", "alloxentric", "dani-eth", "dani27001", "aprueba"]
    w = empresas[0]
    assert w["agentStatus"] == "activo" and w["tone"] == "cercano" and w["ragThreshold"] == 0.78
    assert w["brandColor"] == "#0284C7" and len(w["documents"]) == 5
    assert w["documents"][0]["chunkCount"] in (148, 84, 52, 96, 0)
    tickets = client.get("/tickets").json()
    assert len(tickets) == 8 and tickets[0]["ticketNumber"] == "COR-8921"
    assert tickets[0]["status"] == "urgente" and tickets[0]["isLive"] is True
    assert tickets[0]["transcript"][3]["isEscalationNotice"] is True
    assert tickets[0]["aiSuggestion"]["confidence"] == 0.94
    assert client.get("/metricas").json()["openTickets"] >= 1
    nuevo = client.post("/empresas/wellq/probar", json={"message": "x", "escalate": True}).json()
    assert nuevo["ticketNumber"] == "COR-8922"


def test_ingesta_pdf_y_docx(client, crear_empresa):
    """RF-04: se extrae el texto de PDF y DOCX y queda fragmentado en la BD."""
    from docx import Document
    from reportlab.pdfgen import canvas
    crear_empresa("Acme")
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    c.drawString(72, 750, "Manual PDF: las garantias cubren dos anos desde la compra.")
    c.save()
    d = Document()
    d.add_paragraph("Manual DOCX: el soporte tecnico atiende de lunes a viernes.")
    out = io.BytesIO()
    d.save(out)
    for nombre, datos in (("manual.pdf", buf.getvalue()), ("manual.docx", out.getvalue())):
        r = client.post("/empresas/acme/documentos", files={"archivo": (nombre, io.BytesIO(datos), "application/octet-stream")})
        assert r.status_code == 201, r.text
    docs = {x["name"]: x for x in client.get("/empresas/acme/documentos").json()}
    assert docs["manual.pdf"]["status"] == "procesado" and docs["manual.pdf"]["chunkCount"] >= 1
    assert docs["manual.docx"]["status"] == "procesado" and docs["manual.docx"]["chunkCount"] >= 1
    assert "garantias" in client.get(f"/documentos/{docs['manual.pdf']['id']}/fragmentos").json()[0]["text"]
    assert "soporte tecnico" in client.get(f"/documentos/{docs['manual.docx']['id']}/fragmentos").json()[0]["text"]


def test_documento_corrupto_queda_en_error(client, crear_empresa):
    crear_empresa("Acme")
    r = client.post("/empresas/acme/documentos", files={"archivo": ("roto.pdf", io.BytesIO(b"esto no es un pdf"), "application/pdf")})
    assert r.status_code == 201
    assert client.get("/empresas/acme/documentos").json()[0]["status"] == "error"


def test_chat_publico_por_slug(anon, client, crear_empresa):
    """RF-29: la página /chat/{slug} y el iframe del widget usan /publico/{slug}, sin autenticación."""
    crear_empresa("Acme")
    subir_txt(client, "acme", "manual.txt", "Los reembolsos de consultas medicas tardan cinco dias habiles en llegar.")
    # config pública: solo marca y estado, nunca documentos ni claves
    cfg = anon.get("/publico/acme").json()
    assert set(cfg) == {"name", "agentName", "logoInitials", "brandColor", "brandBg", "agentStatus"}
    assert cfg["agentStatus"] == "en_configuracion"
    assert anon.get("/publico/no-existe").status_code == 404
    # agente aún no activo -> no responde
    assert anon.post("/publico/acme/chat", json={"message": "hola"}).status_code == 403
    activar(client, "acme")
    r = anon.post("/publico/acme/chat", json={"message": "cuanto tardan los reembolsos de consultas medicas?"}).json()
    assert r["derived"] is False and r["messages"][1]["ragSources"] == ["manual.txt"]
    r2 = anon.post("/publico/acme/chat", json={"message": "mi tarjeta fue clonada en el extranjero",
                                               "conversationId": r["conversationId"]}).json()
    assert r2["derived"] is True and r2["ticketNumber"].startswith("COR-")
    assert anon.post("/publico/acme/chat", json={"message": ""}).status_code == 422


def test_chat_publico_aislamiento(anon, client, crear_empresa):
    """Una conversación de A no se continúa por el endpoint público de B, y B no ve datos de A."""
    crear_empresa("Empresa A"), crear_empresa("Empresa B")
    subir_txt(client, "empresa-a", "secreto.txt", "El codigo interno de descuento es ZETA9999 para clientes premium.")
    activar(client, "empresa-a")
    activar(client, "empresa-b")
    pregunta = {"message": "cual es el codigo interno de descuento para clientes premium?"}
    ra = anon.post("/publico/empresa-a/chat", json=pregunta).json()
    rb = anon.post("/publico/empresa-b/chat", json=pregunta).json()
    assert "ZETA9999" in ra["messages"][1]["message"]
    assert "ZETA9999" not in str(rb) and rb["derived"] is True
    r = anon.post("/publico/empresa-b/chat", json={"message": "hola", "conversationId": ra["conversationId"]})
    assert r.status_code == 404
