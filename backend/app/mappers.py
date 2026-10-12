"""ORM -> schemas del front. Toda la traducción español/BD -> camelCase/front vive aquí."""
from datetime import timedelta
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from app import models as m
from app import schemas as s
from app.config import PUBLIC_CHAT_BASE_URL
from app.utils import ahora, tiempo_relativo, fecha_corta, hora, fecha_exacta, tamano

ROL_A_SENDER = {"usuario": "user", "bot": "bot", "agente": "agent"}


def documento_out(d: m.Documento) -> s.DocumentItem:
    return s.DocumentItem(id=str(d.id), name=d.nombre, type=d.tipo, size=tamano(d.tamano_bytes),
                          uploaded_at=fecha_corta(d.subido_en), status=d.estado,
                          chunk_count=d.num_fragmentos)


def empresa_out(db: Session, e: m.Empresa, api_key: str | None = None) -> s.Company:
    docs = db.scalars(select(m.Documento).where(m.Documento.empresa_id == e.id)
                      .order_by(m.Documento.subido_en.desc())).all()
    desde = ahora() - timedelta(days=30)
    consultas = db.scalar(select(func.count()).select_from(m.Mensaje).where(
        m.Mensaje.empresa_id == e.id, m.Mensaje.rol == "usuario", m.Mensaje.creado_en >= desde)) or 0
    convs = db.scalar(select(func.count()).select_from(m.Conversacion).where(
        m.Conversacion.empresa_id == e.id, m.Conversacion.iniciada_en >= desde)) or 0
    derivadas = db.scalar(select(func.count()).select_from(m.Conversacion).where(
        m.Conversacion.empresa_id == e.id, m.Conversacion.iniciada_en >= desde,
        m.Conversacion.derivada.is_(True))) or 0
    tasa = round((convs - derivadas) / convs * 100, 1) if convs else 0.0
    return s.Company(
        id=e.slug, name=e.nombre, slug=e.slug, industry=e.industria or "",
        logo_initials=e.iniciales_logo or e.nombre[:2].upper(),
        brand_color=e.color_marca or "#4F46E5", brand_bg=e.color_fondo or "#EEF2FF",
        agent_name=e.nombre_agente or f"{e.nombre} Assistant", agent_status=e.estado_agente,
        documents_count=len(docs), documents=[documento_out(d) for d in docs],
        tone=e.tono, custom_instructions=e.instrucciones or "",
        web_chat_url=f"{PUBLIC_CHAT_BASE_URL}/{e.slug}",
        monthly_queries=consultas, bot_resolution_rate=tasa, rag_threshold=e.umbral_rag,
        last_updated=tiempo_relativo(e.actualizada_en).replace("hace ", "Hace ", 1),
        version=f"v{e.version}.0.0", api_key=api_key)


def mensaje_out(x: m.Mensaje) -> s.ChatMessage:
    return s.ChatMessage(
        id=str(x.id), sender=ROL_A_SENDER[x.rol], sender_name=x.nombre_remitente or x.rol.capitalize(),
        message=x.contenido, timestamp=hora(x.creado_en),
        is_escalation_notice=True if x.es_aviso_derivacion else None,
        rag_sources=x.fuentes or None, confidence_score=x.confianza)


def ticket_out(t: m.Ticket) -> s.Ticket:
    conv, emp = t.conversacion, t.empresa
    msgs = list(conv.mensajes)
    primer_user = next((x.contenido for x in msgs if x.rol == "usuario"), "")
    sug = t.sugerencia_ia or {}
    edad_min = (ahora() - t.creado_en).total_seconds() / 60
    return s.Ticket(
        id=str(t.id), ticket_number=t.numero, company_id=emp.slug, company_name=emp.nombre,
        company_color=emp.color_marca or "#4F46E5", company_bg=emp.color_fondo or "#EEF2FF",
        status=t.estado, user_query_excerpt=primer_user[:220],
        escalation_reason=t.motivo_derivacion or "", relative_time=tiempo_relativo(t.creado_en),
        exact_timestamp=fecha_exacta(t.creado_en),
        customer_name=conv.nombre_cliente or "Usuario web", customer_email=conv.email_cliente or "",
        customer_channel=conv.canal, transcript=[mensaje_out(x) for x in msgs],
        ai_suggestion=s.AiSuggestion(confidence=sug.get("confidence", 0.0),
                                     source_doc=sug.get("sourceDoc", ""),
                                     summary=sug.get("summary", ""),
                                     draft_response=sug.get("draftResponse", "")),
        assigned_agent=nombre_usuario(t.agente) if t.agente else "Sin asignar",
        assigned_agent_id=str(t.agente_asignado_id) if t.agente_asignado_id else None,
        is_live=(t.estado != "resuelto" and edad_min < 60))


def nombre_usuario(u: m.Usuario) -> str:
    return u.nombre or u.email.split("@")[0]


def usuario_out(u):
    return s.UserOut(id=str(u.id), email=u.email, name=nombre_usuario(u), role=u.rol,
                     company_id=u.empresa.slug if u.empresa else None, active=u.activo)
