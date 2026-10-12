"""Carga en la BD las 5 empresas, documentos y tickets del mock del front (seed_data.json).

  python seed.py            # solo si la BD está vacía
  python seed.py --reset    # BORRA todo y vuelve a cargar

seed_data.json se generó desde src/data/mockData.ts del front (ver README).
Las API keys en texto plano se imprimen UNA vez y se guardan en seed_keys.txt (ignorado por git).
Los documentos de ejemplo no tienen archivo ni fragmentos reales: sube un archivo real desde el panel
para probar la ingesta.
"""
import json
import os
import re
import sys
from datetime import timedelta
from pathlib import Path
from sqlalchemy import select, text
from app.db import SessionLocal
from app import models as m
from app.deps import hash_key, nueva_api_key
from app.security import hash_password
from app.utils import ahora, MESES

SUPER_EMAIL = os.getenv("SUPERADMIN_EMAIL", "superadmin@alloxentric.local")
SUPER_PW = os.getenv("SUPERADMIN_PASSWORD", "Superadmin123!")
DEMO_PW = "Demo1234!"   # SOLO desarrollo: clave de los usuarios de ejemplo
ROLES_DEMO = [("admin_empresa", "admin"), ("encargado_tickets", "tickets"), ("encargado_agente", "agente")]

DATA = json.loads((Path(__file__).parent / "seed_data.json").read_text(encoding="utf-8"))
# Los documentos de ejemplo no tienen archivo: se cargan todos como "procesado" (si no, el panel esperaría para siempre)
ESTADO_DOC = {"procesado": "procesado", "procesando": "procesado", "error": "error"}


def minutos_relativos(txt: str) -> int:
    txt = txt.lower()
    if "hora y media" in txt:
        return 90
    n = int(re.search(r"(\d+)", txt).group(1))
    return n * 60 if "hora" in txt else n


def a_bytes(size: str) -> int:
    n, u = size.split()
    return int(float(n) * (1024 * 1024 if u == "MB" else 1024))


def fecha_doc(txt: str):
    mt = re.match(r"(\d{2}) (\w{3}) (\d{4})", txt)
    if mt:
        from datetime import datetime, timezone
        return datetime(int(mt[3]), MESES.index(mt[2]) + 1, int(mt[1]), 12, 0, tzinfo=timezone.utc)
    return ahora() - timedelta(minutes=15 if "min" in txt else 1440)


def main(reset: bool):
    # el esquema lo crea Alembic (alembic upgrade head) antes de correr el seed
    db = SessionLocal()
    if reset:
        db.execute(text("TRUNCATE empresas, usuarios CASCADE"))
        db.commit()
    elif db.scalar(select(m.Empresa).limit(1)):
        print("La BD ya tiene datos. Usa --reset para recargar.")
        return
    if not db.scalar(select(m.Usuario).where(m.Usuario.email == SUPER_EMAIL)):
        db.add(m.Usuario(email=SUPER_EMAIL, nombre="Superadmin", rol="superadmin",
                         password_hash=hash_password(SUPER_PW)))
        db.commit()
    keys, por_slug = {}, {}
    for i, c in enumerate(DATA["companies"]):
        key = nueva_api_key()
        keys[c["slug"]] = key
        e = m.Empresa(
            nombre=c["name"], slug=c["slug"], industria=c["industry"], api_key_hash=hash_key(key),
            url_sitio=c["webChatUrl"], nombre_agente=c["agentName"], estado_agente=c["agentStatus"],
            tono=c["tone"], instrucciones=c["customInstructions"], umbral_rag=c["ragThreshold"],
            version=int(c["version"].lstrip("v").split(".")[0]), iniciales_logo=c["logoInitials"],
            color_marca=c["brandColor"], color_fondo=c["brandBg"],
            creada_en=ahora() - timedelta(minutes=i))  # conserva el orden del mock en el listado
        db.add(e)
        db.flush()
        por_slug[c["slug"]] = e
        for d in c["documents"]:
            db.add(m.Documento(
                empresa_id=e.id, nombre=d["name"], tipo=d["type"], tamano_bytes=a_bytes(d["size"]),
                ruta_local=f"storage/seed/{d['name']}", estado=ESTADO_DOC[d["status"]],
                num_fragmentos=d["chunkCount"], subido_en=fecha_doc(d["uploadedAt"])))
    for t in DATA["tickets"]:
        e = por_slug[t["companyId"]]
        creado = ahora() - timedelta(minutes=minutos_relativos(t["relativeTime"]))
        conv = m.Conversacion(empresa_id=e.id, nombre_cliente=t["customerName"],
                              email_cliente=t["customerEmail"], canal=t["customerChannel"],
                              derivada=True, iniciada_en=creado - timedelta(minutes=10))
        db.add(conv)
        db.flush()
        n = len(t["transcript"])
        for j, msg in enumerate(t["transcript"]):
            db.add(m.Mensaje(
                empresa_id=e.id, conversacion_id=conv.id,
                rol={"user": "usuario", "bot": "bot", "agent": "agente"}[msg["sender"]],
                nombre_remitente=msg["senderName"], contenido=msg["message"],
                es_aviso_derivacion=bool(msg.get("isEscalationNotice")),
                fuentes=msg.get("ragSources"), confianza=msg.get("confidenceScore"),
                creado_en=creado - timedelta(minutes=n - 1 - j)))
        db.add(m.Ticket(
            empresa_id=e.id, conversacion_id=conv.id, numero=t["ticketNumber"], estado=t["status"],
            motivo_derivacion=t["escalationReason"], sugerencia_ia=t["aiSuggestion"],
            agente_asignado=None if t.get("assignedAgent") in (None, "Sin asignar") else t["assignedAgent"],
            creado_en=creado, actualizado_en=creado))
    pw = hash_password(DEMO_PW)
    for slug, e in por_slug.items():   # un usuario por rol y por empresa
        for rol, prefijo in ROLES_DEMO:
            db.add(m.Usuario(empresa_id=e.id, email=f"{prefijo}@{slug}.demo", rol=rol,
                             nombre=f"{prefijo.capitalize()} {e.nombre}", password_hash=pw))
    db.commit()
    Path("seed_keys.txt").write_text("\n".join(f"{k}: {v}" for k, v in keys.items()) + "\n")
    print(f"Cargadas {len(por_slug)} empresas y {len(DATA['tickets'])} tickets.")
    print(f"Superadmin: {SUPER_EMAIL} / {SUPER_PW}   (cámbiala; define SUPERADMIN_PASSWORD en .env)")
    print(f"Usuarios demo por empresa (clave {DEMO_PW}): admin@<slug>.demo, tickets@<slug>.demo, agente@<slug>.demo")
    print("API keys (guardadas en seed_keys.txt):")
    for k, v in keys.items():
        print(f"  {k}: {v}")


if __name__ == "__main__":
    main("--reset" in sys.argv)
