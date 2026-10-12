"""Crea (o actualiza la clave de) un superadmin. Uso:
    python crear_superadmin.py correo@dominio.cl            # pide la clave por pantalla
    SUPERADMIN_PASSWORD=... python crear_superadmin.py correo@dominio.cl
"""
import getpass
import os
import sys
from sqlalchemy import select
from app.db import SessionLocal
from app import models as m
from app.security import hash_password


def main(email: str, password: str):
    if len(password) < 8:
        sys.exit("La clave debe tener al menos 8 caracteres.")
    with SessionLocal() as db:
        u = db.scalar(select(m.Usuario).where(m.Usuario.email == email.lower()))
        if u and u.rol != "superadmin":
            sys.exit("Ese correo ya existe con otro rol.")
        if not u:
            u = m.Usuario(email=email.lower(), nombre="Superadmin", rol="superadmin", password_hash="")
            db.add(u)
        u.password_hash = hash_password(password)
        db.commit()
    print(f"Superadmin listo: {email}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1], os.getenv("SUPERADMIN_PASSWORD") or getpass.getpass("Clave: "))
