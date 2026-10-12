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

JWT_SECRET = os.getenv("JWT_SECRET", "cambia-este-secreto-largo-en-el-archivo-env-32+")
JWT_HORAS = int(os.getenv("JWT_HORAS", "8"))
