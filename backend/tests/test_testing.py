"""Pruebas del agente (golden sets, corridas, comparación, CSV) y base de conocimiento.

Bedrock se reemplaza por un cliente falso: nunca se llama a AWS. Las corridas se ejecutan en segundo plano, pero el TestClient
las termina antes de devolver la respuesta, así que se pueden leer enseguida.
"""
import csv
import io
import json
import pytest
from datetime import datetime, timezone
from app import models as m
from app.db import SessionLocal
from app.services import llm
from tests.test_rag import HORARIO, REEMBOLSOS, _subir

PREGUNTA = "cuanto tardan los reembolsos de consultas medicas?"
FUERA = "mi tarjeta fue clonada en el extranjero"


class BedrockFalso:
    """Responde distinto según quién llama: evaluador (JSON con puntaje), generador de casos (arreglo JSON) o el agente."""
    def __init__(self, puntaje=0.9):
        self.puntaje, self.llamadas, self.sistemas, self.entrada = puntaje, 0, [], 1000
        self.por_rol, self.juez_roto = {}, False      # modelId usado por cada rol (juez, generador, agente) y juez que no devuelve JSON

    def converse(self, **kw):
        self.llamadas += 1
        sistema = kw["system"][0]["text"]
        self.sistemas.append(sistema)
        rol = "juez" if "evaluador" in sistema else "generador" if "golden set" in sistema else "agente"
        self.por_rol.setdefault(rol, []).append(kw["modelId"])
        if rol == "juez":
            texto = "No puedo puntuar esto." if self.juez_roto else json.dumps({"puntaje": self.puntaje, "motivo": "Coincide con lo esperado."})
        elif rol == "generador":
            texto = json.dumps([
                {"question": "¿Cuánto demoran los reembolsos?", "expectedAnswer": "Cinco días hábiles", "document": "reembolsos.txt", "shouldEscalate": False},
                {"question": "¿Cuánto demoran los reembolsos?", "expectedAnswer": "duplicada", "document": "reembolsos.txt", "shouldEscalate": False},
                {"question": "¿Hasta qué hora atienden?", "expectedAnswer": "A las seis", "document": "documento-inventado.txt", "shouldEscalate": False},
                {"question": "¿Puedo pagar con criptomonedas?", "expectedAnswer": "", "document": "", "shouldEscalate": True}])
        else:
            texto = "Los reembolsos tardan cinco dias habiles."
        return {"output": {"message": {"content": [{"text": texto}]}}, "usage": {"inputTokens": self.entrada, "outputTokens": 100}}


@pytest.fixture
def bedrock(monkeypatch):
    falso = BedrockFalso()
    monkeypatch.setattr(llm, "BEDROCK_HABILITADO", True)
    monkeypatch.setattr(llm, "_cliente", falso)
    return falso


@pytest.fixture
def empresas(client, crear_empresa):
    crear_empresa("Alfa"), crear_empresa("Beta")
    _subir(client, "alfa", "reembolsos.txt", REEMBOLSOS), _subir(client, "alfa", "horario.txt", HORARIO)
    _subir(client, "beta", "secreto.txt", "El codigo interno de descuento es ZETA9999 para clientes premium.")


def _conjunto(client, slug="alfa", nombre="Reembolsos", casos=None):
    r = client.post(f"/empresas/{slug}/testing/conjuntos", json={"name": nombre})
    assert r.status_code == 201, r.text
    cid = r.json()["id"]
    for c in casos or []:
        assert client.post(f"/empresas/{slug}/testing/conjuntos/{cid}/casos", json=c).status_code == 201
    return cid


CASOS = [
    {"question": PREGUNTA, "expectedAnswer": "cinco dias habiles", "expectedDocument": "reembolsos.txt"},      # debe aprobar
    {"question": FUERA, "shouldEscalate": True},                                                              # debe derivar y deriva
    {"question": PREGUNTA, "expectedAnswer": "cinco dias habiles", "expectedDocument": "horario.txt"},        # cita el documento equivocado
]


def _ejecutar(client, cid, slug="alfa"):
    r = client.post(f"/empresas/{slug}/testing/conjuntos/{cid}/ejecutar")
    assert r.status_code == 202, r.text
    d = client.get(f"/empresas/{slug}/testing/ejecuciones/{r.json()['id']}")
    assert d.status_code == 200, d.text
    return d.json()


# ------------------------------------------------------------------------------------------ conjuntos y casos
def test_crud_de_conjuntos_y_casos(client, empresas):
    cid = _conjunto(client, casos=CASOS[:2])
    c = client.get(f"/empresas/alfa/testing/conjuntos/{cid}").json()
    assert c["caseCount"] == 2 and [x["order"] for x in c["cases"]] == [1, 2] and c["cases"][1]["shouldEscalate"] is True
    caso = c["cases"][0]["id"]
    ed = client.patch(f"/empresas/alfa/testing/casos/{caso}", json={"shouldEscalate": True}).json()
    assert ed["shouldEscalate"] is True and "expectedAnswer" not in ed and "expectedDocument" not in ed     # derivar anula lo esperado
    assert client.patch(f"/empresas/alfa/testing/conjuntos/{cid}", json={"name": "Nuevo nombre"}).json()["name"] == "Nuevo nombre"
    assert client.delete(f"/empresas/alfa/testing/casos/{caso}").status_code == 204
    assert client.get(f"/empresas/alfa/testing/conjuntos/{cid}").json()["caseCount"] == 1
    assert client.delete(f"/empresas/alfa/testing/conjuntos/{cid}").status_code == 204
    assert client.get("/empresas/alfa/testing/conjuntos").json() == []


def test_validaciones(client, empresas):
    cid = _conjunto(client)
    assert client.post("/empresas/alfa/testing/conjuntos", json={"name": ""}).status_code == 422
    assert client.post(f"/empresas/alfa/testing/conjuntos/{cid}/casos", json={"question": "a"}).status_code == 422
    assert client.post(f"/empresas/alfa/testing/conjuntos/{cid}/ejecutar").status_code == 409            # sin casos
    assert client.get("/empresas/alfa/testing/conjuntos/no-es-uuid").status_code == 404


# ------------------------------------------------------------------------------------------ corridas y métricas
def test_corrida_evalua_cada_caso_y_calcula_metricas(client, empresas):
    cid = _conjunto(client, casos=CASOS)
    d = _ejecutar(client, cid)
    run, res = d["run"], d["results"]
    assert run["status"] == "completada" and run["completed"] == run["total"] == 3 and run["modelId"] == "haiku-5-5"
    assert run["kb"]["documents"] == 2 and run["kb"]["fragments"] == 2
    assert [r["verdict"] for r in res] == ["aprobado", "aprobado", "fallido"]
    assert res[2]["sourceOk"] is False and "horario.txt" in res[2]["reason"]
    assert res[1]["escalated"] is True and res[1]["escalationOk"] is True
    s = run["summary"]
    assert (s["total"], s["passed"], s["failed"], s["errors"]) == (3, 2, 1, 0) and s["passRate"] == pytest.approx(66.7, abs=0.1)
    assert s["derivationAccuracy"] == 100 and s["sourceAccuracy"] == 50 and s["p95LatencyMs"] >= s["avgLatencyMs"] >= 0
    assert "evaluación por cobertura" in " ".join(r.get("reason", "") for r in res).lower()                   # sin Bedrock: juez por palabras clave


def test_una_corrida_no_crea_conversaciones_ni_tickets(client, empresas):
    _ejecutar(client, _conjunto(client, casos=CASOS))
    assert client.get("/empresas/alfa/conversaciones").json()["total"] == 0 and client.get("/tickets").json() == []


def test_con_ia_el_juez_puntua_y_el_gasto_se_registra(client, empresas, bedrock):
    bedrock.puntaje = 0.4
    d = _ejecutar(client, _conjunto(client, casos=CASOS[:1]))
    r = d["results"][0]
    assert r["score"] == 0.4 and r["verdict"] == "fallido" and "puntaje 0.40" in r["reason"]                   # el juez bajó el puntaje
    assert r["inputTokens"] == 1000 and r["costUsd"] > 0 and d["run"]["summary"]["judgeCostUsd"] > 0
    f = client.get("/empresas/alfa/finops").json()
    assert f["calls"] == 2 and f["billing"]["spentUsd"] > 0                                                     # agente + juez cuentan en el plan


def test_comparacion_con_la_corrida_anterior(client, empresas):
    cid = _conjunto(client, casos=CASOS)
    primera = _ejecutar(client, cid)
    assert "previous" not in primera
    segunda = _ejecutar(client, cid)
    assert segunda["previous"]["id"] == primera["run"]["id"]
    assert [r["previousVerdict"] for r in segunda["results"]] == ["aprobado", "aprobado", "fallido"]


def test_el_tope_mensual_corta_la_ia_de_la_corrida(client, empresas, bedrock):
    client.patch("/empresas/alfa/plan", json={"mode": "limitado", "monthlyLimitUsd": 0.01})
    bedrock.entrada = 1_000_000                                                                                 # cada llamada cuesta ~1 USD
    _ejecutar(client, _conjunto(client, casos=CASOS[:1]))                                                       # gasta más de 0,01 USD
    antes = bedrock.llamadas
    d = _ejecutar(client, _conjunto(client, nombre="Otro", casos=CASOS[:1]))
    assert bedrock.llamadas == antes and d["run"]["summary"]["limitReached"] is True                            # sin IA: extractivo + juez por palabras


def test_solo_una_corrida_a_la_vez(client, empresas):
    cid = _conjunto(client, casos=CASOS[:1])
    with SessionLocal() as db:
        e = db.query(m.Empresa).filter_by(slug="alfa").one()
        db.add(m.EjecucionPrueba(empresa_id=e.id, conjunto_id=db.query(m.ConjuntoPrueba).one().id, conjunto_nombre="x", modelo_ia="haiku-5-5",
                                 umbral_rag=0.8, estado="ejecutando", total=1))
        db.commit()
    assert client.post(f"/empresas/alfa/testing/conjuntos/{cid}/ejecutar").status_code == 409


def test_una_corrida_colgada_se_marca_como_interrumpida(client, empresas):
    cid = _conjunto(client, casos=CASOS[:1])
    with SessionLocal() as db:
        e = db.query(m.Empresa).filter_by(slug="alfa").one()
        run = m.EjecucionPrueba(empresa_id=e.id, conjunto_id=db.query(m.ConjuntoPrueba).one().id, conjunto_nombre="x", modelo_ia="haiku-5-5",
                                umbral_rag=0.8, estado="ejecutando", total=1, iniciada_en=datetime(2020, 1, 1, tzinfo=timezone.utc))
        db.add(run)
        db.commit()
        rid = str(run.id)
    d = client.get(f"/empresas/alfa/testing/ejecuciones/{rid}").json()
    assert d["run"]["status"] == "error" and "interrumpió" in d["error"]
    assert client.post(f"/empresas/alfa/testing/conjuntos/{cid}/ejecutar").status_code == 202                   # ya no bloquea


# ------------------------------------------------------------------------------------------ generación con IA
def test_generar_casos_con_ia(client, empresas, bedrock):
    r = client.post("/empresas/alfa/testing/conjuntos/generar", json={"name": "Generado", "count": 5, "negatives": 1})
    assert r.status_code == 201, r.text
    c = r.json()
    qs = [x["question"] for x in c["cases"]]
    assert len(qs) == 3 and qs.count("¿Cuánto demoran los reembolsos?") == 1                                    # sin duplicados
    assert all(x["origin"] == "ia" for x in c["cases"]) and c["aiCases"] == 3
    horario = next(x for x in c["cases"] if "hora" in x["question"])
    assert "expectedDocument" not in horario                                                                    # documento inventado: se descarta
    assert next(x for x in c["cases"] if "cripto" in x["question"])["shouldEscalate"] is True
    assert client.get("/empresas/alfa/finops").json()["calls"] == 1                                             # la generación gasta tokens: queda registrada


def test_generar_sin_bedrock_o_sin_documentos_explica_por_que(client, empresas, crear_empresa, bedrock, monkeypatch):
    crear_empresa("Vacia")
    assert client.post("/empresas/vacia/testing/conjuntos/generar", json={"name": "x"}).status_code == 409     # sin documentación
    monkeypatch.setattr(llm, "BEDROCK_HABILITADO", False)
    r = client.post("/empresas/alfa/testing/conjuntos/generar", json={"name": "x"})
    assert r.status_code == 409 and "Bedrock" in r.json()["detail"]


def test_generar_solo_con_documentos_de_la_propia_empresa(client, empresas, bedrock):
    ajeno = client.get("/empresas/beta/documentos").json()[0]["id"]
    assert client.post("/empresas/alfa/testing/conjuntos/generar", json={"name": "x", "documentIds": [ajeno]}).status_code == 404
    propio = client.get("/empresas/alfa/documentos").json()[0]["id"]
    assert client.post("/empresas/alfa/testing/conjuntos/generar", json={"name": "x", "documentIds": [propio]}).status_code == 201
    assert "ZETA9999" not in "".join(bedrock.sistemas)                                                          # nunca documentos de otra empresa


# ------------------------------------------------------------------------------------------ exportación CSV
def _filas(contenido: bytes, delim=","):
    assert contenido.startswith("﻿".encode())                                                               # BOM para Excel
    return list(csv.reader(io.StringIO(contenido.decode("utf-8-sig")), delimiter=delim))


def test_exporta_csv_con_la_plantilla_de_alloxentric(client, empresas):
    cid = _conjunto(client, casos=CASOS)
    _ejecutar(client, cid)
    rid = client.get("/empresas/alfa/testing/ejecuciones").json()[0]["id"]
    r = client.get(f"/empresas/alfa/testing/ejecuciones/{rid}/exportar")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert "alloxentric_pruebas_alfa_reembolsos_" in r.headers["content-disposition"] and r.headers["content-disposition"].endswith('.csv"')
    f = _filas(r.content)
    assert f[0] == ["alloxentric.", "Reporte de pruebas del agente"] and ["Empresa", "Alfa"] in f
    assert ["Conjunto de pruebas (golden set)", "Reembolsos"] in f and ["Base de conocimiento al correr", "2 documentos · 2 fragmentos"] in f
    i = f.index(["RESUMEN"])
    assert f[i + 1] == ["Métrica", "Valor", "Corrida anterior", "Variación"] and ["Casos totales", "3", "", ""] in f
    j = f.index(["RESULTADOS"])
    assert f[j + 1][:3] == ["N.º", "Pregunta", "Respuesta esperada"] and len(f[j + 2:]) == 3
    assert [x[10] for x in f[j + 2:]] == ["aprobado", "aprobado", "fallido"]


def test_csv_para_excel_usa_punto_y_coma_y_muestra_variaciones(client, empresas):
    cid = _conjunto(client, casos=CASOS)
    _ejecutar(client, cid), _ejecutar(client, cid)
    rid = client.get("/empresas/alfa/testing/ejecuciones").json()[0]["id"]
    f = _filas(client.get(f"/empresas/alfa/testing/ejecuciones/{rid}/exportar?formato=excel").content, ";")
    tasa = next(x for x in f if x and x[0] == "Tasa de aprobación (%)")
    assert tasa[1] == tasa[2] == "66.7" and tasa[3] == "+0"                                                      # comparada con la corrida anterior
    assert f[f.index(["RESULTADOS"]) + 2][-1] == "aprobado"                                                      # columna «Veredicto anterior»


def test_el_csv_neutraliza_formulas(client, empresas):
    cid = _conjunto(client, casos=[{"question": '=HYPERLINK("http://malo.cl","clic")', "shouldEscalate": True}])
    _ejecutar(client, cid)
    rid = client.get("/empresas/alfa/testing/ejecuciones").json()[0]["id"]
    f = _filas(client.get(f"/empresas/alfa/testing/ejecuciones/{rid}/exportar").content)
    assert f[f.index(["RESULTADOS"]) + 2][1].startswith("'=")                                                    # no se ejecuta al abrir en Excel


def test_no_se_exporta_una_corrida_en_curso(client, empresas):
    cid = _conjunto(client, casos=CASOS[:1])
    with SessionLocal() as db:
        e = db.query(m.Empresa).filter_by(slug="alfa").one()
        run = m.EjecucionPrueba(empresa_id=e.id, conjunto_id=db.query(m.ConjuntoPrueba).one().id, conjunto_nombre="x", modelo_ia="haiku-5-5",
                                umbral_rag=0.8, estado="ejecutando", total=1)
        db.add(run)
        db.commit()
        rid = str(run.id)
    assert client.get(f"/empresas/alfa/testing/ejecuciones/{rid}/exportar").status_code == 409
    assert client.delete(f"/empresas/alfa/testing/ejecuciones/{rid}").status_code == 409


# ------------------------------------------------------------------------------------------ aislamiento y permisos
def test_aislamiento_entre_empresas(client, empresas, usuario_como):
    cid = _conjunto(client, casos=CASOS)
    run = _ejecutar(client, cid)["run"]["id"]
    caso = client.get(f"/empresas/alfa/testing/conjuntos/{cid}").json()["cases"][0]["id"]
    # superadmin mirando la empresa equivocada: los ids de Alfa no existen en Beta
    for ruta in (f"conjuntos/{cid}", f"ejecuciones/{run}", f"ejecuciones/{run}/exportar"):
        assert client.get(f"/empresas/beta/testing/{ruta}").status_code == 404, ruta
    assert client.patch(f"/empresas/beta/testing/casos/{caso}", json={"shouldEscalate": True}).status_code == 404
    assert client.post(f"/empresas/beta/testing/conjuntos/{cid}/ejecutar").status_code == 404
    assert client.get("/empresas/beta/testing/conjuntos").json() == [] and client.get("/empresas/beta/testing/ejecuciones").json() == []
    # un admin de Beta no entra a Alfa
    ajeno = usuario_como("beta", "admin_empresa")
    assert ajeno.get("/empresas/alfa/testing/conjuntos").status_code == 403
    assert ajeno.post(f"/empresas/alfa/testing/conjuntos/{cid}/ejecutar").status_code == 403


def test_permisos_por_rol(client, empresas, usuario_como):
    for rol in ("admin_empresa", "encargado_agente"):
        c = usuario_como("alfa", rol)
        assert c.get("/empresas/alfa/testing/conjuntos").status_code == 200 and c.get("/empresas/alfa/kb/resumen").status_code == 200
    t = usuario_como("alfa", "encargado_tickets")
    assert t.get("/empresas/alfa/testing/conjuntos").status_code == 403 and t.get("/empresas/alfa/kb/resumen").status_code == 403
    assert t.post("/empresas/alfa/testing/conjuntos", json={"name": "x"}).status_code == 403


# ------------------------------------------------------------------------------------------ base de conocimiento
def test_resumen_de_la_base_de_conocimiento(client, empresas):
    k = client.get("/empresas/alfa/kb/resumen").json()
    assert (k["documents"], k["processed"], k["processing"], k["errors"], k["fragments"]) == (2, 2, 0, 0, 2)
    assert k["embeddedFragments"] == 2 and k["characters"] == len(REEMBOLSOS) + len(HORARIO) and k["models"] == ["hash-v1"]
    assert k["byType"] == [{"type": "txt", "count": 2}] and k["lastUpdated"]
    _subir(client, "alfa", "vacio.txt", "   \n\n  ")
    assert client.get("/empresas/alfa/kb/resumen").json()["errors"] == 1
    assert client.get("/empresas/beta/kb/resumen").json()["documents"] == 1                                     # cada empresa ve lo suyo


def test_documentos_de_la_kb_cuentan_fragmentos_reales(client, empresas):
    docs = {d["name"]: d for d in client.get("/empresas/alfa/kb/documentos").json()}
    assert set(docs) == {"reembolsos.txt", "horario.txt"} and docs["reembolsos.txt"]["fragments"] == 1
    assert docs["reembolsos.txt"]["characters"] == len(REEMBOLSOS) and docs["reembolsos.txt"]["embeddedFragments"] == 1
    assert docs["horario.txt"]["status"] == "procesado" and docs["horario.txt"]["uploadedAt"]
    assert [d["name"] for d in client.get("/empresas/beta/kb/documentos").json()] == ["secreto.txt"]               # cada empresa ve lo suyo


def test_explorador_de_fragmentos_filtra_y_aisla(client, empresas):
    todos = client.get("/empresas/alfa/kb/fragmentos").json()
    assert todos["total"] == 2 and {x["documentName"] for x in todos["items"]} == {"reembolsos.txt", "horario.txt"}
    assert all(x["embedded"] and x["model"] == "hash-v1" and x["characters"] > 0 for x in todos["items"])
    assert client.get("/empresas/alfa/kb/fragmentos?q=reembolsos").json()["total"] == 1
    assert client.get("/empresas/alfa/kb/fragmentos?q=ZETA9999").json()["total"] == 0                            # el texto de Beta no aparece en Alfa
    doc = client.get("/empresas/alfa/documentos").json()[0]["id"]
    assert client.get(f"/empresas/alfa/kb/fragmentos?documento_id={doc}").json()["total"] == 1
    assert client.get(f"/empresas/beta/kb/fragmentos?documento_id={doc}").json()["total"] == 0                    # documento de otra empresa: nada
    assert len(client.get("/empresas/alfa/kb/fragmentos?limit=1").json()["items"]) == 1


# ------------------------------------------------------------------------------------------ modelo juez y modelo generador
def _ejecutar_con(client, cid, cuerpo=None, slug="alfa"):
    r = client.post(f"/empresas/{slug}/testing/conjuntos/{cid}/ejecutar", json=cuerpo) if cuerpo is not None else client.post(f"/empresas/{slug}/testing/conjuntos/{cid}/ejecutar")
    assert r.status_code == 202, r.text
    return client.get(f"/empresas/{slug}/testing/ejecuciones/{r.json()['id']}").json()


def test_el_juez_por_defecto_es_haiku_y_se_puede_elegir_otro(client, empresas, bedrock):
    cid = _conjunto(client, casos=CASOS[:1])
    por_defecto = _ejecutar_con(client, cid)
    assert por_defecto["run"]["judgeModelId"] == "haiku-5-5" and bedrock.por_rol["juez"] == ["us.anthropic.claude-haiku-5-5"]
    bedrock.por_rol.clear()
    elegido = _ejecutar_con(client, cid, {"judgeModelId": "qwen3-32b"})
    assert elegido["run"]["judgeModelId"] == "qwen3-32b"
    assert bedrock.por_rol["juez"] == ["qwen.qwen3-32b-v1:0"] and bedrock.por_rol["agente"] == ["us.anthropic.claude-haiku-5-5"]   # juez y agente son modelos distintos


def test_el_costo_del_juez_usa_el_precio_del_modelo_juez(client, empresas, bedrock):
    cid = _conjunto(client, casos=CASOS[:1])
    haiku = _ejecutar_con(client, cid, {"judgeModelId": "haiku-5-5"})["run"]["summary"]["judgeCostUsd"]
    qwen = _ejecutar_con(client, cid, {"judgeModelId": "qwen3-32b"})["run"]["summary"]["judgeCostUsd"]
    assert haiku == pytest.approx((1000 * 1.00 + 100 * 5.00) / 1e6) and qwen == pytest.approx((1000 * 0.15 + 100 * 0.60) / 1e6)
    uso = client.get("/empresas/alfa/finops").json()["byModel"]
    assert {"haiku-5-5", "qwen3-32b"} <= {x["modelId"] for x in uso}                                           # el gasto del juez queda a nombre de su modelo


def test_el_juez_y_el_agente_pueden_ser_el_mismo_modelo(client, empresas, bedrock):
    client.patch("/empresas/alfa", json={"aiModel": "nova-lite"})
    d = _ejecutar_con(client, _conjunto(client, casos=CASOS[:1]), {"judgeModelId": "nova-lite"})
    assert d["run"]["modelId"] == d["run"]["judgeModelId"] == "nova-lite"                                       # permitido (la pantalla lo advierte)


def test_juez_desconocido_se_rechaza(client, empresas):
    cid = _conjunto(client, casos=CASOS[:1])
    assert client.post(f"/empresas/alfa/testing/conjuntos/{cid}/ejecutar", json={"judgeModelId": "gpt-inventado"}).status_code == 422
    assert client.get("/empresas/alfa/testing/ejecuciones").json() == []                                        # no quedó ninguna corrida a medias


def test_si_el_juez_no_devuelve_un_puntaje_valido_se_usa_cobertura_y_se_dice(client, empresas, bedrock):
    bedrock.juez_roto = True
    r = _ejecutar_con(client, _conjunto(client, casos=CASOS[:1]), {"judgeModelId": "nova-lite"})["results"][0]
    assert r["score"] is not None and "Nova Lite" in r["reason"] and "cobertura" in r["reason"].lower()           # no se esconde que el juez falló


def test_el_csv_indica_el_modelo_juez(client, empresas, bedrock):
    cid = _conjunto(client, casos=CASOS[:1])
    run = _ejecutar_con(client, cid, {"judgeModelId": "deepseek-v3-2"})["run"]["id"]
    f = _filas(client.get(f"/empresas/alfa/testing/ejecuciones/{run}/exportar").content)
    assert ["Modelo juez (LLM as a Judge)", "DeepSeek V3.2 (DeepSeek)"] in f and ["Modelo de IA (el agente probado)", "Claude Haiku 5.5 (Anthropic)"] in f


def test_elegir_el_modelo_que_genera_los_casos(client, empresas, bedrock):
    r = client.post("/empresas/alfa/testing/conjuntos/generar", json={"name": "Con Nova", "modelId": "nova-lite", "count": 3, "negatives": 1})
    assert r.status_code == 201, r.text
    assert bedrock.por_rol["generador"] == ["us.amazon.nova-lite-v1:0"] and r.json()["generatedWith"] == "nova-lite"
    por_defecto = client.post("/empresas/alfa/testing/conjuntos/generar", json={"name": "Por defecto"}).json()
    assert por_defecto["generatedWith"] == "haiku-5-5" and bedrock.por_rol["generador"][-1] == "us.anthropic.claude-haiku-5-5"
    assert "generatedWith" not in client.get(f"/empresas/alfa/testing/conjuntos/{_conjunto(client, nombre='Manual')}").json()   # a mano: sin generador
    assert client.post("/empresas/alfa/testing/conjuntos/generar", json={"name": "x", "modelId": "gpt-inventado"}).status_code == 422
