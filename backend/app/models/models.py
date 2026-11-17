"""Modelo multi-tenant: TODA tabla (salvo empresas) lleva empresa_id.
Toda consulta del backend debe filtrar por empresa_id (RNF-01)."""
import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Text, text, ForeignKey, DateTime, Boolean, Float, Integer, Index, CheckConstraint, Numeric, func
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
    # --- plan de gasto de IA (FinOps): limitado = tope mensual en USD; sin_limite = se cobra lo consumido ---
    plan_gasto: Mapped[str] = mapped_column(String(12), default="sin_limite", server_default="sin_limite")
    limite_mensual_usd: Mapped[float | None] = mapped_column(Numeric(10, 2))
    limite_diario_usd: Mapped[float | None] = mapped_column(Numeric(10, 2))     # tope por día (solo plan limitado); None = sin tope diario
    dominios_permitidos: Mapped[list] = mapped_column(JSONB, default=list, server_default='[]')   # sitios donde puede ir el widget; vacío = cualquiera
    modelo_ia: Mapped[str] = mapped_column(String(40), default="haiku-5-5", server_default="haiku-5-5")   # ver services/modelos.py
    chatbot_pendiente: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")   # empresa registrada por su dueño que aún no crea su chatbot (uno por empresa)
    seguridad: Mapped[dict] = mapped_column(JSONB, default=dict, server_default='{}')   # guardarraíles de la IA (services/seguridad.py): pii, inyeccion, temasProhibidos, fuentesPublicas
    horario: Mapped[dict] = mapped_column(JSONB, default=dict, server_default='{}')     # atención humana: {activo, dias:{lun:[desde,hasta]…}, mensajeFuera}
    version: Mapped[int] = mapped_column(Integer, default=1)
    # --- branding del widget ---
    iniciales_logo: Mapped[str | None] = mapped_column(String(4))
    color_marca: Mapped[str | None] = mapped_column(String(9))
    color_fondo: Mapped[str | None] = mapped_column(String(9))
    config: Mapped[dict] = mapped_column(JSONB, default=dict)  # extras futuros
    actualizada_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    creada_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


ROLES = ("superadmin", "admin_empresa", "encargado_tickets", "encargado_agente", "registrado")
SIN_EMPRESA = ("superadmin", "registrado")     # roles sin empresa: el superadmin (plataforma) y el recién registrado (aún no registra su empresa)


class Usuario(Base):
    """Usuarios de la plataforma. El superadmin (plataforma) y el `registrado` (se creó una cuenta pero aún no registra su empresa)
    no pertenecen a ninguna empresa (empresa_id NULL); los otros tres roles pertenecen SIEMPRE a una empresa (check constraint)."""
    __tablename__ = "usuarios"
    __table_args__ = (
        CheckConstraint("rol IN ('superadmin','admin_empresa','encargado_tickets','encargado_agente','registrado')",
                        name="ck_usuarios_rol"),
        CheckConstraint("(rol IN ('superadmin','registrado')) = (empresa_id IS NULL)", name="ck_usuarios_sin_empresa"),
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
    version: Mapped[int] = mapped_column(Integer, default=1, server_default='1')   # sube cada vez que se reemplaza el archivo
    num_fragmentos: Mapped[int] = mapped_column(Integer, default=0)
    advertencia: Mapped[str | None] = mapped_column(String(200))   # p. ej. «contiene órdenes ocultas dirigidas al modelo»
    subido_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    fragmentos: Mapped[list["FragmentoEmbedding"]] = relationship(cascade="all, delete-orphan")


class FragmentoEmbedding(Base):
    __tablename__ = "fragmentos_embeddings"
    id: Mapped[uuid.UUID] = _id()
    empresa_id: Mapped[uuid.UUID] = _empresa_fk()
    documento_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("documentos.id", ondelete="CASCADE"), index=True)
    orden: Mapped[int]
    pagina: Mapped[int | None] = mapped_column(Integer)      # página del PDF de la que sale el fragmento (None en otros formatos)
    texto: Mapped[str] = mapped_column(Text)
    embedding = mapped_column(Vector(EMBED_DIM))
    # id del embedder que generó el vector (p. ej. st:paraphrase-multilingual-MiniLM-L12-v2 o hash-v1): la búsqueda solo
    # usa fragmentos del embedder activo, porque vectores de modelos distintos no se pueden comparar
    modelo: Mapped[str | None] = mapped_column(String(80))
    __table_args__ = (
        Index("ix_fragmentos_embedding_hnsw", "embedding",
              postgresql_using="hnsw",
              postgresql_with={"m": 16, "ef_construction": 64},
              postgresql_ops={"embedding": "vector_cosine_ops"}),
        # búsqueda por palabras clave (RAG híbrido): texto completo en español sin tildes; misma expresión que services/hibrido.py
        Index("ix_fragmentos_fts", text("to_tsvector('spanish', translate(lower(texto), 'áéíóúüñ', 'aeiouun'))"), postgresql_using="gin"),
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
    visitante_id: Mapped[str | None] = mapped_column(String(64), index=True)   # identificador anónimo del navegador: permite reconocer a quien vuelve
    resumen_memoria: Mapped[str | None] = mapped_column(Text)                  # resumen de lo ya dicho en una conversación larga
    memoria_hasta: Mapped[int] = mapped_column(Integer, default=0, server_default="0")   # cuántos mensajes cubre el resumen
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
    fuentes_detalle: Mapped[list | None] = mapped_column(JSONB)   # [{documentId, documentName, fragmentId, order, excerpt, confidence}]: de dónde salió la respuesta
    valoracion: Mapped[str | None] = mapped_column(String(6))     # arriba | abajo: lo marca el cliente en el chat
    valoracion_comentario: Mapped[str | None] = mapped_column(String(500))
    valoracion_en: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
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
    resumen_ia: Mapped[dict | None] = mapped_column(JSONB)     # {summary, reason, urgency, source: ia|reglas, generatedAt}
    # agente humano responsable: usuario real de la MISMA empresa (se valida en el router)
    agente_asignado_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True, index=True)
    agente: Mapped["Usuario | None"] = relationship()
    actualizado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    conversacion: Mapped["Conversacion"] = relationship()
    empresa: Mapped["Empresa"] = relationship()
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class UsoIA(Base):
    """Una llamada al modelo de IA: tokens y costo. Base del panel FinOps y del límite mensual.
    El costo se guarda al momento de la llamada (con el precio vigente) para que un cambio de precios no reescriba el historial."""
    __tablename__ = "usos_ia"
    __table_args__ = (Index("ix_usos_ia_empresa_fecha", "empresa_id", "creado_en"),)
    id: Mapped[uuid.UUID] = _id()
    empresa_id: Mapped[uuid.UUID] = _empresa_fk()
    conversacion_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("conversaciones.id", ondelete="SET NULL"), index=True)
    modelo: Mapped[str] = mapped_column(String(40))              # id del catálogo (services/modelos.py)
    tipo: Mapped[str] = mapped_column(String(12), default="respuesta")   # respuesta | sugerencia (borrador para el agente humano)
    tokens_entrada: Mapped[int] = mapped_column(Integer, default=0)
    tokens_salida: Mapped[int] = mapped_column(Integer, default=0)
    costo_usd: Mapped[float] = mapped_column(Numeric(12, 6), default=0)
    latencia_ms: Mapped[int] = mapped_column(Integer, default=0, server_default="0")          # traza: lo que tardó la llamada
    exito: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")         # traza: false = el modelo no respondió
    error: Mapped[str | None] = mapped_column(String(60))                                    # tipo de error (p. ej. ThrottlingException)
    respaldo: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")   # la respondió el modelo de respaldo
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


# ---------------------------------------------------------------------------------------------- pruebas del agente (testing)
class ConjuntoPrueba(Base):
    """Golden set: preguntas con la respuesta esperada, creadas a mano o con ayuda de IA, para medir el agente de una empresa."""
    __tablename__ = "conjuntos_prueba"
    id: Mapped[uuid.UUID] = _id()
    empresa_id: Mapped[uuid.UUID] = _empresa_fk()
    nombre: Mapped[str] = mapped_column(String(120))
    descripcion: Mapped[str | None] = mapped_column(Text)
    generado_con: Mapped[str | None] = mapped_column(String(40))          # modelo de IA que propuso los casos (None = hecho a mano)
    auto_ejecutar: Mapped[bool] = mapped_column(Boolean, default=False, server_default='false')   # correr solo al ingestar/borrar/reemplazar documentos
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    actualizado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
                                                     onupdate=lambda: datetime.now(timezone.utc))
    casos: Mapped[list["CasoPrueba"]] = relationship(cascade="all, delete-orphan", order_by="CasoPrueba.orden")


class CasoPrueba(Base):
    __tablename__ = "casos_prueba"
    id: Mapped[uuid.UUID] = _id()
    empresa_id: Mapped[uuid.UUID] = _empresa_fk()
    conjunto_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("conjuntos_prueba.id", ondelete="CASCADE"), index=True)
    orden: Mapped[int] = mapped_column(Integer, default=0)
    pregunta: Mapped[str] = mapped_column(Text)
    respuesta_esperada: Mapped[str | None] = mapped_column(Text)        # lo que debería decir (puede ir vacía si solo importa derivar)
    documento_esperado: Mapped[str | None] = mapped_column(String(255))  # documento que debería citar como fuente
    debe_derivar: Mapped[bool] = mapped_column(Boolean, default=False)   # pregunta fuera de la documentación: debe pasar a un humano
    origen: Mapped[str] = mapped_column(String(10), default="manual")    # manual | ia | real (viene de una conversación)
    conversacion_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("conversaciones.id", ondelete="SET NULL"), index=True)
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class EjecucionPrueba(Base):
    """Una corrida de un conjunto contra el agente. Guarda con qué modelo, umbral y base de conocimiento se hizo, para poder
    comparar corridas y ver cómo cambió el desempeño al ingestar documentos."""
    __tablename__ = "ejecuciones_prueba"
    id: Mapped[uuid.UUID] = _id()
    empresa_id: Mapped[uuid.UUID] = _empresa_fk()
    conjunto_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("conjuntos_prueba.id", ondelete="CASCADE"), index=True)
    conjunto_nombre: Mapped[str] = mapped_column(String(120))
    modelo_ia: Mapped[str] = mapped_column(String(40))                      # modelo del agente que se probó
    modelo_juez: Mapped[str] = mapped_column(String(40), default="haiku-5-5", server_default="haiku-5-5")   # LLM as a Judge
    umbral_rag: Mapped[float] = mapped_column(Float)
    grupo_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), index=True)   # corridas lanzadas juntas para comparar modelos
    origen: Mapped[str] = mapped_column(String(12), default="manual", server_default="manual")   # manual | automatica
    disparador: Mapped[str | None] = mapped_column(Text)                   # qué la disparó (p. ej. «subir tarifas.pdf»)
    estado: Mapped[str] = mapped_column(String(12), default="ejecutando")   # ejecutando | completada | error
    total: Mapped[int] = mapped_column(Integer, default=0)
    completados: Mapped[int] = mapped_column(Integer, default=0)
    kb: Mapped[dict] = mapped_column(JSONB, default=dict)                   # {documentos, fragmentos} al iniciar
    resumen: Mapped[dict | None] = mapped_column(JSONB)                     # métricas al terminar
    error: Mapped[str | None] = mapped_column(Text)
    creada_por: Mapped[str | None] = mapped_column(String(160))
    iniciada_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    terminada_en: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ResultadoPrueba(Base):
    """Cómo respondió el agente a un caso. Copia (snapshot) la pregunta y lo esperado: editar el conjunto después no altera el historial."""
    __tablename__ = "resultados_prueba"
    id: Mapped[uuid.UUID] = _id()
    empresa_id: Mapped[uuid.UUID] = _empresa_fk()
    ejecucion_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ejecuciones_prueba.id", ondelete="CASCADE"), index=True)
    caso_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("casos_prueba.id", ondelete="SET NULL"), index=True)
    orden: Mapped[int] = mapped_column(Integer, default=0)
    pregunta: Mapped[str] = mapped_column(Text)
    respuesta_esperada: Mapped[str | None] = mapped_column(Text)
    documento_esperado: Mapped[str | None] = mapped_column(String(255))
    debe_derivar: Mapped[bool] = mapped_column(Boolean, default=False)
    respuesta: Mapped[str] = mapped_column(Text, default="")
    derivo: Mapped[bool] = mapped_column(Boolean, default=False)
    fuentes: Mapped[list | None] = mapped_column(JSONB)
    confianza: Mapped[float | None] = mapped_column(Float)
    latencia_ms: Mapped[int] = mapped_column(Integer, default=0)
    tokens_entrada: Mapped[int] = mapped_column(Integer, default=0)
    tokens_salida: Mapped[int] = mapped_column(Integer, default=0)
    costo_usd: Mapped[float] = mapped_column(Numeric(12, 6), default=0)
    fuente_ok: Mapped[bool | None] = mapped_column(Boolean)                 # None = el caso no esperaba un documento
    derivacion_ok: Mapped[bool] = mapped_column(Boolean, default=True)
    puntaje: Mapped[float | None] = mapped_column(Float)                    # 0..1 de la respuesta frente a la esperada; None si no había esperada
    veredicto: Mapped[str] = mapped_column(String(10), default="fallido")   # aprobado | fallido | error
    etiqueta_humana: Mapped[str | None] = mapped_column(String(10))        # correcto | incorrecto: lo marca una persona, para calibrar al juez
    motivo: Mapped[str | None] = mapped_column(Text)


# ---------------------------------------------------------------------------------------------- notificaciones, versiones, calibración
class Notificacion(Base):
    """Aviso dentro de la plataforma (alertas de gasto, regresiones en las pruebas). `clave` evita repetir el mismo aviso."""
    __tablename__ = "notificaciones"
    __table_args__ = (Index("uq_notificaciones_clave", "empresa_id", "clave", unique=True),)
    id: Mapped[uuid.UUID] = _id()
    empresa_id: Mapped[uuid.UUID] = _empresa_fk()
    tipo: Mapped[str] = mapped_column(String(24))        # gasto_80 | gasto_100 | gasto_dia | pruebas_bajaron | pruebas_mejoraron
    titulo: Mapped[str] = mapped_column(String(160))
    mensaje: Mapped[str] = mapped_column(Text)
    vista: Mapped[str | None] = mapped_column(String(20))   # a qué pantalla lleva (finops, testing…)
    ref: Mapped[str | None] = mapped_column(String(60))     # id relacionado (p. ej. la corrida)
    clave: Mapped[str] = mapped_column(String(120))
    creada_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    vista_en: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class DocumentoVersion(Base):
    """Historial de un documento reemplazado: se guarda el archivo anterior para poder volver a él."""
    __tablename__ = "documento_versiones"
    id: Mapped[uuid.UUID] = _id()
    empresa_id: Mapped[uuid.UUID] = _empresa_fk()
    documento_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("documentos.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    nombre: Mapped[str] = mapped_column(String(255))
    tipo: Mapped[str] = mapped_column(String(10))
    tamano_bytes: Mapped[int] = mapped_column(Integer, default=0)
    ruta_local: Mapped[str] = mapped_column(String(500))
    num_fragmentos: Mapped[int] = mapped_column(Integer, default=0)
    subido_en: Mapped[datetime] = mapped_column(DateTime(timezone=True))                       # cuándo se subió esa versión
    reemplazada_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class CalibracionJuez(Base):
    """Mide cuánto coincide cada modelo juez con las etiquetas humanas (correcto/incorrecto) de las respuestas ya evaluadas."""
    __tablename__ = "calibraciones_juez"
    id: Mapped[uuid.UUID] = _id()
    empresa_id: Mapped[uuid.UUID] = _empresa_fk()
    estado: Mapped[str] = mapped_column(String(12), default="ejecutando")    # ejecutando | completada | error
    modelos: Mapped[list] = mapped_column(JSONB, default=list)               # ids de los jueces comparados
    etiquetados: Mapped[int] = mapped_column(Integer, default=0)             # respuestas con etiqueta humana usadas
    total: Mapped[int] = mapped_column(Integer, default=0)                   # evaluaciones a hacer (etiquetados x jueces)
    completados: Mapped[int] = mapped_column(Integer, default=0)
    resumen: Mapped[dict | None] = mapped_column(JSONB)                      # métricas por juez
    error: Mapped[str | None] = mapped_column(Text)
    creada_por: Mapped[str | None] = mapped_column(String(160))
    iniciada_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    terminada_en: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class EventoSeguridad(Base):
    """Intervención de los guardarraíles de la IA (intento de inyección, tema prohibido, fuga bloqueada…). Sin datos personales:
    el detalle se guarda enmascarado y acotado."""
    __tablename__ = "eventos_seguridad"
    id: Mapped[uuid.UUID] = _id()
    empresa_id: Mapped[uuid.UUID] = _empresa_fk()
    conversacion_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("conversaciones.id", ondelete="SET NULL"), index=True)
    tipo: Mapped[str] = mapped_column(String(28))            # inyeccion | tema_prohibido | pii | fuga_salida | salida_saneada | fragmento_sospechoso | limite_conversacion
    severidad: Mapped[str] = mapped_column(String(6), default="media")   # baja | media | alta
    detalle: Mapped[str] = mapped_column(String(300), default="")
    senales: Mapped[list] = mapped_column(JSONB, default=list)
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)



class PerfilCliente(Base):
    """Lo que se sabe de un visitante que vuelve (por el identificador anónimo de su navegador): su nombre de pila y de qué consultó.
    Sin datos personales sensibles (todo va enmascarado) y el cliente puede pedir que se borre."""
    __tablename__ = "perfiles_cliente"
    __table_args__ = (Index("uq_perfiles_cliente", "empresa_id", "visitante_id", unique=True),)
    id: Mapped[uuid.UUID] = _id()
    empresa_id: Mapped[uuid.UUID] = _empresa_fk()
    visitante_id: Mapped[str] = mapped_column(String(64))
    nombre: Mapped[str | None] = mapped_column(String(80))
    temas: Mapped[list] = mapped_column(JSONB, default=list)          # sus últimas consultas, abreviadas y enmascaradas
    conversaciones: Mapped[int] = mapped_column(Integer, default=1)
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    ultima_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class PropuestaFaq(Base):
    """Lo que respondió un agente humano en un ticket, propuesto como FAQ para la base de conocimiento (la persona lo revisa)."""
    __tablename__ = "propuestas_faq"
    id: Mapped[uuid.UUID] = _id()
    empresa_id: Mapped[uuid.UUID] = _empresa_fk()
    ticket_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tickets.id", ondelete="CASCADE"), unique=True)
    pregunta: Mapped[str] = mapped_column(Text)
    respuesta: Mapped[str] = mapped_column(Text)
    estado: Mapped[str] = mapped_column(String(10), default="pendiente")      # pendiente | aceptada | descartada
    documento_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("documentos.id", ondelete="SET NULL"))
    creada_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    resuelta_en: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class CacheRespuesta(Base):
    """Respuestas ya dadas a preguntas independientes: si llega una casi idéntica y nada cambió (documentos y configuración), se reutiliza
    sin llamar al modelo (ahorra costo y latencia). `version` cambia cuando se toca la base de conocimiento o la configuración del agente."""
    __tablename__ = "cache_respuestas"
    id: Mapped[uuid.UUID] = _id()
    empresa_id: Mapped[uuid.UUID] = _empresa_fk()
    modelo: Mapped[str] = mapped_column(String(40))
    version: Mapped[str] = mapped_column(String(80))
    pregunta: Mapped[str] = mapped_column(Text)
    embedding: Mapped[list] = mapped_column(Vector(EMBED_DIM))
    respuesta: Mapped[str] = mapped_column(Text)
    fuentes: Mapped[list | None] = mapped_column(JSONB)
    fuentes_detalle: Mapped[list | None] = mapped_column(JSONB)
    confianza: Mapped[float] = mapped_column(Float, default=0.0)
    aciertos: Mapped[int] = mapped_column(Integer, default=0)
    creada_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
