"""Exportación de una corrida de pruebas a CSV con la plantilla de alloxentric.

Estructura (UTF-8 con BOM para que Excel respete tildes y eñes):
    alloxentric. · Reporte de pruebas del agente
    <datos de la corrida: empresa, conjunto, fecha, modelo, umbral, base de conocimiento, ...>

    RESUMEN
    Métrica;Valor;Corrida anterior;Variación
    ...

    RESULTADOS
    N.º;Pregunta;Respuesta esperada;...

`excel=True` usa «;» como separador (Excel en español lo espera); si no, «,». Las celdas que empiezan con = + - @ se neutralizan para que
una pregunta o respuesta maliciosa no se ejecute como fórmula al abrir el archivo (CSV injection).
"""
import csv
import io
from app import models as m
from app.config import TZ
from app.services import modelos

MARCA = "alloxentric."
_PELIGROSOS = ("=", "+", "-", "@", "\t", "\r")


def _c(v) -> str:
    """Celda segura: texto plano y sin fórmulas."""
    if v is None:
        return ""
    if isinstance(v, bool):
        return "Sí" if v else "No"
    s = str(v).replace("\r\n", "\n").replace("\r", "\n")
    return "'" + s if s.startswith(_PELIGROSOS) and not _es_numero(s) else s


def _es_numero(s: str) -> bool:
    try:
        float(s)
        return True
    except ValueError:
        return False


def _fecha(dt) -> str:
    return dt.astimezone(TZ).strftime("%d-%m-%Y %H:%M") if dt else ""


def _num(v, nd=2):
    return "" if v is None else (f"{v:.{nd}f}".rstrip("0").rstrip(".") if isinstance(v, float) else v)


def _delta(actual, previo, nd=1):
    if actual is None or previo is None:
        return ""
    d = round(actual - previo, nd)
    return f"{d:+g}"


def construir(empresa: m.Empresa, run: m.EjecucionPrueba, resultados: list[m.ResultadoPrueba], previa: m.EjecucionPrueba | None,
              previos: dict, excel: bool = False) -> bytes:
    """`previos` mapea caso_id -> veredicto de la corrida anterior."""
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";" if excel else ",", lineterminator="\r\n", quoting=csv.QUOTE_MINIMAL)
    s = run.resumen or {}
    p = (previa.resumen or {}) if previa else {}
    mod = modelos.obtener(run.modelo_ia)
    juez = modelos.obtener(run.modelo_juez)

    w.writerow([MARCA, "Reporte de pruebas del agente"])
    for k, v in [("Empresa", empresa.nombre), ("Conjunto de pruebas (golden set)", run.conjunto_nombre), ("Corrida", str(run.id)),
                 ("Estado", run.estado), ("Inicio", _fecha(run.iniciada_en)), ("Término", _fecha(run.terminada_en)),
                 ("Ejecutada por", run.creada_por or ""), ("Modelo de IA (el agente probado)", f"{mod.nombre} ({mod.proveedor})"),
                 ("Modelo juez (LLM as a Judge)", f"{juez.nombre} ({juez.proveedor})"),
                 ("Umbral RAG (%)", round(run.umbral_rag * 100)),
                 ("Base de conocimiento al correr", f"{run.kb.get('documentos', 0)} documentos · {run.kb.get('fragmentos', 0)} fragmentos"),
                 ("Comparada con la corrida del", _fecha(previa.iniciada_en) if previa else "— (primera corrida)")]:
        w.writerow([_c(k), _c(v)])
    w.writerow([])

    w.writerow(["RESUMEN"])
    w.writerow(["Métrica", "Valor", "Corrida anterior", "Variación"])
    filas = [("Casos totales", "total", 0), ("Aprobados", "aprobados", 0), ("Fallidos", "fallidos", 0), ("Con error", "errores", 0),
             ("Tasa de aprobación (%)", "tasa_aprobacion", 1), ("Puntaje promedio (0 a 1)", "puntaje_promedio", 2),
             ("Precisión de fuentes (%)", "precision_fuentes", 1), ("Precisión de derivación (%)", "precision_derivacion", 1),
             ("Confianza RAG promedio (%)", "confianza_promedio", 1), ("Latencia promedio (ms)", "latencia_promedio_ms", 0),
             ("Latencia p95 (ms)", "latencia_p95_ms", 0), ("Tokens de entrada", "tokens_entrada", 0), ("Tokens de salida", "tokens_salida", 0),
             ("Costo del agente (USD)", "costo_agente_usd", 6), ("Costo del evaluador (USD)", "costo_juez_usd", 6)]
    for etiqueta, clave, nd in filas:
        a, b = s.get(clave), p.get(clave)
        w.writerow([etiqueta, _num(a, nd) if nd else (a if a is not None else ""), _num(b, nd) if nd else (b if b is not None else ""),
                    _delta(a, b, max(nd, 1) if nd else 0) if previa else ""])
    if s.get("limite_alcanzado"):
        w.writerow(["Aviso", "El límite mensual de gasto cortó la IA: el agente respondió en modo extractivo y el evaluador usó palabras clave."])
    w.writerow([])

    w.writerow(["RESULTADOS"])
    w.writerow(["N.º", "Pregunta", "Respuesta esperada", "Documento esperado", "Debe derivar", "Respuesta del agente", "Derivó",
                "Fuentes citadas", "Confianza (%)", "Puntaje (0 a 1)", "Veredicto", "Fuente correcta", "Derivación correcta",
                "Latencia (ms)", "Tokens entrada", "Tokens salida", "Costo (USD)", "Motivo", "Veredicto anterior"])
    for r in sorted(resultados, key=lambda x: x.orden):
        w.writerow([r.orden, _c(r.pregunta), _c(r.respuesta_esperada), _c(r.documento_esperado), _c(r.debe_derivar), _c(r.respuesta),
                    _c(r.derivo), _c(", ".join(r.fuentes or [])), "" if r.confianza is None else round(r.confianza * 100),
                    "" if r.puntaje is None else _num(r.puntaje, 2), r.veredicto, "" if r.fuente_ok is None else _c(r.fuente_ok),
                    _c(r.derivacion_ok), r.latencia_ms, r.tokens_entrada, r.tokens_salida, _num(float(r.costo_usd), 6), _c(r.motivo),
                    _c(previos.get(r.caso_id, ""))])
    return ("﻿" + buf.getvalue()).encode("utf-8")
