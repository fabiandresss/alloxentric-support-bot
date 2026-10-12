"""Hash de contraseñas (PBKDF2-SHA256, solo stdlib) y JWT."""
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
import jwt
from app.config import JWT_SECRET, JWT_HORAS

_ITER = 240_000


def hash_password(pw: str) -> str:
    salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), _ITER).hex()
    return f"pbkdf2${_ITER}${salt}${h}"


def verificar_password(pw: str, almacenado: str) -> bool:
    try:
        _, it, salt, h = almacenado.split("$")
        calc = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), int(it)).hex()
        return hmac.compare_digest(calc, h)
    except Exception:
        return False


def crear_token(usuario_id: str, rol: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(hours=JWT_HORAS)
    return jwt.encode({"sub": usuario_id, "rol": rol, "exp": exp}, JWT_SECRET, algorithm="HS256")


def leer_token(token: str) -> dict:
    return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
