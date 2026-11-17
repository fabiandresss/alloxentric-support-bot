import os
from pathlib import Path
from zoneinfo import ZoneInfo
from dotenv import load_dotenv

load_dotenv()

STORAGE_DIR = Path(os.getenv("STORAGE_DIR", "./storage")).resolve()
PUBLIC_CHAT_BASE_URL = os.getenv("PUBLIC_CHAT_BASE_URL", "http://localhost:3000/chat")
CORS_ORIGINS = [o.strip() for o in os.getenv(
    "CORS_ORIGINS", "http://localhost:3000,http://localhost:5173").split(",")]
CORESTREAM_MOCK = os.getenv("CORESTREAM_MOCK", "true").lower() == "true"
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "20"))
try:
    TZ = ZoneInfo(os.getenv("APP_TZ", "America/Santiago"))
except Exception:  # sin tzdata
    from datetime import timezone
    TZ = timezone.utc

# Horas que se espera la respuesta a la encuesta de resolución; vencido el plazo el ticket se cierra solo
ENCUESTA_HORAS = int(os.getenv("ENCUESTA_HORAS", "72"))

# Límite de peticiones de los endpoints sin sesión (chat público, widget, login). Ver app/ratelimit.py
RATE_LIMIT_ENABLED = os.getenv("RATE_LIMIT_ENABLED", "true").lower() == "true"
TRUST_PROXY_HEADERS = os.getenv("TRUST_PROXY_HEADERS", "false").lower() == "true"  # solo tras un proxy de confianza

# --- Motor RAG (RF-04, RF-07…RF-10) ---
# sentence-transformers (modelo local multilingüe de 384 dim; descarga ~470 MB la primera vez) | hash (sin modelo, solo pruebas/CI)
EMBEDDINGS_BACKEND = os.getenv("EMBEDDINGS_BACKEND", "sentence-transformers")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "paraphrase-multilingual-MiniLM-L12-v2")
RAG_TOP_K = int(os.getenv("RAG_TOP_K", "4"))
EMBEDDINGS_WARMUP = os.getenv("EMBEDDINGS_WARMUP", "true").lower() == "true"   # precarga el modelo al arrancar
# Dónde se calcula la similitud: pgvector (índice HNSW en la BD; lo normal, requiere pgvector bien compilado, p. ej. la imagen
# pgvector/pgvector de docker-compose) | python (búsqueda exacta en el backend, para BD cuyo pgvector se cae al calcular
# distancias, como el Postgres sin Docker de pixeltable-pgserver en CPUs sin AVX-512). Ver docs/01 §6.3
RAG_SEARCH = os.getenv("RAG_SEARCH", "pgvector")
# AWS Bedrock: único servicio externo. Apagado (por defecto) el motor responde de forma extractiva (con el fragmento más relevante).
# Credenciales: perfil de AWS CLI (AWS_PROFILE) o la cadena por defecto de boto3; no se guardan en .env.
BEDROCK_HABILITADO = os.getenv("BEDROCK_HABILITADO", "false").lower() == "true"
BEDROCK_MODEL_ID = os.getenv("BEDROCK_MODEL_ID", "us.anthropic.claude-haiku-5-5")   # ID o perfil de inferencia disponible en tu región
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
AWS_PROFILE = os.getenv("AWS_PROFILE", "")

# --- Avisos por correo (opcional): sin SMTP_HOST los avisos quedan solo dentro de la plataforma ---
SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("SMTP_FROM", "alloxentric <no-reply@localhost>")
SMTP_STARTTLS = os.getenv("SMTP_STARTTLS", "true").lower() == "true"

# --- Ingesta y tareas periódicas: background (FastAPI BackgroundTasks, por defecto) | celery (necesita Redis y un worker) ---
INGESTA_BACKEND = os.getenv("INGESTA_BACKEND", "background")
CELERY_BROKER_URL = os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")

# --- IA: búsqueda híbrida, OCR, caché de respuestas, modelo de respaldo y rate limit compartido ---
RAG_HIBRIDO = os.getenv("RAG_HIBRIDO", "true").lower() == "true"            # vectores + palabras clave (Postgres FTS) + reordenamiento
OCR_HABILITADO = os.getenv("OCR_HABILITADO", "true").lower() == "true"      # PDFs escaneados: se transcriben con visión de Bedrock (cuesta tokens)
OCR_MAX_PAGINAS = int(os.getenv("OCR_MAX_PAGINAS", "15"))
CACHE_RESPUESTAS = os.getenv("CACHE_RESPUESTAS", "true").lower() == "true"  # respuestas a preguntas casi idénticas sin volver a llamar al modelo
CACHE_SIM_MIN = float(os.getenv("CACHE_SIM_MIN", "0.93"))                  # similitud mínima entre preguntas para reutilizar la respuesta
BEDROCK_RESPALDO = os.getenv("BEDROCK_RESPALDO", "nova-lite")               # id del catálogo que responde si falla el modelo de la empresa ('' = sin respaldo)
RATELIMIT_BACKEND = os.getenv("RATELIMIT_BACKEND", "memory")                # memory | redis (compartido entre procesos; cae a memoria si Redis no responde)
REDIS_URL = os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")

# Registro abierto: cualquiera puede crear una cuenta, registrar su empresa y crear su chatbot (uno por empresa). false = solo el superadmin crea empresas y usuarios.
REGISTRO_ABIERTO = os.getenv("REGISTRO_ABIERTO", "true").lower() == "true"

JWT_SECRET = os.getenv("JWT_SECRET", "cambia-este-secreto-largo-en-el-archivo-env-32+")
JWT_HORAS = int(os.getenv("JWT_HORAS", "8"))

if JWT_SECRET.startswith("cambia-este-secreto"):
    import warnings
    warnings.warn("JWT_SECRET usa el valor por defecto (inseguro): define uno aleatorio en .env antes de salir de tu notebook.",
                  stacklevel=1)
