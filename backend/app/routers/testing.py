"""Pruebas del agente: golden sets (manuales o generados con IA), corridas contra el RAG real, resultados y exportación CSV.

Todo cuelga de la empresa del path y exige rol (superadmin, admin de la empresa o encargado del agente). Los ids de conjunto, caso y
corrida siempre se buscan junto con empresa_id: el de otra empresa responde 404.
"""
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from app import models as m, schemas as s
from app.db import get_db
from app.deps import empresa_con_rol, usuario_actual, GESTION_AGENTE
from app.utils import fecha_corta
from app.services import evaluacion, finops, llm, modelos, reporte

router = APIRouter(prefix="/empresas/{slug}/testing", tags=["testing"])
VENCIDA = timedelta(minutes=20)   # una corrida "ejecutando" más vieja que esto quedó cortada (p. ej. se reinició el servidor)


def _iso(dt) -> str | None:
    return dt.isoformat() if dt else None


def _uuid(valor: str) -> uuid.UUID:
    try:
        return uuid.UUID(valor)
    except ValueError:
        raise HTTPException(404, "No encontrado")


# ------------------------------------------------------------------------------------------ mappers
def _resumen_out(r: dict | None) -> s.TestRunSummary | None:
    if not r:
        return None
    return s.TestRunSummary(
        total=r["total"], passed=r["aprobados"], failed=r["fallidos"], errors=r["errores"], pass_rate=r["tasa_aprobacion"],
        avg_score=r.get("puntaje_promedio"), source_accuracy=r.get("precision_fuentes"), derivation_accuracy=r.get("precision_derivacion"),
        avg_confidence=r.get("confianza_promedio"), avg_latency_ms=r["latencia_promedio_ms"], p95_latency_ms=r["latencia_p95_ms"],
        input_tokens=r["tokens_entrada"], output_tokens=r["tokens_salida"], agent_cost_usd=r["costo_agente_usd"],
        judge_cost_usd=r["costo_juez_usd"], limit_reached=bool(r.get("limite_alcanzado")))


def _run_out(x: m.EjecucionPrueba) -> s.TestRunBrief:
    return s.TestRunBrief(
        id=str(x.id), set_id=str(x.conjunto_id), set_name=x.conjunto_nombre, status=x.estado, total=x.total, completed=x.completados,
        judge_model_id=x.modelo_juez, group_id=str(x.grupo_id) if x.grupo_id else None, origin=x.origen, trigger=x.disparador,
        started_at=x.iniciada_en.isoformat(), finished_at=_iso(x.terminada_en), model_id=x.modelo_ia, rag_threshold=x.umbral_rag,
        kb=s.TestKb(documents=x.kb.get("documentos", 0), fragments=x.kb.get("fragmentos", 0)), created_by=x.creada_por,
        summary=_resumen_out(x.resumen))


def _caso_out(c: m.CasoPrueba) -> s.TestCase:
    return s.TestCase(id=str(c.id), order=c.orden, question=c.pregunta, expected_answer=c.respuesta_esperada,
                      expected_document=c.documento_esperado, should_escalate=c.debe_derivar, origin=c.origen,
                      conversation_id=str(c.conversacion_id) if c.conversacion_id else None)


def _conjunto_item(db: Session, c: m.ConjuntoPrueba, casos: list[m.CasoPrueba] | None = None) -> dict:
    casos = c.casos if casos is None else casos
    ult = db.scalars(select(m.EjecucionPrueba).where(m.EjecucionPrueba.empresa_id == c.empresa_id, m.EjecucionPrueba.conjunto_id == c.id)
                     .order_by(m.EjecucionPrueba.iniciada_en.desc()).limit(1)).first()
    return dict(id=str(c.id), name=c.nombre, description=c.descripcion, case_count=len(casos),
                ai_cases=sum(1 for x in casos if x.origen == "ia"), generated_with=c.generado_con, auto_run=c.auto_ejecutar, created_at=c.creado_en.isoformat(),
                updated_at=c.actualizado_en.isoformat(), last_run=_run_out(ult) if ult else None)


# ------------------------------------------------------------------------------------------ carga con aislamiento
def _conjunto(db: Session, e: m.Empresa, cid: str) -> m.ConjuntoPrueba:
    c = db.scalar(select(m.ConjuntoPrueba).where(m.ConjuntoPrueba.id == _uuid(cid), m.ConjuntoPrueba.empresa_id == e.id))   # <- tenant
    if not c:
        raise HTTPException(404, "Conjunto de pruebas no encontrado")
    return c


def _caso(db: Session, e: m.Empresa, cid: str) -> m.CasoPrueba:
    c = db.scalar(select(m.CasoPrueba).where(m.CasoPrueba.id == _uuid(cid), m.CasoPrueba.empresa_id == e.id))
    if not c:
        raise HTTPException(404, "Caso no encontrado")
    return c


def _run(db: Session, e: m.Empresa, rid: str) -> m.EjecucionPrueba:
    r = db.scalar(select(m.EjecucionPrueba).where(m.EjecucionPrueba.id == _uuid(rid), m.EjecucionPrueba.empresa_id == e.id))
    if not r:
        raise HTTPException(404, "Corrida no encontrada")
    if r.estado == "ejecutando" and datetime.now(timezone.utc) - r.iniciada_en > VENCIDA:
        r.estado, r.error, r.terminada_en = "error", "La corrida se interrumpió antes de terminar.", datetime.now(timezone.utc)
        db.commit()
    return r


def _limpiar(t: str | None) -> str | None:
    t = (t or "").strip()
    return t or None


# ------------------------------------------------------------------------------------------ conjuntos
@router.get("/conjuntos", response_model=list[s.TestSetItem], response_model_exclude_none=True)
def listar_conjuntos(e: m.Empresa = Depends(empresa_con_rol(*GESTION_AGENTE)), db: Session = Depends(get_db)):
    cs = db.scalars(select(m.ConjuntoPrueba).where(m.ConjuntoPrueba.empresa_id == e.id).order_by(m.ConjuntoPrueba.actualizado_en.desc())).all()
    return [s.TestSetItem(**_conjunto_item(db, c)) for c in cs]


@router.post("/conjuntos", response_model=s.TestSet, response_model_exclude_none=True, status_code=201)
def crear_conjunto(body: s.TestSetIn, e: m.Empresa = Depends(empresa_con_rol(*GESTION_AGENTE)), db: Session = Depends(get_db)):
    c = m.ConjuntoPrueba(empresa_id=e.id, nombre=body.name.strip(), descripcion=_limpiar(body.description))
    db.add(c)
    db.commit()
    return s.TestSet(**_conjunto_item(db, c, []), cases=[])


@router.post("/conjuntos/generar", response_model=s.TestSet, response_model_exclude_none=True, status_code=201)
def generar_conjunto(body: s.TestSetGenerate, e: m.Empresa = Depends(empresa_con_rol(*GESTION_AGENTE)), db: Session = Depends(get_db)):
    """Crea un conjunto con casos propuestos por IA a partir de la documentación de la empresa. Quedan marcados `ia` para que se revisen."""
    if body.model_id is not None and not modelos.existe(body.model_id):
        raise HTTPException(422, "Modelo de IA desconocido: consulta GET /modelos-ia")
    ids = None
    if body.document_ids:
        ids = [_uuid(x) for x in body.document_ids]
        propios = db.scalar(select(func.count()).select_from(m.Documento).where(m.Documento.id.in_(ids), m.Documento.empresa_id == e.id))
        if propios != len(set(ids)):
            raise HTTPException(404, "Alguno de los documentos no existe en esta empresa")
    try:
        propuestos = evaluacion.generar_casos(db, e, body.count, ids, body.negatives, body.model_id)
    except ValueError as exc:
        raise HTTPException(409, str(exc))
    c = m.ConjuntoPrueba(empresa_id=e.id, nombre=body.name.strip(), descripcion=_limpiar(body.description) or "Generado con IA a partir de la base de conocimiento.",
                         generado_con=modelos.obtener(body.model_id).id)
    db.add(c)
    db.flush()
    for i, p in enumerate(propuestos, 1):
        db.add(m.CasoPrueba(empresa_id=e.id, conjunto_id=c.id, orden=i, origen="ia", **p))
    db.commit()
    db.refresh(c)
    return s.TestSet(**_conjunto_item(db, c), cases=[_caso_out(x) for x in c.casos])


@router.get("/conjuntos/{cid}", response_model=s.TestSet, response_model_exclude_none=True)
def obtener_conjunto(cid: str, e: m.Empresa = Depends(empresa_con_rol(*GESTION_AGENTE)), db: Session = Depends(get_db)):
    c = _conjunto(db, e, cid)
    return s.TestSet(**_conjunto_item(db, c), cases=[_caso_out(x) for x in c.casos])


@router.patch("/conjuntos/{cid}", response_model=s.TestSetItem, response_model_exclude_none=True)
def editar_conjunto(cid: str, body: s.TestSetUpdate, e: m.Empresa = Depends(empresa_con_rol(*GESTION_AGENTE)), db: Session = Depends(get_db)):
    c = _conjunto(db, e, cid)
    cambios = body.model_dump(exclude_unset=True)
    if cambios.get("name") is not None:
        c.nombre = cambios["name"].strip()
    if "description" in cambios:
        c.descripcion = _limpiar(cambios["description"])
    if cambios.get("auto_run") is not None:
        c.auto_ejecutar = cambios["auto_run"]
    db.commit()
    return s.TestSetItem(**_conjunto_item(db, c))


@router.delete("/conjuntos/{cid}", status_code=204)
def borrar_conjunto(cid: str, e: m.Empresa = Depends(empresa_con_rol(*GESTION_AGENTE)), db: Session = Depends(get_db)):
    c = _conjunto(db, e, cid)
    if db.scalar(select(func.count()).select_from(m.EjecucionPrueba).where(m.EjecucionPrueba.conjunto_id == c.id, m.EjecucionPrueba.estado == "ejecutando")):
        raise HTTPException(409, "Hay una corrida en curso de este conjunto")
    db.delete(c)      # borra también sus casos y corridas
    db.commit()


# ------------------------------------------------------------------------------------------ casos
@router.post("/conjuntos/{cid}/casos", response_model=s.TestCase, response_model_exclude_none=True, status_code=201)
def crear_caso(cid: str, body: s.TestCaseIn, e: m.Empresa = Depends(empresa_con_rol(*GESTION_AGENTE)), db: Session = Depends(get_db)):
    c = _conjunto(db, e, cid)
    if len(c.casos) >= evaluacion.MAX_CASOS_POR_CONJUNTO:
        raise HTTPException(409, f"Un conjunto admite hasta {evaluacion.MAX_CASOS_POR_CONJUNTO} casos")
    conv_id = None
    if body.conversation_id:     # el caso nace de una conversación real: tiene que ser de esta empresa
        conv = db.scalar(select(m.Conversacion).where(m.Conversacion.id == _uuid(body.conversation_id), m.Conversacion.empresa_id == e.id))
        if not conv:
            raise HTTPException(404, "Conversación no encontrada")
        conv_id = conv.id
    caso = m.CasoPrueba(empresa_id=e.id, conjunto_id=c.id, orden=(c.casos[-1].orden + 1) if c.casos else 1, pregunta=body.question.strip(),
                        respuesta_esperada=None if body.should_escalate else _limpiar(body.expected_answer),
                        documento_esperado=None if body.should_escalate else _limpiar(body.expected_document),
                        debe_derivar=body.should_escalate, origen="real" if conv_id else "manual", conversacion_id=conv_id)
    db.add(caso)
    c.actualizado_en = datetime.now(timezone.utc)
    db.commit()
    return _caso_out(caso)


@router.patch("/casos/{caso_id}", response_model=s.TestCase, response_model_exclude_none=True)
def editar_caso(caso_id: str, body: s.TestCaseUpdate, e: m.Empresa = Depends(empresa_con_rol(*GESTION_AGENTE)), db: Session = Depends(get_db)):
    c = _caso(db, e, caso_id)
    cambios = body.model_dump(exclude_unset=True)
    if cambios.get("question") is not None:
        c.pregunta = cambios["question"].strip()
    if "expected_answer" in cambios:
        c.respuesta_esperada = _limpiar(cambios["expected_answer"])
    if "expected_document" in cambios:
        c.documento_esperado = _limpiar(cambios["expected_document"])
    if cambios.get("should_escalate") is not None:
        c.debe_derivar = cambios["should_escalate"]
    if c.debe_derivar:      # un caso que debe derivar no tiene respuesta ni documento esperados
        c.respuesta_esperada = c.documento_esperado = None
    db.commit()
    return _caso_out(c)


@router.delete("/casos/{caso_id}", status_code=204)
def borrar_caso(caso_id: str, e: m.Empresa = Depends(empresa_con_rol(*GESTION_AGENTE)), db: Session = Depends(get_db)):
    db.delete(_caso(db, e, caso_id))
    db.commit()


# ------------------------------------------------------------------------------------------ corridas
@router.post("/conjuntos/{cid}/ejecutar", response_model=s.TestRunBrief, response_model_exclude_none=True, status_code=202)
def ejecutar(cid: str, bg: BackgroundTasks, body: s.TestRunStart | None = None, e: m.Empresa = Depends(empresa_con_rol(*GESTION_AGENTE)),
             u: m.Usuario = Depends(usuario_actual), db: Session = Depends(get_db)):
    """Lanza una corrida en segundo plano (responde 202 con la corrida en estado `ejecutando`); el panel consulta el avance.
    `judgeModelId` elige el LLM juez que puntúa las respuestas (por defecto Haiku 5.5)."""
    juez = body.judge_model_id if body else None
    if juez is not None and not modelos.existe(juez):
        raise HTTPException(422, "Modelo juez desconocido: consulta GET /modelos-ia")
    c = _conjunto(db, e, cid)
    if not c.casos:
        raise HTTPException(409, "El conjunto no tiene casos: agrega al menos uno")
    for viva in db.scalars(select(m.EjecucionPrueba).where(m.EjecucionPrueba.empresa_id == e.id, m.EjecucionPrueba.estado == "ejecutando")):
        _run(db, e, str(viva.id))   # marca como cortadas las que quedaron colgadas
    if db.scalar(select(func.count()).select_from(m.EjecucionPrueba).where(m.EjecucionPrueba.empresa_id == e.id, m.EjecucionPrueba.estado == "ejecutando")):
        raise HTTPException(409, "Ya hay una corrida en curso: espera a que termine")
    run = evaluacion.iniciar(db, e, c, u, juez)
    bg.add_task(evaluacion.ejecutar, run.id)
    return _run_out(run)


@router.get("/ejecuciones", response_model=list[s.TestRunBrief], response_model_exclude_none=True)
def listar_corridas(conjunto_id: str | None = None, limit: int = Query(30, ge=1, le=100),
                    e: m.Empresa = Depends(empresa_con_rol(*GESTION_AGENTE)), db: Session = Depends(get_db)):
    q = select(m.EjecucionPrueba).where(m.EjecucionPrueba.empresa_id == e.id)
    if conjunto_id:
        q = q.where(m.EjecucionPrueba.conjunto_id == _uuid(conjunto_id))
    runs = db.scalars(q.order_by(m.EjecucionPrueba.iniciada_en.desc()).limit(limit)).all()
    return [_run_out(_run(db, e, str(x.id))) for x in runs]


def _resultados(db: Session, run: m.EjecucionPrueba) -> list[m.ResultadoPrueba]:
    return list(db.scalars(select(m.ResultadoPrueba).where(m.ResultadoPrueba.ejecucion_id == run.id, m.ResultadoPrueba.empresa_id == run.empresa_id)
                           .order_by(m.ResultadoPrueba.orden)).all())


def _veredictos_previos(db: Session, previa: m.EjecucionPrueba | None) -> dict:
    return {r.caso_id: r.veredicto for r in _resultados(db, previa) if r.caso_id} if previa else {}


@router.get("/ejecuciones/{rid}", response_model=s.TestRunDetail, response_model_exclude_none=True)
def detalle_corrida(rid: str, e: m.Empresa = Depends(empresa_con_rol(*GESTION_AGENTE)), db: Session = Depends(get_db)):
    run = _run(db, e, rid)
    previa = evaluacion.anterior(db, run)
    previos = _veredictos_previos(db, previa)
    res = [s.TestResult(
        id=str(r.id), order=r.orden, question=r.pregunta, expected_answer=r.respuesta_esperada, expected_document=r.documento_esperado,
        should_escalate=r.debe_derivar, answer=r.respuesta, escalated=r.derivo, sources=r.fuentes or [], confidence=r.confianza,
        latency_ms=r.latencia_ms, input_tokens=r.tokens_entrada, output_tokens=r.tokens_salida, cost_usd=float(r.costo_usd),
        source_ok=r.fuente_ok, escalation_ok=r.derivacion_ok, score=r.puntaje, verdict=r.veredicto, reason=r.motivo,
        previous_verdict=previos.get(r.caso_id), human_label=r.etiqueta_humana) for r in _resultados(db, run)]
    return s.TestRunDetail(run=_run_out(run), previous=_run_out(previa) if previa else None, error=run.error, results=res)


@router.delete("/ejecuciones/{rid}", status_code=204)
def borrar_corrida(rid: str, e: m.Empresa = Depends(empresa_con_rol(*GESTION_AGENTE)), db: Session = Depends(get_db)):
    run = _run(db, e, rid)
    if run.estado == "ejecutando":
        raise HTTPException(409, "La corrida sigue en curso")
    db.delete(run)
    db.commit()


@router.get("/ejecuciones/{rid}/exportar")
def exportar(rid: str, formato: Literal["csv", "excel"] = "csv", e: m.Empresa = Depends(empresa_con_rol(*GESTION_AGENTE)),
             db: Session = Depends(get_db)):
    """CSV con la plantilla de alloxentric. `formato=excel` usa «;» como separador (Excel en español)."""
    run = _run(db, e, rid)
    if run.estado == "ejecutando":
        raise HTTPException(409, "La corrida sigue en curso: exporta cuando termine")
    previa = evaluacion.anterior(db, run)
    datos = reporte.construir(e, run, _resultados(db, run), previa, _veredictos_previos(db, previa), excel=formato == "excel")
    seguro = lambda t: re.sub(r"[^A-Za-z0-9]+", "-", t).strip("-").lower() or "x"   # noqa: E731
    nombre = f"alloxentric_pruebas_{seguro(e.slug)}_{seguro(run.conjunto_nombre)}_{run.iniciada_en.astimezone().strftime('%Y%m%d-%H%M')}.csv"
    return Response(content=datos, media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="{nombre}"'})


# ------------------------------------------------------------------------------------------ comparar modelos en una sola corrida
def _validar_modelos(ids: list[str], etiqueta: str) -> None:
    for x in ids:
        if not modelos.existe(x):
            raise HTTPException(422, f"{etiqueta} desconocido: {x}. Consulta GET /modelos-ia")


@router.post("/conjuntos/{cid}/comparar", response_model=s.TestComparison, response_model_exclude_none=True, status_code=202)
def comparar(cid: str, body: s.TestCompareStart, bg: BackgroundTasks, e: m.Empresa = Depends(empresa_con_rol(*GESTION_AGENTE)),
             u: m.Usuario = Depends(usuario_actual), db: Session = Depends(get_db)):
    """Corre el mismo golden set con varios modelos de agente (y el mismo juez) para compararlos lado a lado. No cambia el modelo configurado."""
    ids = list(dict.fromkeys(body.model_ids))
    if len(ids) < 2:
        raise HTTPException(422, "Elige al menos dos modelos distintos para comparar")
    _validar_modelos(ids, "Modelo")
    if body.judge_model_id is not None:
        _validar_modelos([body.judge_model_id], "Modelo juez")
    c = _conjunto(db, e, cid)
    if not c.casos:
        raise HTTPException(409, "El conjunto no tiene casos: agrega al menos uno")
    for viva in db.scalars(select(m.EjecucionPrueba).where(m.EjecucionPrueba.empresa_id == e.id, m.EjecucionPrueba.estado == "ejecutando")):
        _run(db, e, str(viva.id))
    if db.scalar(select(func.count()).select_from(m.EjecucionPrueba).where(m.EjecucionPrueba.empresa_id == e.id, m.EjecucionPrueba.estado == "ejecutando")):
        raise HTTPException(409, "Ya hay una corrida en curso: espera a que termine")
    grupo = uuid.uuid4()
    runs = [evaluacion.iniciar(db, e, c, u, body.judge_model_id, modelo_agente=mid, grupo_id=grupo) for mid in ids]
    bg.add_task(evaluacion.ejecutar_grupo, [r.id for r in runs])
    return _comparacion(db, e, grupo, 80.0)


def _comparacion(db: Session, e: m.Empresa, grupo: uuid.UUID, minimo: float) -> s.TestComparison:
    runs = list(db.scalars(select(m.EjecucionPrueba).where(m.EjecucionPrueba.empresa_id == e.id, m.EjecucionPrueba.grupo_id == grupo)
                           .order_by(m.EjecucionPrueba.iniciada_en)).all())
    if not runs:
        raise HTTPException(404, "Comparativa no encontrada")
    runs = [_run(db, e, str(r.id)) for r in runs]
    hechas = [r for r in runs if r.estado == "completada" and r.resumen]
    cumplen = [r for r in hechas if r.resumen["tasa_aprobacion"] >= minimo]
    nombre = lambda r: modelos.obtener(r.modelo_ia).nombre   # noqa: E731
    if any(r.estado == "ejecutando" for r in runs):
        rec, texto = None, "La comparativa sigue en curso."
    elif cumplen:
        mejor = min(cumplen, key=lambda r: (r.resumen["costo_agente_usd"], -r.resumen["tasa_aprobacion"]))
        rec = mejor
        texto = (f"{nombre(mejor)} es el más barato que cumple al menos {minimo:g} % de aprobación: {mejor.resumen['tasa_aprobacion']:g} % por "
                 f"{mejor.resumen['costo_agente_usd']:.6f} USD el golden set.")
    elif hechas:
        mejor = max(hechas, key=lambda r: r.resumen["tasa_aprobacion"])
        rec, texto = None, f"Ningún modelo alcanzó {minimo:g} % de aprobación. El mejor fue {nombre(mejor)} con {mejor.resumen['tasa_aprobacion']:g} %."
    else:
        rec, texto = None, "Ninguna corrida terminó con resultados."
    p = runs[0]
    return s.TestComparison(group_id=str(grupo), set_id=str(p.conjunto_id), set_name=p.conjunto_nombre, judge_model_id=p.modelo_juez, min_quality=minimo,
                            runs=[_run_out(r) for r in runs], recommended_run_id=str(rec.id) if rec else None, recommendation=texto)


@router.get("/comparativas/{grupo}", response_model=s.TestComparison, response_model_exclude_none=True)
def ver_comparativa(grupo: str, calidad_minima: float = Query(80, ge=0, le=100), e: m.Empresa = Depends(empresa_con_rol(*GESTION_AGENTE)),
                    db: Session = Depends(get_db)):
    return _comparacion(db, e, _uuid(grupo), calidad_minima)


# ------------------------------------------------------------------------------------------ etiquetas humanas y calibración del juez
@router.put("/resultados/{rid}/etiqueta", response_model=s.TestResult, response_model_exclude_none=True)
def etiquetar(rid: str, body: s.TestLabel, e: m.Empresa = Depends(empresa_con_rol(*GESTION_AGENTE)), db: Session = Depends(get_db)):
    """Una persona marca la respuesta como correcta o incorrecta (o quita la marca). Con varias etiquetas se puede medir qué tan bien juzga cada modelo."""
    r = db.scalar(select(m.ResultadoPrueba).where(m.ResultadoPrueba.id == _uuid(rid), m.ResultadoPrueba.empresa_id == e.id))   # <- tenant
    if not r:
        raise HTTPException(404, "Resultado no encontrado")
    r.etiqueta_humana = body.label
    db.commit()
    return s.TestResult(
        id=str(r.id), order=r.orden, question=r.pregunta, expected_answer=r.respuesta_esperada, expected_document=r.documento_esperado,
        should_escalate=r.debe_derivar, answer=r.respuesta, escalated=r.derivo, sources=r.fuentes or [], confidence=r.confianza, latency_ms=r.latencia_ms,
        input_tokens=r.tokens_entrada, output_tokens=r.tokens_salida, cost_usd=float(r.costo_usd), source_ok=r.fuente_ok, escalation_ok=r.derivacion_ok,
        score=r.puntaje, verdict=r.veredicto, reason=r.motivo, human_label=r.etiqueta_humana)


def _cal_out(c: m.CalibracionJuez) -> s.CalibrationRun:
    jueces = [s.CalibrationJudge(
        model_id=mid, n=x["n"], agreement=x["acuerdo"], true_positives=x["tp"], true_negatives=x["tn"], false_positives=x["fp"], false_negatives=x["fn"],
        precision=x["precision"], recall=x["exhaustividad"], kappa=x["kappa"], without_judge=x["sin_juez"], cost_usd=x["costo_usd"],
        avg_score_if_correct=x["puntaje_si_correcto"], avg_score_if_incorrect=x["puntaje_si_incorrecto"]) for mid, x in (c.resumen or {}).items()]
    return s.CalibrationRun(id=str(c.id), status=c.estado, judge_model_ids=list(c.modelos), labeled=c.etiquetados, total=c.total, completed=c.completados,
                            started_at=c.iniciada_en.isoformat(), finished_at=_iso(c.terminada_en), created_by=c.creada_por, error=c.error, judges=jueces)


@router.get("/etiquetas", response_model=s.LabelCounts)
def contar_etiquetas(e: m.Empresa = Depends(empresa_con_rol(*GESTION_AGENTE)), db: Session = Depends(get_db)):
    it = evaluacion.etiquetados(db, e.id)
    return s.LabelCounts(labeled=len(it), correct=sum(1 for x in it if x.etiqueta_humana == "correcto"), incorrect=sum(1 for x in it if x.etiqueta_humana == "incorrecto"),
                         min_required=evaluacion.MIN_ETIQUETAS, max_used=evaluacion.MAX_ETIQUETAS)


@router.post("/calibraciones", response_model=s.CalibrationRun, response_model_exclude_none=True, status_code=202)
def calibrar(body: s.CalibrationStart, bg: BackgroundTasks, e: m.Empresa = Depends(empresa_con_rol(*GESTION_AGENTE)),
             u: m.Usuario = Depends(usuario_actual), db: Session = Depends(get_db)):
    """Mide cuánto coincide cada juez elegido con tus etiquetas humanas. Hace que el juez vuelva a puntuar esas respuestas (gasta tokens)."""
    ids = list(dict.fromkeys(body.judge_model_ids))
    _validar_modelos(ids, "Modelo juez")
    if not llm.disponible():
        raise HTTPException(409, "La calibración necesita AWS Bedrock habilitado (BEDROCK_HABILITADO=true).")
    if finops.limite_alcanzado(db, e):
        raise HTTPException(409, "Se alcanzó el límite de gasto de IA: no se puede calibrar hasta que se libere.")
    n = len(evaluacion.etiquetados(db, e.id))
    if n < evaluacion.MIN_ETIQUETAS:
        raise HTTPException(409, f"Faltan etiquetas: hay {n} y se necesitan al menos {evaluacion.MIN_ETIQUETAS}. Marca respuestas como correctas o incorrectas en los resultados de una corrida.")
    if db.scalar(select(func.count()).select_from(m.CalibracionJuez).where(m.CalibracionJuez.empresa_id == e.id, m.CalibracionJuez.estado == "ejecutando",
                                                                           m.CalibracionJuez.iniciada_en > datetime.now(timezone.utc) - VENCIDA)):
        raise HTTPException(409, "Ya hay una calibración en curso")
    c = m.CalibracionJuez(empresa_id=e.id, modelos=ids, etiquetados=n, total=n * len(ids), creada_por=u.nombre or u.email)
    db.add(c)
    db.commit()
    bg.add_task(evaluacion.calibrar, c.id)
    return _cal_out(c)


@router.get("/calibraciones", response_model=list[s.CalibrationRun], response_model_exclude_none=True)
def listar_calibraciones(e: m.Empresa = Depends(empresa_con_rol(*GESTION_AGENTE)), db: Session = Depends(get_db)):
    return [_cal_out(c) for c in db.scalars(select(m.CalibracionJuez).where(m.CalibracionJuez.empresa_id == e.id)
                                            .order_by(m.CalibracionJuez.iniciada_en.desc()).limit(20))]


@router.get("/calibraciones/{cid}", response_model=s.CalibrationRun, response_model_exclude_none=True)
def ver_calibracion(cid: str, e: m.Empresa = Depends(empresa_con_rol(*GESTION_AGENTE)), db: Session = Depends(get_db)):
    c = db.scalar(select(m.CalibracionJuez).where(m.CalibracionJuez.id == _uuid(cid), m.CalibracionJuez.empresa_id == e.id))
    if not c:
        raise HTTPException(404, "Calibración no encontrada")
    return _cal_out(c)
