"""Modelo multi-tenant: TODA tabla (salvo empresas) lleva empresa_id.
Toda consulta del backend debe filtrar por empresa_id (RNF-01)."""
import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Text, ForeignKey, DateTime, Boolean, Float, Integer, Index, CheckConstraint, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from pgvector.sqlalchemy import Vector
from app.db import Base

EMBED_DIM = 384  # paraphrase-multilingual-MiniLM-L12-v2


def _id():
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


def _empresa_fk():
    return mapped_column(UUID(as_uuid=True),
                         ForeignKey("empresas.id", ondelete="CASCADE"),
                         nullable=False, index=True)


class Empresa(Base):
    __tablename__ = "empresas"
    id: Mapped[uuid.UUID] = _id()
    nombre: Mapped[str] = mapped_column(String(120), unique=True)
    slug: Mapped[str] = mapped_column(String(60), unique=True)      # front: slug / id de tenant
    industria: Mapped[str | None] = mapped_column(String(160))
    api_key_hash: Mapped[str] = mapped_column(String(128), unique=True)
    url_sitio: Mapped[str | None] = mapped_column(String(255))
    # --- configuración del agente (panel de despliegue) ---
    nombre_agente: Mapped[str | None] = mapped_column(String(120))
    estado_agente: Mapped[str] = mapped_column(String(20), default="en_configuracion")  # activo|en_configuracion|inactivo
    tono: Mapped[str] = mapped_column(String(10), default="formal")                      # formal|cercano|tecnico
    instrucciones: Mapped[str | None] = mapped_column(Text)
    umbral_rag: Mapped[float] = mapped_column(Float, default=0.8)
    version: Mapped[int] = mapped_column(Integer, default=1)
    # --- branding del widget ---
    iniciales_logo: Mapped[str | None] = mapped_column(String(4))
    color_marca: Mapped[str | None] = mapped_column(String(9))
    color_fondo: Mapped[str | None] = mapped_column(String(9))
    config: Mapped[dict] = mapped_column(JSONB, default=dict)  # extras futuros
    actualizada_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    creada_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


ROLES = ("superadmin", "admin_empresa", "encargado_tickets", "encargado_agente")


class Usuario(Base):
    """Usuarios de la plataforma. El superadmin no pertenece a ninguna empresa (empresa_id NULL);
    los otros tres roles pertenecen SIEMPRE a una empresa (check constraint)."""
    __tablename__ = "usuarios"
    __table_args__ = (
        CheckConstraint("rol IN ('superadmin','admin_empresa','encargado_tickets','encargado_agente')",
                        name="ck_usuarios_rol"),
        CheckConstraint("(rol = 'superadmin') = (empresa_id IS NULL)", name="ck_usuarios_superadmin_sin_empresa"),
    )
    id: Mapped[uuid.UUID] = _id()
    empresa_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("empresas.id", ondelete="CASCADE"), nullable=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True)
    nombre: Mapped[str] = mapped_column(String(120), default="")
    password_hash: Mapped[str] = mapped_column(String(255))
    rol: Mapped[str] = mapped_column(String(20), default="admin_empresa")
    activo: Mapped[bool] = mapped_column(Boolean, default=True)
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    empresa: Mapped["Empresa | None"] = relationship()


class Documento(Base):
    __tablename__ = "documentos"
    id: Mapped[uuid.UUID] = _id()
    empresa_id: Mapped[uuid.UUID] = _empresa_fk()
    nombre: Mapped[str] = mapped_column(String(255))
    tipo: Mapped[str] = mapped_column(String(10))            # pdf | docx | txt | faq | csv
    tamano_bytes: Mapped[int] = mapped_column(Integer, default=0)
    ruta_local: Mapped[str] = mapped_column(String(500))     # storage/<empresa_id>/...
    estado: Mapped[str] = mapped_column(String(20), default="procesando")  # procesando|procesado|error
    num_fragmentos: Mapped[int] = mapped_column(Integer, default=0)
    subido_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    fragmentos: Mapped[list["FragmentoEmbedding"]] = relationship(cascade="all, delete-orphan")


class FragmentoEmbedding(Base):
    __tablename__ = "fragmentos_embeddings"
    id: Mapped[uuid.UUID] = _id()
    empresa_id: Mapped[uuid.UUID] = _empresa_fk()
    documento_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("documentos.id", ondelete="CASCADE"), index=True)
    orden: Mapped[int]
    texto: Mapped[str] = mapped_column(Text)
    embedding = mapped_column(Vector(EMBED_DIM))
    __table_args__ = (
        Index("ix_fragmentos_embedding_hnsw", "embedding",
              postgresql_using="hnsw",
              postgresql_with={"m": 16, "ef_construction": 64},
              postgresql_ops={"embedding": "vector_cosine_ops"}),
    )


class Conversacion(Base):
    __tablename__ = "conversaciones"
    id: Mapped[uuid.UUID] = _id()
    empresa_id: Mapped[uuid.UUID] = _empresa_fk()
    nombre_cliente: Mapped[str | None] = mapped_column(String(160))
    email_cliente: Mapped[str | None] = mapped_column(String(255))
    canal: Mapped[str] = mapped_column(String(30), default="Web Chat")  # Web Chat | WhatsApp API | Portal Clientes
    derivada: Mapped[bool] = mapped_column(Boolean, default=False)
    iniciada_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    mensajes: Mapped[list["Mensaje"]] = relationship(
        cascade="all, delete-orphan", order_by="Mensaje.creado_en")


class Mensaje(Base):
    __tablename__ = "mensajes"
    id: Mapped[uuid.UUID] = _id()
    empresa_id: Mapped[uuid.UUID] = _empresa_fk()
    conversacion_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("conversaciones.id", ondelete="CASCADE"), index=True)
    rol: Mapped[str] = mapped_column(String(10))   # usuario | bot | agente
    nombre_remitente: Mapped[str | None] = mapped_column(String(160))
    contenido: Mapped[str] = mapped_column(Text)
    es_aviso_derivacion: Mapped[bool] = mapped_column(Boolean, default=False)
    fuentes: Mapped[list | None] = mapped_column(JSONB)       # nombres de documentos usados (RAG)
    confianza: Mapped[float | None] = mapped_column(Float)    # 0..1
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))  # no now(): en una misma transacción repetiría la hora y desordenaría la transcripción


class Ticket(Base):
    __tablename__ = "tickets"
    __table_args__ = (Index("ix_tickets_estado_encuesta", "estado", "encuesta_enviada_en"),)  # barrido de encuestas vencidas
    id: Mapped[uuid.UUID] = _id()
    empresa_id: Mapped[uuid.UUID] = _empresa_fk()
    conversacion_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("conversaciones.id", ondelete="CASCADE"), index=True)
    numero: Mapped[str] = mapped_column(String(20), unique=True)  # COR-8921 (de Corestream o del mock)
    # pendiente|urgente (en la cola del encargado) -> esperando_cliente (respondido, con encuesta) ->
    # cerrado (el cliente confirmó o no contestó en ENCUESTA_HORAS; final) | escalado (el cliente dijo que NO;
    # se gestiona fuera del chat por el admin de la empresa). Ver services/ciclo_ticket.py
    estado: Mapped[str] = mapped_column(String(20), default="pendiente")
    encuesta_enviada_en: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cierre_motivo: Mapped[str | None] = mapped_column(String(30))  # confirmado_cliente|sin_respuesta|gestion_manual|migrado
    motivo_derivacion: Mapped[str | None] = mapped_column(Text)
    sugerencia_ia: Mapped[dict | None] = mapped_column(JSONB)  # {confidence, sourceDoc, summary, draftResponse}
    # agente humano responsable: usuario real de la MISMA empresa (se valida en el router)
    agente_asignado_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True, index=True)
    agente: Mapped["Usuario | None"] = relationship()
    actualizado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    conversacion: Mapped["Conversacion"] = relationship()
    empresa: Mapped["Empresa"] = relationship()
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
