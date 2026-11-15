"""Ciclo de calidad: alertas de gasto y límite diario, pruebas automáticas, conversación a caso, comparativa de modelos, calibración del juez,
memoria de conversación, versiones de documentos, calidad de la KB, dominios del widget y Celery.

Bedrock se reemplaza por un cliente falso (nunca se llama a AWS).
"""
import json
import pytest
from datetime import datetime, timedelta, timezone
from sqlalchemy import text
from app import models as m
from app.db import SessionLocal, engine
from app.services import llm, motor_rag
from tests.test_rag import HORARIO, REEMBOLSOS, _preguntar, _subir

PREGUNTA = "cuanto tardan los reembolsos de consultas medicas?"
FUERA = "mi tarjeta fue clonada en el extranjero"


class Falso:
    """Bedrock falso: contesta según quién llama (juez, generador, reformulador o agente) y anota el modelo de cada llamada."""
    def __init__(self):
        self.entrada = 1000
        self.puntajes = {}                 # modelId -> puntaje que da el juez (por defecto 0.9)
        self.por_rol, self.prompts, self.llamadas = {}, [], 0

    def converse(self, **kw):
        self.llamadas += 1
        sistema = kw["system"][0]["text"]
        usuario = kw["messages"][0]["content"][0]["text"]
        rol = ("juez" if "evaluador" in sistema else "generador" if "golden set" in sistema else "reformula" if "Reescribe" in sistema else "agente")
        self.por_rol.setdefault(rol, []).append(kw["modelId"])
        self.prompts.append((rol, usuario))
        if rol == "juez":
            texto = json.dumps({"puntaje": self.puntajes.get(kw["modelId"], 0.9), "motivo": "ok"})
        elif rol == "reformula":
            texto = "¿Cuánto tardan los reembolsos de consultas medicas hechas en el extranjero?"
        else:
            texto = "Los reembolsos tardan cinco dias habiles."
        return {"output": {"message": {"content": [{"text": texto}]}}, "usage": {"inputTokens": self.entrada, "outputTokens": 100}}


@pytest.fixture
def bedrock(monkeypatch):
    f = Falso()
    monkeypatch.setattr(llm, "BEDROCK_HABILITADO", True)
    monkeypatch.setattr(llm, "_cliente", f)
    return f


@pytest.fixture
def empresas(client, crear_empresa):
    crear_empresa("Alfa"), crear_empresa("Beta")
    _subir(client, "alfa", "reembolsos.txt", REEMBOLSOS), _subir(client, "alfa", "horario.txt", HORARIO)
    _subir(client, "beta", "secreto.txt", "El codigo interno de descuento es ZETA9999 para clientes premium.")


def _conjunto(client, casos=None, nombre="Reembolsos", slug="alfa", **extra):
    cid = client.post(f"/empresas/{slug}/testing/conjuntos", json={"name": nombre}).json()["id"]
    if extra:
        client.patch(f"/empresas/{slug}/testing/conjuntos/{cid}", json=extra)
    for c in casos or []:
        assert client.post(f"/empresas/{slug}/testing/conjuntos/{cid}/casos", json=c).status_code == 201
    return cid


CASO_OK = {"question": PREGUNTA, "expectedAnswer": "cinco dias habiles", "expectedDocument": "reembolsos.txt"}


def _correr(client, cid, cuerpo=None, slug="alfa"):
    r = client.post(f"/empresas/{slug}/testing/conjuntos/{cid}/ejecutar", json=cuerpo or {})
    assert r.status_code == 202, r.text
    return client.get(f"/empresas/{slug}/testing/ejecuciones/{r.json()['id']}").json()


def _notifs(c, slug="alfa", **q):
    return c.get(f"/empresas/{slug}/notificaciones", params=q).json()


# ====================================================================================== 8. alertas de gasto y límite diario
def test_alertas_al_80_y_al_100_por_ciento_sin_repetirse(client, empresas, bedrock):
    client.patch("/empresas/alfa/plan", json={"mode": "limitado", "monthlyLimitUsd": 2.5})
    bedrock.entrada = 1_000_000                                         # cada respuesta cuesta ~1,5 USD (Haiku: 1 USD de entrada + 0,0005 de salida)
    bedrock.entrada = 800_000                                           # 0,8 + 0,0005 = ~0,8 USD
    for _ in range(3):
        _preguntar(client, "alfa", PREGUNTA)                            # 0,8 / 1,6 / 2,4 USD: llega al 96 %
    tipos = [n["type"] for n in _notifs(client)]
    assert tipos.count("gasto_80") == 1 and "gasto_100" not in tipos
    _preguntar(client, "alfa", PREGUNTA)                                # 3,2 USD: supera el tope
    _preguntar(client, "alfa", PREGUNTA)                                # ya sin IA: nada nuevo
    tipos = [n["type"] for n in _notifs(client)]
    assert tipos.count("gasto_80") == 1 and tipos.count("gasto_100") == 1                  # cada aviso una sola vez


def test_limite_diario_corta_la_ia_y_avisa(client, empresas, bedrock):
    assert client.patch("/empresas/alfa/plan", json={"mode": "limitado", "monthlyLimitUsd": 100, "dailyLimitUsd": 1.5}).json() == {
        "mode": "limitado", "monthlyLimitUsd": 100.0, "dailyLimitUsd": 1.5}
    bedrock.entrada = 1_000_000                                         # ~1,0005 USD por respuesta
    _preguntar(client, "alfa", PREGUNTA)
    b = client.get("/empresas/alfa/finops").json()["billing"]
    assert b["dailyUsedPct"] == pytest.approx(66.7, abs=0.2) and not b["dailyLimitReached"]
    _preguntar(client, "alfa", PREGUNTA)                                # 2,0 USD > 1,5: tope diario alcanzado
    b = client.get("/empresas/alfa/finops").json()["billing"]
    assert b["dailyLimitReached"] is True and not b["limitReached"]                    # el mensual (100) sigue lejos
    antes = bedrock.llamadas
    r = _preguntar(client, "alfa", PREGUNTA)
    assert bedrock.llamadas == antes and r["derived"] is False                         # sin IA hasta mañana, el chat sigue
    assert [n["type"] for n in _notifs(client)] == ["gasto_dia"]


def test_validacion_del_limite_diario(client, empresas):
    assert client.patch("/empresas/alfa/plan", json={"mode": "limitado", "monthlyLimitUsd": 10, "dailyLimitUsd": 20}).status_code == 422   # diario > mensual
    client.patch("/empresas/alfa/plan", json={"mode": "limitado", "monthlyLimitUsd": 10, "dailyLimitUsd": 2})
    assert client.patch("/empresas/alfa/plan", json={"mode": "sin_limite"}).json() == {"mode": "sin_limite"}   # sin límite: se borra también el diario
    assert "dailyLimitUsd" not in client.get("/empresas/alfa/finops").json()["plan"]


def test_notificaciones_ver_marcar_y_aislar(client, empresas, bedrock, usuario_como):
    client.patch("/empresas/alfa/plan", json={"mode": "limitado", "monthlyLimitUsd": 1})
    bedrock.entrada = 1_000_000
    _preguntar(client, "alfa", PREGUNTA)
    n = _notifs(client)[0]
    assert n["type"] == "gasto_100" and n["seen"] is False and n["view"] == "finops"
    admin, agente, ajeno = usuario_como("alfa", "admin_empresa"), usuario_como("alfa", "encargado_agente"), usuario_como("beta", "admin_empresa")
    assert len(_notifs(admin)) == 1 and _notifs(agente) == []                          # el dinero no lo ve el encargado del agente
    assert agente.post(f"/empresas/alfa/notificaciones/{n['id']}/visto").status_code == 404
    assert ajeno.get("/empresas/alfa/notificaciones").status_code == 403               # otra empresa no entra
    assert client.post(f"/empresas/beta/notificaciones/{n['id']}/visto").status_code == 404   # ni con un id ajeno
    assert admin.post(f"/empresas/alfa/notificaciones/{n['id']}/visto").status_code == 204
    assert _notifs(admin, solo_nuevas=True) == [] and _notifs(admin)[0]["seen"] is True
    assert usuario_como("alfa", "encargado_tickets").get("/empresas/alfa/notificaciones").status_code == 403


def test_correo_a_los_admins_si_hay_smtp(client, empresas, bedrock, monkeypatch, usuario_como):
    from app.services import notificaciones
    enviados = []

    class FakeSMTP:
        def __init__(self, host, port, timeout=0): enviados.append(("conecta", host))
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def starttls(self): pass
        def login(self, u, p): pass
        def send_message(self, msg): enviados.append((msg["To"], msg["Subject"]))
    usuario_como("alfa", "admin_empresa", email="jefa@alfa.test")
    monkeypatch.setattr(notificaciones, "SMTP_HOST", "smtp.local")
    monkeypatch.setattr(notificaciones.smtplib, "SMTP", FakeSMTP)
    client.patch("/empresas/alfa/plan", json={"mode": "limitado", "monthlyLimitUsd": 1})
    bedrock.entrada = 1_000_000
    _preguntar(client, "alfa", PREGUNTA)
    assert ("jefa@alfa.test", "alloxentric · Límite mensual de IA alcanzado") in enviados


def test_un_correo_caido_no_rompe_el_chat(client, empresas, bedrock, monkeypatch, usuario_como):
    from app.services import notificaciones

    class Roto:
        def __init__(self, *a, **k): raise OSError("sin red")
    usuario_como("alfa", "admin_empresa")
    monkeypatch.setattr(notificaciones, "SMTP_HOST", "smtp.local")
    monkeypatch.setattr(notificaciones.smtplib, "SMTP", Roto)
    client.patch("/empresas/alfa/plan", json={"mode": "limitado", "monthlyLimitUsd": 1})
    bedrock.entrada = 1_000_000
    assert _preguntar(client, "alfa", PREGUNTA)["messages"]                              # responde igual
    assert len(_notifs(client)) == 1                                                     # y el aviso interno quedó


# ====================================================================================== 1. pruebas automáticas
def test_las_pruebas_automaticas_corren_al_subir_un_documento(client, empresas):
    auto = _conjunto(client, [CASO_OK], autoRun=True)
    manual = _conjunto(client, [CASO_OK], nombre="Solo manual")
    assert client.get(f"/empresas/alfa/testing/conjuntos/{auto}").json()["autoRun"] is True
    _subir(client, "alfa", "faq.txt", "Para cambiar tu clave entra a Mi cuenta y elige Seguridad.")
    runs = client.get("/empresas/alfa/testing/ejecuciones").json()
    assert len(runs) == 1 and runs[0]["setId"] == auto and runs[0]["origin"] == "automatica"
    assert runs[0]["trigger"] == "subir «faq.txt»" and runs[0]["createdBy"] == "Automática" and runs[0]["status"] == "completada"
    assert client.get(f"/empresas/alfa/testing/conjuntos/{manual}").json()["autoRun"] is False


def test_avisa_cuando_borrar_un_documento_empeora_las_pruebas(client, empresas):
    cid = _conjunto(client, [CASO_OK, {"question": "cuanto tardan los reembolsos medicos?", "expectedAnswer": "cinco dias habiles"}], autoRun=True)
    antes = _correr(client, cid)                                            # manual: aprueba
    assert antes["run"]["summary"]["passRate"] == 100
    doc = next(d["id"] for d in client.get("/empresas/alfa/documentos").json() if d["name"] == "reembolsos.txt")
    assert client.delete(f"/documentos/{doc}").status_code == 204          # sin ese documento el agente ya no sabe responder
    auto = [r for r in client.get("/empresas/alfa/testing/ejecuciones").json() if r["origin"] == "automatica"]
    assert len(auto) == 1 and auto[0]["trigger"] == "eliminar «reembolsos.txt»" and auto[0]["summary"]["passRate"] == 0
    n = next(x for x in _notifs(client) if x["type"] == "pruebas_bajaron")
    assert "bajaron de 100 % a 0 %" in n["title"] and n["view"] == "testing" and n["ref"] == auto[0]["id"]
    assert "reembolsos.txt" in n["message"]


def test_avisa_cuando_un_documento_nuevo_mejora_las_pruebas(client, crear_empresa):
    crear_empresa("Alfa")
    cid = _conjunto(client, [CASO_OK], autoRun=True)
    sin_doc = _correr(client, cid)
    assert sin_doc["run"]["summary"]["passRate"] == 0                        # sin documentación no puede responder
    _subir(client, "alfa", "reembolsos.txt", REEMBOLSOS)
    n = next(x for x in _notifs(client) if x["type"] == "pruebas_mejoraron")
    assert "subieron de 0 % a 100 %" in n["title"]


def test_reemplazar_un_documento_tambien_dispara_las_pruebas(client, empresas):
    _conjunto(client, [CASO_OK], autoRun=True)
    doc = next(d["id"] for d in client.get("/empresas/alfa/documentos").json() if d["name"] == "reembolsos.txt")
    r = client.post(f"/documentos/{doc}/reemplazar", files={"archivo": ("reembolsos.txt", b"Los reembolsos ahora tardan cinco dias habiles exactos.", "text/plain")})
    assert r.status_code == 200
    assert client.get("/empresas/alfa/testing/ejecuciones").json()[0]["trigger"] == "reemplazar «reembolsos.txt»"


# ====================================================================================== 2. conversación real -> caso
def test_una_conversacion_real_se_convierte_en_caso(client, empresas, usuario_como):
    conv = _preguntar(client, "alfa", PREGUNTA)["conversationId"]
    cid = _conjunto(client)
    r = client.post(f"/empresas/alfa/testing/conjuntos/{cid}/casos", json={
        "question": PREGUNTA, "expectedAnswer": "cinco dias habiles", "expectedDocument": "reembolsos.txt", "conversationId": conv})
    assert r.status_code == 201 and r.json()["origin"] == "real" and r.json()["conversationId"] == conv
    assert client.get(f"/empresas/alfa/testing/conjuntos/{cid}").json()["cases"][0]["origin"] == "real"
    ajena = _preguntar(client, "beta", "hola que tal")["conversationId"]
    assert client.post(f"/empresas/alfa/testing/conjuntos/{cid}/casos", json={"question": "otra cosa", "conversationId": ajena}).status_code == 404   # de otra empresa
    assert client.post(f"/empresas/alfa/testing/conjuntos/{cid}/casos", json={"question": "otra cosa", "conversationId": "no-uuid"}).status_code == 404


# ====================================================================================== 3. comparar modelos
def test_comparar_modelos_recomienda_el_mas_barato_que_cumple(client, empresas, bedrock):
    cid = _conjunto(client, [CASO_OK])
    r = client.post(f"/empresas/alfa/testing/conjuntos/{cid}/comparar", json={"modelIds": ["haiku-5-5", "nova-lite", "qwen3-32b"], "judgeModelId": "deepseek-v3-2"})
    assert r.status_code == 202, r.text
    g = client.get(f"/empresas/alfa/testing/comparativas/{r.json()['groupId']}").json()
    assert [x["modelId"] for x in g["runs"]] == ["haiku-5-5", "nova-lite", "qwen3-32b"] and all(x["status"] == "completada" for x in g["runs"])
    assert {x["judgeModelId"] for x in g["runs"]} == {"deepseek-v3-2"} and len({x["groupId"] for x in g["runs"]}) == 1
    # el agente usó el modelo de cada corrida, sin tocar el configurado en la empresa
    assert bedrock.por_rol["agente"] == ["us.anthropic.claude-haiku-5-5", "us.amazon.nova-lite-v1:0", "qwen.qwen3-32b-v1:0"]
    assert client.get("/empresas/alfa").json()["aiModel"] == "haiku-5-5"
    nova = next(x for x in g["runs"] if x["modelId"] == "nova-lite")
    assert g["recommendedRunId"] == nova["id"] and "Nova Lite" in g["recommendation"] and "80" in g["recommendation"]   # Nova Lite es el más barato de los que aprueban


def test_comparar_sin_que_nadie_cumpla_la_calidad(client, empresas, bedrock):
    cid = _conjunto(client, [{"question": PREGUNTA, "expectedAnswer": "cinco dias habiles", "expectedDocument": "horario.txt"}])   # documento equivocado: falla
    g = client.post(f"/empresas/alfa/testing/conjuntos/{cid}/comparar", json={"modelIds": ["haiku-5-5", "nova-lite"]}).json()
    g = client.get(f"/empresas/alfa/testing/comparativas/{g['groupId']}").json()
    assert "recommendedRunId" not in g and "Ningún modelo alcanzó" in g["recommendation"]
    assert client.get(f"/empresas/alfa/testing/comparativas/{g['groupId']}?calidad_minima=0").json()["recommendedRunId"]   # con 0 % cualquiera cumple


def test_validaciones_de_la_comparativa(client, empresas):
    cid = _conjunto(client, [CASO_OK])
    base = f"/empresas/alfa/testing/conjuntos/{cid}/comparar"
    assert client.post(base, json={"modelIds": ["haiku-5-5"]}).status_code == 422
    assert client.post(base, json={"modelIds": ["haiku-5-5", "haiku-5-5"]}).status_code == 422                         # repetidos = uno solo
    assert client.post(base, json={"modelIds": ["haiku-5-5", "gpt-inventado"]}).status_code == 422
    assert client.post(base, json={"modelIds": ["haiku-5-5", "nova-lite"], "judgeModelId": "x"}).status_code == 422
    assert client.get("/empresas/beta/testing/comparativas/00000000-0000-0000-0000-000000000000").status_code == 404
    g = client.post(base, json={"modelIds": ["haiku-5-5", "nova-lite"]}).json()["groupId"]
    assert client.get(f"/empresas/beta/testing/comparativas/{g}").status_code == 404                                    # la comparativa es de Alfa


def test_cada_corrida_se_compara_solo_con_el_mismo_modelo(client, empresas, bedrock):
    cid = _conjunto(client, [CASO_OK])
    client.post(f"/empresas/alfa/testing/conjuntos/{cid}/comparar", json={"modelIds": ["haiku-5-5", "nova-lite"]})
    corrida = _correr(client, cid)                                          # manual con Haiku (el modelo de la empresa)
    assert corrida["previous"]["modelId"] == "haiku-5-5"                    # no se compara con la de Nova Lite


# ====================================================================================== 4. calibración del juez
def _correr_y_etiquetar(client, n=12, buenas=8):
    cid = _conjunto(client, [CASO_OK] * n)
    d = _correr(client, cid)
    for i, r in enumerate(d["results"]):
        etiqueta = "correcto" if i < buenas else "incorrecto"
        assert client.put(f"/empresas/alfa/testing/resultados/{r['id']}/etiqueta", json={"label": etiqueta}).json()["humanLabel"] == etiqueta
    return d


def test_etiquetar_resultados(client, empresas, bedrock, usuario_como):
    d = _correr_y_etiquetar(client)
    rid = d["results"][0]["id"]
    assert client.get(f"/empresas/alfa/testing/ejecuciones/{d['run']['id']}").json()["results"][0]["humanLabel"] == "correcto"
    assert "humanLabel" not in client.put(f"/empresas/alfa/testing/resultados/{rid}/etiqueta", json={"label": None}).json()          # quitar la marca
    assert client.put(f"/empresas/beta/testing/resultados/{rid}/etiqueta", json={"label": "correcto"}).status_code == 404             # de otra empresa
    assert client.put(f"/empresas/alfa/testing/resultados/{rid}/etiqueta", json={"label": "quizas"}).status_code == 422
    assert usuario_como("alfa", "encargado_tickets").put(f"/empresas/alfa/testing/resultados/{rid}/etiqueta", json={"label": "correcto"}).status_code == 403


def test_calibrar_mide_cuanto_coincide_cada_juez_con_la_persona(client, empresas, bedrock):
    _correr_y_etiquetar(client, n=12, buenas=8)                                  # la persona: 8 correctas y 4 incorrectas (ya está etiquetado)
    assert client.get("/empresas/alfa/testing/etiquetas").json() == {"labeled": 12, "correct": 8, "incorrect": 4, "minRequired": 10, "maxUsed": 40}
    bedrock.puntajes = {"us.anthropic.claude-haiku-5-5": 0.9, "qwen.qwen3-32b-v1:0": 0.1}   # Haiku aprueba todo; Qwen rechaza todo
    r = client.post("/empresas/alfa/testing/calibraciones", json={"judgeModelIds": ["haiku-5-5", "qwen3-32b"]})
    assert r.status_code == 202, r.text
    c = client.get(f"/empresas/alfa/testing/calibraciones/{r.json()['id']}").json()
    assert c["status"] == "completada" and c["labeled"] == 12 and c["total"] == 24 and c["completed"] == 24
    por = {j["modelId"]: j for j in c["judges"]}
    h, q = por["haiku-5-5"], por["qwen3-32b"]
    assert (h["agreement"], h["truePositives"], h["falsePositives"], h["falseNegatives"]) == (66.7, 8, 4, 0) and h["kappa"] == 0.0     # aprueba lo que la persona rechazó
    assert (q["agreement"], q["trueNegatives"], q["falseNegatives"], q["falsePositives"]) == (33.3, 4, 8, 0) and q["kappa"] == 0.0     # rechaza lo que la persona aprobó
    assert h["avgScoreIfCorrect"] == 0.9 and q["avgScoreIfIncorrect"] == 0.1 and h["costUsd"] > 0 and h["withoutJudge"] == 0
    assert client.get("/empresas/alfa/testing/calibraciones").json()[0]["id"] == c["id"]
    assert client.get(f"/empresas/beta/testing/calibraciones/{c['id']}").status_code == 404


def test_un_juez_perfecto_tiene_kappa_uno():
    from app.services.evaluacion import metricas_acuerdo
    r = metricas_acuerdo([(True, True)] * 6 + [(False, False)] * 4)
    assert r["acuerdo"] == 100 and r["kappa"] == 1.0 and r["precision"] == 100 and r["exhaustividad"] == 100


def test_calibrar_exige_etiquetas_y_bedrock(client, empresas, bedrock, monkeypatch):
    _correr_y_etiquetar(client, n=6, buenas=3)
    r = client.post("/empresas/alfa/testing/calibraciones", json={"judgeModelIds": ["haiku-5-5"]})
    assert r.status_code == 409 and "Faltan etiquetas" in r.json()["detail"]
    assert client.post("/empresas/alfa/testing/calibraciones", json={"judgeModelIds": ["gpt-inventado"]}).status_code == 422
    assert client.post("/empresas/alfa/testing/calibraciones", json={"judgeModelIds": []}).status_code == 422
    monkeypatch.setattr(llm, "BEDROCK_HABILITADO", False)
    assert "Bedrock" in client.post("/empresas/alfa/testing/calibraciones", json={"judgeModelIds": ["haiku-5-5"]}).json()["detail"]


# ====================================================================================== 5. memoria de conversación
def test_deteccion_de_mensajes_que_dependen_de_lo_anterior():
    for t in ("¿y si es en el extranjero?", "y en el extranjero", "eso cuanto cuesta", "pero tambien sirve para menores de edad?", "mas info"):
        assert motor_rag._depende(t), t
    for t in ("cuanto tardan los reembolsos de consultas medicas en llegar a mi cuenta?", "quiero cambiar la hora de mi cita medica para el viernes"):
        assert not motor_rag._depende(t), t


def test_sin_llm_la_consulta_se_completa_con_la_pregunta_anterior(client, empresas):
    with SessionLocal() as db:
        e = db.query(m.Empresa).filter_by(slug="alfa").one()
        h = [("usuario", "cuanto tardan los reembolsos?"), ("bot", "Cinco dias habiles."), ("usuario", "ok gracias")]
        assert motor_rag._autonoma(db, e, "y si es en el extranjero?", h) == "ok gracias y si es en el extranjero?"
        assert motor_rag._autonoma(db, e, "y si es en el extranjero?", None) == "y si es en el extranjero?"                            # sin historial: igual que antes
        assert motor_rag._autonoma(db, e, "quiero saber los horarios de atencion telefonica por favor", h).startswith("quiero saber")  # se entiende solo


def test_el_agente_entiende_el_seguimiento_con_ia(client, empresas, bedrock):
    r1 = _preguntar(client, "alfa", PREGUNTA)
    assert "reformula" not in bedrock.por_rol                                       # el primer mensaje no necesita memoria
    r2 = client.post("/empresas/alfa/probar", json={"message": "y si es en el extranjero?", "conversationId": r1["conversationId"]}).json()
    assert bedrock.por_rol["reformula"] == ["us.anthropic.claude-haiku-5-5"]
    gen = [p for rol, p in bedrock.prompts if rol == "agente"][-1]
    assert "Conversación previa" in gen and "Cliente: " + PREGUNTA in gen and "y si es en el extranjero?" in gen    # el modelo ve el contexto
    assert r2["derived"] is False


def test_la_reformulacion_gasta_tokens_y_respeta_el_tope(client, empresas, bedrock):
    r1 = _preguntar(client, "alfa", PREGUNTA)
    client.patch("/empresas/alfa/plan", json={"mode": "limitado", "monthlyLimitUsd": 0.01})
    bedrock.entrada = 1_000_000
    _preguntar(client, "alfa", PREGUNTA)                                              # supera el tope
    antes = bedrock.llamadas
    client.post("/empresas/alfa/probar", json={"message": "y si es en el extranjero?", "conversationId": r1["conversationId"]})
    assert bedrock.llamadas == antes                                                  # con el tope alcanzado no se reformula con IA (usa la heurística)


# ====================================================================================== 6. versiones de documentos
def _doc(client, nombre="reembolsos.txt", slug="alfa"):
    return next(d for d in client.get(f"/empresas/{slug}/documentos").json() if d["name"] == nombre)


def test_reemplazar_conserva_el_historial_y_actualiza_la_base(client, empresas):
    doc = _doc(client)
    r = client.post(f"/documentos/{doc['id']}/reemplazar", files={"archivo": ("reembolsos_v2.txt", b"Los reembolsos ahora tardan diez dias habiles contados desde el reclamo.", "text/plain")})
    assert r.status_code == 200 and r.json()["name"] == "reembolsos_v2.txt" and r.json()["status"] in ("procesando", "procesado")
    v = client.get(f"/documentos/{doc['id']}/versiones").json()
    assert [(x["version"], x["current"], x["name"]) for x in v] == [(2, True, "reembolsos_v2.txt"), (1, False, "reembolsos.txt")] and v[1]["restorable"] and v[1]["fragments"] == 1
    textos = " ".join(c["text"] for c in client.get("/empresas/alfa/kb/fragmentos").json()["items"])
    assert "diez dias habiles" in textos and "cinco dias habiles" not in textos                        # el contenido viejo ya no está en la base


def test_volver_a_una_version_anterior(client, empresas):
    doc = _doc(client)
    client.post(f"/documentos/{doc['id']}/reemplazar", files={"archivo": ("v2.txt", b"Version nueva del documento de reembolsos con otros plazos distintos.", "text/plain")})
    r = client.post(f"/documentos/{doc['id']}/versiones/1/restaurar")
    assert r.status_code == 200
    v = client.get(f"/documentos/{doc['id']}/versiones").json()
    assert v[0]["version"] == 3 and v[0]["current"] and v[0]["name"] == "reembolsos.txt" and len(v) == 3
    textos = " ".join(c["text"] for c in client.get("/empresas/alfa/kb/fragmentos").json()["items"])
    assert "cinco dias habiles" in textos and "otros plazos distintos" not in textos
    assert client.post(f"/documentos/{doc['id']}/versiones/99/restaurar").status_code == 404


def test_versiones_validaciones_y_aislamiento(client, empresas, usuario_como):
    doc = _doc(client)
    assert client.post(f"/documentos/{doc['id']}/reemplazar", files={"archivo": ("malo.exe", b"x", "application/octet-stream")}).status_code == 415
    ajeno = usuario_como("beta", "admin_empresa")
    assert ajeno.get(f"/documentos/{doc['id']}/versiones").status_code == 403
    assert ajeno.post(f"/documentos/{doc['id']}/reemplazar", files={"archivo": ("a.txt", b"hola", "text/plain")}).status_code == 403
    assert ajeno.post(f"/documentos/{doc['id']}/versiones/1/restaurar").status_code == 403
    assert usuario_como("alfa", "encargado_tickets").get(f"/documentos/{doc['id']}/versiones").status_code == 403


def test_borrar_el_documento_borra_su_historial_y_archivos(client, empresas):
    doc = _doc(client)
    client.post(f"/documentos/{doc['id']}/reemplazar", files={"archivo": ("v2.txt", b"Contenido nuevo de la segunda version del documento.", "text/plain")})
    with SessionLocal() as db:
        rutas = [v.ruta_local for v in db.query(m.DocumentoVersion).all()]
    assert len(rutas) == 1 and __import__("pathlib").Path(rutas[0]).is_file()
    assert client.delete(f"/documentos/{doc['id']}").status_code == 204
    with SessionLocal() as db:
        assert db.query(m.DocumentoVersion).count() == 0
    assert not __import__("pathlib").Path(rutas[0]).exists()


# ====================================================================================== 7. calidad de la base de conocimiento
def test_una_base_sana_tiene_100(client, empresas):
    q = client.get("/empresas/alfa/kb/calidad").json()
    assert q["score"] == 100 and q["issues"] == [] and q["documentsChecked"] == 2 and q["fragmentsChecked"] == 2


def test_detecta_documentos_vacios_duplicados_y_fragmentos_cortos(client, empresas):
    _subir(client, "alfa", "vacio.txt", "   \n\n  ")
    _subir(client, "alfa", "reembolsos_copia.txt", REEMBOLSOS)                    # el mismo contenido que reembolsos.txt
    _subir(client, "alfa", "titulos.txt", "Menu")
    q = {i["code"]: i for i in client.get("/empresas/alfa/kb/calidad").json()["issues"]}
    assert q["sin_contenido"]["severity"] == "alta" and q["sin_contenido"]["documents"] == ["vacio.txt"]
    assert q["duplicados"]["documents"] == ["reembolsos.txt", "reembolsos_copia.txt"] and q["duplicados"]["count"] == 1
    assert q["casi_iguales"]["severity"] == "alta" and "reembolsos.txt ≈ reembolsos_copia.txt" in q["casi_iguales"]["detail"]
    assert q["fragmentos_cortos"]["documents"] == ["titulos.txt"] and q["fragmentos_cortos"]["severity"] == "baja"
    assert client.get("/empresas/alfa/kb/calidad").json()["score"] == 100 - 25 - 12 - 25 - 5
    assert client.get("/empresas/beta/kb/calidad").json()["issues"] == []              # cada empresa ve lo suyo


def test_detecta_fragmentos_sin_vector(client, empresas):
    with engine.begin() as c:
        c.execute(text("UPDATE fragmentos_embeddings SET embedding = NULL WHERE texto LIKE '%reembolsos%'"))
    i = next(x for x in client.get("/empresas/alfa/kb/calidad").json()["issues"] if x["code"] == "sin_vector")
    assert i["severity"] == "alta" and i["documents"] == ["reembolsos.txt"] and "reindexar" in i["detail"]


def test_permisos_de_la_calidad(client, empresas, usuario_como):
    assert usuario_como("alfa", "encargado_agente").get("/empresas/alfa/kb/calidad").status_code == 200
    assert usuario_como("alfa", "encargado_tickets").get("/empresas/alfa/kb/calidad").status_code == 403
    assert usuario_como("beta", "admin_empresa").get("/empresas/alfa/kb/calidad").status_code == 403


# ====================================================================================== 9. dominios permitidos del widget
def _activar(client, slug="alfa"):
    assert client.patch(f"/empresas/{slug}", json={"agentStatus": "activo"}).status_code == 200


def test_normaliza_y_valida_los_dominios(client, empresas):
    r = client.patch("/empresas/alfa", json={"allowedDomains": ["https://Mi-Sitio.cl/ruta?x=1", "*.Otro.cl", "mi-sitio.cl", "localhost:3000"]})
    assert r.status_code == 200 and r.json()["allowedDomains"] == ["mi-sitio.cl", "*.otro.cl", "localhost"]
    for malo in (["sin punto"], ["*.*.cl"], ["http://"], ["a" * 300 + ".cl"]):
        assert client.patch("/empresas/alfa", json={"allowedDomains": malo}).status_code == 422, malo
    assert client.patch("/empresas/alfa", json={"allowedDomains": [f"s{i}.cl" for i in range(21)]}).status_code == 422
    assert client.patch("/empresas/alfa", json={"allowedDomains": []}).json()["allowedDomains"] == []        # vacío = cualquier sitio
    assert client.get("/empresas/beta").json()["allowedDomains"] == []


def test_el_widget_solo_responde_en_los_sitios_autorizados(client, empresas, anon):
    _activar(client)
    client.patch("/empresas/alfa", json={"allowedDomains": ["mi-sitio.cl", "*.otro.cl"]})
    chat = lambda host=None, **h: anon.post("/publico/alfa/chat", json={"message": "hola"}, headers={**({"X-Embed-Host": host} if host else {}), **h}).status_code   # noqa: E731
    assert chat("mi-sitio.cl") == 200 and chat("MI-SITIO.CL") == 200 and chat("tienda.otro.cl") == 200 and chat("otro.cl") == 200
    assert chat("malo.com") == 403 and chat("mi-sitio.cl.malo.com") == 403 and chat("notmi-sitio.cl") == 403
    assert chat(Origin="https://malo.com") == 403 and chat(Origin="https://mi-sitio.cl") == 200              # llamada directa desde un navegador
    assert chat(Referer="https://malo.com/pagina") == 403
    assert chat() == 200                                                                                      # integración servidor a servidor: sin cabeceras de navegador
    assert anon.get("/publico/alfa", headers={"X-Embed-Host": "malo.com"}).status_code == 403                # ni siquiera se pintan los datos de marca
    assert anon.get("/publico/alfa", headers={"X-Embed-Host": "mi-sitio.cl"}).status_code == 200


def test_la_propia_pagina_publica_siempre_funciona_y_sin_lista_todo_vale(client, empresas, anon):
    _activar(client)
    assert anon.post("/publico/alfa/chat", json={"message": "hola"}, headers={"Origin": "https://malo.com"}).status_code == 200      # sin dominios: abierto
    client.patch("/empresas/alfa", json={"allowedDomains": ["mi-sitio.cl"]})
    propio = "http://localhost:3000"                                                                                                  # PUBLIC_CHAT_BASE_URL por defecto
    assert anon.post("/publico/alfa/chat", json={"message": "hola"}, headers={"Origin": propio}).status_code == 200
    assert anon.post("/publico/alfa/chat", json={"message": "hola"}, headers={"Origin": propio, "X-Embed-Host": "malo.com"}).status_code == 403   # embebida en otro sitio


def test_los_dominios_de_una_empresa_no_afectan_a_otra(client, empresas, anon):
    _activar(client), _activar(client, "beta")
    client.patch("/empresas/alfa", json={"allowedDomains": ["mi-sitio.cl"]})
    assert anon.post("/publico/beta/chat", json={"message": "hola"}, headers={"X-Embed-Host": "malo.com"}).status_code == 200


def test_la_api_key_tambien_respeta_los_dominios(client, empresas, anon):
    _activar(client)
    key = client.post("/empresas/alfa/api-key").json()["apiKey"]
    client.patch("/empresas/alfa", json={"allowedDomains": ["mi-sitio.cl"]})
    h = {"X-API-Key": key}
    assert anon.post("/chat", json={"message": "hola"}, headers=h).status_code == 200
    assert anon.post("/chat", json={"message": "hola"}, headers={**h, "Origin": "https://malo.com"}).status_code == 403
    assert anon.post("/chat", json={"message": "hola"}, headers={**h, "Origin": "https://mi-sitio.cl"}).status_code == 200


def test_solo_el_rol_del_agente_cambia_los_dominios(client, empresas, usuario_como):
    assert usuario_como("alfa", "encargado_tickets").patch("/empresas/alfa", json={"allowedDomains": ["a.cl"]}).status_code == 403
    assert usuario_como("beta", "admin_empresa").patch("/empresas/alfa", json={"allowedDomains": ["a.cl"]}).status_code == 403
    assert usuario_como("alfa", "encargado_agente").patch("/empresas/alfa", json={"allowedDomains": ["a.cl"]}).status_code == 200


# ====================================================================================== 10. Celery + Redis
@pytest.fixture
def celery_eager():
    from app.celery_app import celery
    celery.conf.task_always_eager = True
    yield celery
    celery.conf.task_always_eager = False


def test_la_ingesta_pasa_por_celery_cuando_esta_activado(client, crear_empresa, monkeypatch, celery_eager):
    from app.routers import documentos
    from app import tasks
    crear_empresa("Alfa")
    llamadas = []
    original = tasks.procesar_documento.delay
    monkeypatch.setattr(tasks.procesar_documento, "delay", lambda *a, **k: (llamadas.append(a), original(*a, **k))[1])
    monkeypatch.setattr(documentos, "INGESTA_BACKEND", "celery")
    d = _subir(client, "alfa", "r.txt", REEMBOLSOS)
    assert len(llamadas) == 1 and llamadas[0][1] == "subir"                                   # lo recibió la tarea, con el motivo
    assert client.get("/empresas/alfa/documentos").json()[0]["status"] == "procesado" and d["status"] in ("procesando", "procesado")


def test_si_celery_no_responde_se_procesa_igual(client, crear_empresa, monkeypatch):
    from app.routers import documentos
    from app import tasks
    crear_empresa("Alfa")

    def roto(*a, **k):
        raise ConnectionError("Redis caido")
    monkeypatch.setattr(tasks.procesar_documento, "delay", roto)
    monkeypatch.setattr(documentos, "INGESTA_BACKEND", "celery")
    _subir(client, "alfa", "r.txt", REEMBOLSOS)
    assert client.get("/empresas/alfa/documentos").json()[0]["status"] == "procesado"          # cayó a BackgroundTasks: subir nunca falla por el broker


def test_la_tarea_periodica_cierra_las_encuestas_vencidas(client, crear_empresa, usuario_como, anon):
    from app import tasks
    crear_empresa("Alfa"), crear_empresa("Beta")
    _activar(client), _activar(client, "beta")
    for slug in ("alfa", "beta"):
        anon.post(f"/publico/{slug}/chat", json={"message": "necesito un humano por favor"})
    antes = datetime.now(timezone.utc) - timedelta(hours=200)
    with engine.begin() as c:
        c.execute(text("UPDATE tickets SET estado = 'esperando_cliente', encuesta_enviada_en = :t"), {"t": antes})
    assert tasks.cerrar_encuestas_vencidas() == 2                                              # de TODAS las empresas, sin que nadie abra la app
    assert {t["status"] for t in client.get("/tickets").json()} == {"cerrado"}


def test_el_cierre_periodico_esta_en_el_calendario_de_celery():
    from app.celery_app import celery
    prog = celery.conf.beat_schedule["cerrar-encuestas-vencidas"]
    assert prog["task"] == "app.tasks.cerrar_encuestas_vencidas" and prog["schedule"] == 900.0
