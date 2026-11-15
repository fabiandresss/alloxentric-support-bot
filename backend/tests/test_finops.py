"""FinOps (consumo de IA, plan de gasto, límite mensual) y registro de conversaciones.

Bedrock se reemplaza por un cliente falso que informa `usage` como el real: nunca se llama a AWS.
"""
import pytest
from app.services import llm
from tests.test_rag import REEMBOLSOS, _bot, _preguntar, _subir

PREGUNTA = "cuanto tardan los reembolsos de consultas medicas?"


class BedrockFalso:
    def __init__(self, entrada=1_000_000, salida=200_000):   # 1 M de tokens de entrada y 0,2 M de salida por llamada
        self.entrada, self.salida, self.llamadas = entrada, salida, 0

    def converse(self, **kw):
        self.llamadas += 1
        return {"output": {"message": {"content": [{"text": "Cinco dias habiles."}]}},
                "usage": {"inputTokens": self.entrada, "outputTokens": self.salida}}


@pytest.fixture
def bedrock(monkeypatch):
    falso = BedrockFalso()
    monkeypatch.setattr(llm, "BEDROCK_HABILITADO", True)
    monkeypatch.setattr(llm, "_cliente", falso)
    return falso


@pytest.fixture
def empresas(client, crear_empresa):
    crear_empresa("Alfa"), crear_empresa("Beta")
    _subir(client, "alfa", "r.txt", REEMBOLSOS), _subir(client, "beta", "r.txt", REEMBOLSOS)


# ------------------------------------------------------------------------------------------ consumo
def test_cada_respuesta_con_ia_registra_tokens_y_costo(client, empresas, bedrock):
    _preguntar(client, "alfa", PREGUNTA)
    f = client.get("/empresas/alfa/finops").json()
    assert (f["calls"], f["inputTokens"], f["outputTokens"], f["conversations"]) == (1, 1_000_000, 200_000, 1)
    # Haiku 5.5: 1 M * 1.00 + 0.2 M * 5.00 = 2.00 USD
    assert f["spentUsd"] == pytest.approx(2.0) and f["byModel"][0]["modelId"] == "haiku-5-5"
    assert f["avgCostPerConversationUsd"] == pytest.approx(2.0)
    assert sum(pt["costUsd"] for pt in f["series"]) == pytest.approx(2.0) and len(f["series"]) >= 1


def test_el_costo_depende_del_modelo_elegido(client, empresas, bedrock):
    client.patch("/empresas/alfa", json={"aiModel": "nova-lite"})
    _preguntar(client, "alfa", PREGUNTA)
    f = client.get("/empresas/alfa/finops").json()
    assert f["byModel"][0]["modelId"] == "nova-lite" and f["spentUsd"] == pytest.approx(1.0 * 0.06 + 0.2 * 0.24)


def test_derivar_a_humano_suma_la_sugerencia_al_consumo(client, empresas, bedrock):
    _preguntar(client, "alfa", "mi tarjeta fue clonada en el extranjero")      # sin respuesta en la documentación: deriva
    assert client.get("/empresas/alfa/finops").json()["calls"] >= 1               # la sugerencia para el agente también cuesta


def test_sin_ia_no_hay_consumo(client, empresas):
    _preguntar(client, "alfa", PREGUNTA)                                           # Bedrock apagado (modo extractivo)
    f = client.get("/empresas/alfa/finops").json()
    assert f["calls"] == 0 and f["spentUsd"] == 0 and "avgCostPerConversationUsd" not in f


def test_el_consumo_no_se_mezcla_entre_empresas(client, empresas, bedrock):
    _preguntar(client, "alfa", PREGUNTA)
    assert client.get("/empresas/beta/finops").json()["calls"] == 0


# ------------------------------------------------------------------------------------------ plan y límite
def test_plan_limitado_corta_la_ia_al_llegar_al_tope_y_el_chat_sigue(client, empresas, bedrock):
    assert client.patch("/empresas/alfa/plan", json={"mode": "limitado", "monthlyLimitUsd": 3.0}).json() == {
        "mode": "limitado", "monthlyLimitUsd": 3.0}
    _preguntar(client, "alfa", PREGUNTA)                                           # 2 USD de 3: aún bajo el tope (66 %)
    f = client.get("/empresas/alfa/finops").json()
    b = f["billing"]
    assert b["usedPct"] == pytest.approx(66.7, abs=0.1) and not b["limitReached"] and not b["nearLimit"]
    _preguntar(client, "alfa", PREGUNTA)                                           # llega a 4 USD: tope superado
    assert client.get("/empresas/alfa/finops").json()["billing"]["limitReached"] is True
    llamadas = bedrock.llamadas
    r = _preguntar(client, "alfa", PREGUNTA)                                       # con el tope alcanzado: sin llamada al modelo
    assert bedrock.llamadas == llamadas
    assert r["derived"] is False and "cinco dias habiles" in _bot(r)["message"]    # responde extractivo, el chat no se cae


def test_el_limite_de_una_empresa_no_afecta_a_otra(client, empresas, bedrock):
    client.patch("/empresas/alfa/plan", json={"mode": "limitado", "monthlyLimitUsd": 0.01})
    _preguntar(client, "alfa", PREGUNTA), _preguntar(client, "alfa", PREGUNTA)
    antes = bedrock.llamadas
    _preguntar(client, "beta", PREGUNTA)                                           # Beta sin límite: sigue usando la IA
    assert bedrock.llamadas > antes


def test_plan_sin_limite_nunca_corta(client, empresas, bedrock):
    client.patch("/empresas/alfa/plan", json={"mode": "limitado", "monthlyLimitUsd": 0.01})
    client.patch("/empresas/alfa/plan", json={"mode": "sin_limite"})
    for _ in range(3):
        _preguntar(client, "alfa", PREGUNTA)
    f = client.get("/empresas/alfa/finops").json()
    assert f["plan"] == {"mode": "sin_limite"} and "usedPct" not in f["billing"] and not f["billing"]["limitReached"] and f["calls"] == 3


def test_validacion_del_plan(client, empresas):
    assert client.patch("/empresas/alfa/plan", json={"mode": "limitado"}).status_code == 422          # falta el monto
    assert client.patch("/empresas/alfa/plan", json={"mode": "limitado", "monthlyLimitUsd": -5}).status_code == 422
    assert client.patch("/empresas/alfa/plan", json={"mode": "limitado", "monthlyLimitUsd": 0.001}).status_code == 422   # menos de un centavo
    assert client.patch("/empresas/alfa/plan", json={"mode": "gratis"}).status_code == 422
    assert client.get("/empresas/alfa/finops?desde=2026-01-01&hasta=2026-01-31").json()["spentUsd"] == 0   # otro período: vacío, no error
    for malo in ("desde=2026-02-01&hasta=2026-01-01",           # fechas al revés
                 "desde=2026-01-01",                              # falta hasta
                 "desde=2024-01-01&hasta=2026-01-01",             # más de un año
                 "modelo=gpt-inventado", "agrupar=siglo", "desde=ayer&hasta=hoy"):
        assert client.get(f"/empresas/alfa/finops?{malo}").status_code == 422, malo


def test_aviso_al_80_por_ciento(client, empresas, bedrock):
    client.patch("/empresas/alfa/plan", json={"mode": "limitado", "monthlyLimitUsd": 2.5})
    _preguntar(client, "alfa", PREGUNTA)                                           # 2 / 2,5 = 80 %
    b = client.get("/empresas/alfa/finops").json()["billing"]
    assert b["nearLimit"] is True and not b["limitReached"]


# ------------------------------------------------------------------------------------------ permisos
def test_permisos_de_finops_y_plan(client, empresas, usuario_como):
    admin, agente, tickets = (usuario_como("alfa", "admin_empresa"), usuario_como("alfa", "encargado_agente"),
                              usuario_como("alfa", "encargado_tickets"))
    assert admin.get("/empresas/alfa/finops").status_code == 200
    assert agente.get("/empresas/alfa/finops").status_code == 403 and tickets.get("/empresas/alfa/finops").status_code == 403
    assert admin.patch("/empresas/alfa/plan", json={"mode": "sin_limite"}).status_code == 403          # el plan lo fija la plataforma
    ajeno = usuario_como("beta", "admin_empresa")
    assert ajeno.get("/empresas/alfa/finops").status_code == 403                                      # aislamiento entre empresas


# ------------------------------------------------------------------------------------------ registro de conversaciones
def _conversaciones(client, slug, **params):
    r = client.get(f"/empresas/{slug}/conversaciones", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def test_el_registro_incluye_las_conversaciones_con_y_sin_ticket(client, empresas, bedrock):
    resuelta = _preguntar(client, "alfa", PREGUNTA)
    derivada = _preguntar(client, "alfa", "mi tarjeta fue clonada en el extranjero")
    todas = _conversaciones(client, "alfa")
    assert todas["total"] == 2
    por_id = {c["id"]: c for c in todas["items"]}
    assert "ticketNumber" not in por_id[resuelta["conversationId"]] and por_id[resuelta["conversationId"]]["escalated"] is False
    assert por_id[derivada["conversationId"]]["ticketNumber"].startswith("COR-") and por_id[derivada["conversationId"]]["escalated"]
    assert _conversaciones(client, "alfa", ticket="con")["total"] == 1 and _conversaciones(client, "alfa", ticket="sin")["total"] == 1
    assert por_id[resuelta["conversationId"]]["costUsd"] > 0 and por_id[resuelta["conversationId"]]["messageCount"] == 2


def test_busqueda_y_paginacion_del_registro(client, empresas):
    for i in range(5):
        _preguntar(client, "alfa", f"{PREGUNTA} caso {i}")
    assert _conversaciones(client, "alfa", limit=2)["total"] == 5 and len(_conversaciones(client, "alfa", limit=2)["items"]) == 2
    assert len(_conversaciones(client, "alfa", limit=2, offset=4)["items"]) == 1
    assert _conversaciones(client, "alfa", q="caso 3")["total"] == 1                # busca dentro de los mensajes
    assert _conversaciones(client, "alfa", q="no-existe-xyz")["total"] == 0
    assert _conversaciones(client, "alfa", desde="2999-01-01")["total"] == 0
    assert client.get("/empresas/alfa/conversaciones?ticket=quizas").status_code == 422


def test_detalle_de_la_conversacion_con_transcripcion_y_tokens(client, empresas, bedrock):
    cid = _preguntar(client, "alfa", PREGUNTA)["conversationId"]
    d = client.get(f"/conversaciones/{cid}").json()
    assert [x["sender"] for x in d["messages"]] == ["user", "bot"] and d["messages"][0]["message"] == PREGUNTA
    assert (d["inputTokens"], d["outputTokens"], d["aiCalls"]) == (1_000_000, 200_000, 1)
    assert d["summary"]["id"] == cid


def test_el_registro_no_filtra_conversaciones_de_otra_empresa(client, empresas, usuario_como):
    cid = _preguntar(client, "alfa", PREGUNTA)["conversationId"]
    ajeno = usuario_como("beta", "admin_empresa")
    assert ajeno.get("/empresas/alfa/conversaciones").status_code == 403
    assert ajeno.get(f"/conversaciones/{cid}").status_code == 403
    assert _conversaciones(ajeno, "beta")["total"] == 0
    assert client.get("/conversaciones/no-es-un-uuid").status_code == 404


def test_permisos_del_registro(client, empresas, usuario_como):
    cid = _preguntar(client, "alfa", PREGUNTA)["conversationId"]
    for rol in ("admin_empresa", "encargado_agente"):
        c = usuario_como("alfa", rol)
        assert c.get("/empresas/alfa/conversaciones").status_code == 200 and c.get(f"/conversaciones/{cid}").status_code == 200
    t = usuario_como("alfa", "encargado_tickets")
    assert t.get("/empresas/alfa/conversaciones").status_code == 403 and t.get(f"/conversaciones/{cid}").status_code == 403


# ------------------------------------------------------------------------------------------ filtros del panel
def test_filtrar_por_modelo_acota_totales_y_grafico_pero_no_la_tabla(client, empresas, bedrock):
    _preguntar(client, "alfa", PREGUNTA)                                           # Haiku: 2,00 USD
    client.patch("/empresas/alfa", json={"aiModel": "nova-lite"})
    _preguntar(client, "alfa", PREGUNTA)                                           # Nova Lite: 0,108 USD
    todo = client.get("/empresas/alfa/finops").json()
    solo = client.get("/empresas/alfa/finops?modelo=nova-lite").json()
    assert todo["calls"] == 2 and solo["calls"] == 1 and solo["model"] == "nova-lite"
    assert solo["spentUsd"] == pytest.approx(0.108) and sum(p["costUsd"] for p in solo["series"]) == pytest.approx(0.108)
    assert {r["modelId"] for r in solo["byModel"]} == {"haiku-5-5", "nova-lite"}   # la tabla sigue mostrando todos para compararlos
    assert solo["billing"]["spentUsd"] == pytest.approx(2.108)                      # el ciclo de cobro no depende del filtro
    assert client.get("/empresas/alfa/finops?modelo=qwen3-32b").json()["calls"] == 0


def test_el_limite_se_mide_sobre_el_mes_en_curso_aunque_se_mire_otro_periodo(client, empresas, bedrock):
    client.patch("/empresas/alfa/plan", json={"mode": "limitado", "monthlyLimitUsd": 3})
    _preguntar(client, "alfa", PREGUNTA)
    pasado = client.get("/empresas/alfa/finops?desde=2026-01-01&hasta=2026-01-31").json()
    assert pasado["spentUsd"] == 0 and pasado["billing"]["spentUsd"] == pytest.approx(2.0)
    assert pasado["billing"]["usedPct"] == pytest.approx(66.7, abs=0.1)


def test_agrupar_por_dia_semana_y_mes_suman_lo_mismo(client, empresas, bedrock):
    _preguntar(client, "alfa", PREGUNTA)
    q = "desde=2026-01-01&hasta=2026-12-31"
    from datetime import date
    hoy = date.today()
    dia = client.get(f"/empresas/alfa/finops?{q}&agrupar=dia").json()["series"]
    sem = client.get(f"/empresas/alfa/finops?{q}&agrupar=semana").json()["series"]
    mes = client.get(f"/empresas/alfa/finops?{q}&agrupar=mes").json()["series"]
    assert len(dia) == 365 and len(mes) == 12 and 52 <= len(sem) <= 54
    for serie in (dia, sem, mes):
        assert sum(p["costUsd"] for p in serie) == pytest.approx(2.0) and sum(p["calls"] for p in serie) == 1
    assert all(date.fromisoformat(p["date"]) <= date.fromisoformat(p["endDate"]) for p in sem)
    assert all(date.fromisoformat(p["date"]).weekday() == 0 for p in sem[1:])      # cada semana empieza en lunes (la primera se recorta al rango)
    assert [p["date"][:7] for p in mes][hoy.month - 1] == hoy.strftime("%Y-%m") and mes[hoy.month - 1]["costUsd"] == pytest.approx(2.0)
    hoy_local = [p for p in dia if p["costUsd"] > 0]
    assert len(hoy_local) == 1 and hoy_local[0]["date"] == hoy_local[0]["endDate"]


def test_rango_por_defecto_es_el_mes_en_curso_hasta_hoy(client, empresas):
    from datetime import date
    f = client.get("/empresas/alfa/finops").json()
    assert f["rangeFrom"] == date.today().replace(day=1).isoformat() and f["rangeTo"] == date.today().isoformat()
    assert f["groupBy"] == "dia" and f["billing"]["month"] == date.today().strftime("%Y-%m")
