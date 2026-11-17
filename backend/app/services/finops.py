"""FinOps: registro del consumo de IA por empresa, plan de gasto (límite mensual o sin límite) y resumen para el panel.

Reglas del plan (el tope diario es opcional y se suma al mensual: al alcanzar cualquiera de los dos el agente deja de usar IA):
  - `sin_limite`: no se corta nada; se cobra lo consumido en el mes.
  - `limitado`: hay un tope mensual en USD. Al alcanzarlo el agente deja de llamar al modelo y responde en modo extractivo
    (con el fragmento más relevante de la documentación); el chat NO se cae. El mes siguiente se reinicia solo.
El plan y el límite siempre se miden sobre el MES EN CURSO (el ciclo de cobro), sin importar el rango que el panel esté filtrando.
El cobro automático al medio de pago del cliente NO está implementado: aquí solo se mide y se limita.

REGLA MULTI-TENANT: toda consulta filtra por empresa_id.
"""
import calendar
from datetime import date, datetime, time, timedelta, timezone
from sqlalchemy import select, func, cast, Date
from sqlalchemy.orm import Session
from app import models as m
from app.config import TZ
from app.services import modelos, llm, notificaciones

PLANES = ("limitado", "sin_limite")
ALERTA_PCT = 80.0        # a partir de este porcentaje del límite el panel avisa
MAX_DIAS_RANGO = 366     # un año como máximo por consulta
AGRUPACIONES = ("dia", "semana", "mes")


def _utc(d: date) -> datetime:
    """Inicio del día `d` en la zona horaria local, como instante UTC."""
    return datetime.combine(d, time.min, tzinfo=TZ).astimezone(timezone.utc)


def aplicar_plan(empresa: m.Empresa, mode: str, mensual: float | None, diario: float | None) -> None:
    """Fija el plan de gasto de la empresa: «sin_limite» o «limitado» (con tope mensual y, opcional, diario). Lanza ValueError."""
    if mode == "limitado":
        if mensual is None:
            raise ValueError("El plan limitado necesita un monto mensual (monthlyLimitUsd)")
        if diario is not None and diario > mensual:
            raise ValueError("El límite diario no puede superar al mensual")
    empresa.plan_gasto = mode
    empresa.limite_mensual_usd = mensual if mode == "limitado" else None
    empresa.limite_diario_usd = diario if mode == "limitado" else None


def rango_mes(mes: str | None) -> tuple[datetime, datetime, str]:
    """('2026-11' | None=mes actual) -> (inicio, fin exclusivo, 'AAAA-MM') en la zona horaria local, como instantes UTC."""
    hoy = datetime.now(TZ)
    try:
        a, mm = (int(x) for x in mes.split("-")) if mes else (hoy.year, hoy.month)
        ini = datetime(a, mm, 1, tzinfo=TZ)
    except (ValueError, AttributeError):
        raise ValueError("Mes inválido: usa el formato AAAA-MM")
    fin = datetime(a + (mm == 12), mm % 12 + 1, 1, tzinfo=TZ)
    return ini.astimezone(timezone.utc), fin.astimezone(timezone.utc), f"{a:04d}-{mm:02d}"


def gasto_mes(db: Session, empresa_id, mes: str | None = None) -> float:
    ini, fin, _ = rango_mes(mes)
    v = db.scalar(select(func.coalesce(func.sum(m.UsoIA.costo_usd), 0)).where(
        m.UsoIA.empresa_id == empresa_id, m.UsoIA.creado_en >= ini, m.UsoIA.creado_en < fin))
    return float(v or 0)


def gasto_dia(db: Session, empresa_id) -> float:
    """Gasto del día de hoy (en la zona horaria local)."""
    hoy = datetime.now(TZ).date()
    v = db.scalar(select(func.coalesce(func.sum(m.UsoIA.costo_usd), 0)).where(
        m.UsoIA.empresa_id == empresa_id, m.UsoIA.creado_en >= _utc(hoy), m.UsoIA.creado_en < _utc(hoy + timedelta(days=1))))
    return float(v or 0)


def motivo_limite(db: Session, empresa: m.Empresa) -> str | None:
    """'mes' o 'dia' si el plan limitado ya alcanzó su tope mensual o diario; None si puede seguir usando la IA."""
    if empresa.plan_gasto != "limitado":
        return None
    if empresa.limite_mensual_usd is not None and gasto_mes(db, empresa.id) >= float(empresa.limite_mensual_usd):
        return "mes"
    if empresa.limite_diario_usd is not None and gasto_dia(db, empresa.id) >= float(empresa.limite_diario_usd):
        return "dia"
    return None


def limite_alcanzado(db: Session, empresa: m.Empresa) -> bool:
    """True si el plan limitado ya llegó a su tope mensual o diario. Se consulta antes de cada llamada al modelo."""
    return motivo_limite(db, empresa) is not None


def _alertar(db: Session, empresa: m.Empresa) -> None:
    """Crea los avisos al llegar al 80 % y al 100 % del límite mensual, y al llegar al tope diario (una vez por mes / por día)."""
    if empresa.plan_gasto != "limitado":
        return
    hoy = datetime.now(TZ)
    if empresa.limite_mensual_usd:
        limite = float(empresa.limite_mensual_usd)
        gasto = gasto_mes(db, empresa.id)
        pct = gasto / limite * 100
        mes = hoy.strftime("%Y-%m")
        if pct >= 100:
            notificaciones.notificar(db, empresa.id, "gasto_100", "Límite mensual de IA alcanzado",
                                     f"Se gastó el 100 % del límite de {limite:,.2f} USD de {mes}. El agente responde sin IA (modo extractivo) hasta el próximo mes o hasta que se suba el límite.",
                                     "finops", clave=f"gasto-{mes}-100", correo=True)
        elif pct >= ALERTA_PCT:
            notificaciones.notificar(db, empresa.id, "gasto_80", "Vas en el 80 % del límite de IA",
                                     f"Llevas {gasto:,.2f} de {limite:,.2f} USD este mes ({pct:.0f} %). Al llegar al 100 % el agente responderá sin IA.",
                                     "finops", clave=f"gasto-{mes}-80", correo=True)
    if empresa.limite_diario_usd and gasto_dia(db, empresa.id) >= float(empresa.limite_diario_usd):
        notificaciones.notificar(db, empresa.id, "gasto_dia", "Límite diario de IA alcanzado",
                                 f"Se alcanzó el tope de {float(empresa.limite_diario_usd):,.2f} USD de hoy. El agente responde sin IA hasta mañana.",
                                 "finops", clave=f"gasto-dia-{hoy.date().isoformat()}", correo=True)


def registrar(db: Session, empresa: m.Empresa, conv: m.Conversacion | None, usos: list[llm.Uso]) -> None:
    """Guarda una fila por llamada hecha al modelo. No hace commit (lo hace quien llama junto con el resto)."""
    for u in usos:
        mod = modelos.obtener(u.modelo or empresa.modelo_ia)
        db.add(m.UsoIA(empresa_id=empresa.id, conversacion_id=conv.id if conv else None, modelo=mod.id, tipo=u.tipo,
                       tokens_entrada=u.entrada, tokens_salida=u.salida,
                       costo_usd=round(modelos.costo_usd(mod, u.entrada, u.salida), 6),
                       latencia_ms=u.latencia_ms, exito=u.exito, error=u.error, respaldo=u.respaldo))
    if usos:
        db.flush()
        _alertar(db, empresa)


def _nombre_modelo(modelo_id: str) -> tuple[str, str, str]:
    mod = next((x for x in modelos.CATALOGO if x.id == modelo_id), None)
    return (mod.nombre, mod.proveedor, mod.proveedor_id) if mod else (modelo_id, "Otro", "")


def _cubo(d: date, agrupar: str, desde: date, hasta: date) -> tuple[date, date]:
    """Inicio y fin del tramo (día, semana lunes-domingo o mes) al que pertenece `d`, recortado al rango consultado."""
    if agrupar == "semana":
        a = d - timedelta(days=d.weekday())
        b = a + timedelta(days=6)
    elif agrupar == "mes":
        a = d.replace(day=1)
        b = d.replace(day=calendar.monthrange(d.year, d.month)[1])
    else:
        a = b = d
    return max(a, desde), min(b, hasta)


def resumen(db: Session, empresa: m.Empresa, desde: date | None = None, hasta: date | None = None,
            modelo: str | None = None, agrupar: str = "dia") -> dict:
    """Consumo del rango [desde, hasta] (por defecto el mes en curso hasta hoy), opcionalmente de un solo modelo, agrupado por
    día, semana o mes. `billing` es siempre el mes en curso completo y todos los modelos (es lo que mide el límite del plan)."""
    hoy = datetime.now(TZ).date()
    if (desde is None) != (hasta is None):
        raise ValueError("Indica desde y hasta juntos")
    desde, hasta = (desde, hasta) if desde else (hoy.replace(day=1), hoy)
    if desde > hasta:
        raise ValueError("La fecha inicial no puede ser posterior a la final")
    if (hasta - desde).days >= MAX_DIAS_RANGO:
        raise ValueError(f"El rango máximo es de {MAX_DIAS_RANGO} días")
    if agrupar not in AGRUPACIONES:
        raise ValueError("Agrupación inválida")
    if modelo is not None and not modelos.existe(modelo):
        raise ValueError("Modelo desconocido")

    ini, fin = _utc(desde), _utc(hasta + timedelta(days=1))
    U = m.UsoIA
    periodo = (U.empresa_id == empresa.id, U.creado_en >= ini, U.creado_en < fin)
    donde = periodo + ((U.modelo == modelo,) if modelo else ())
    tz = getattr(TZ, "key", "UTC")

    t = db.execute(select(func.count(), func.coalesce(func.sum(U.tokens_entrada), 0), func.coalesce(func.sum(U.tokens_salida), 0),
                          func.coalesce(func.sum(U.costo_usd), 0), func.count(func.distinct(U.conversacion_id))).where(*donde)).one()
    llamadas, t_in, t_out, gasto, convs = int(t[0]), int(t[1]), int(t[2]), float(t[3]), int(t[4])

    # la tabla por modelo ignora el filtro de modelo (así se pueden comparar) pero respeta el período
    por_modelo = []
    for mid, n, ti, to, c in db.execute(select(U.modelo, func.count(), func.sum(U.tokens_entrada), func.sum(U.tokens_salida),
                                               func.sum(U.costo_usd)).where(*periodo).group_by(U.modelo).order_by(func.sum(U.costo_usd).desc())):
        nombre, prov, prov_id = _nombre_modelo(mid)
        por_modelo.append(dict(model_id=mid, name=nombre, provider=prov, provider_id=prov_id, calls=int(n),
                               input_tokens=int(ti or 0), output_tokens=int(to or 0), cost_usd=round(float(c or 0), 6)))

    dia = cast(func.timezone(tz, U.creado_en), Date)
    por_dia = {d: (int(n), int(ti or 0), int(to or 0), float(c or 0)) for d, n, ti, to, c in db.execute(
        select(dia, func.count(), func.sum(U.tokens_entrada), func.sum(U.tokens_salida), func.sum(U.costo_usd)).where(*donde).group_by(dia))}
    cubos: dict[tuple[date, date], list] = {}
    d = desde
    while d <= hasta:   # todos los tramos del rango (los sin consumo en cero) para que el gráfico no tenga huecos
        acc = cubos.setdefault(_cubo(d, agrupar, desde, hasta), [0, 0, 0, 0.0])
        n, ti, to, c = por_dia.get(d, (0, 0, 0, 0.0))
        acc[0] += n; acc[1] += ti; acc[2] += to; acc[3] += c
        d += timedelta(days=1)
    serie = [dict(date=a.isoformat(), end_date=b.isoformat(), calls=v[0], input_tokens=v[1], output_tokens=v[2], cost_usd=round(v[3], 6))
             for (a, b), v in cubos.items()]

    # ciclo de cobro: SIEMPRE el mes en curso completo y todos los modelos
    mes = hoy.strftime("%Y-%m")
    gasto_ciclo = gasto_mes(db, empresa.id)
    limite = float(empresa.limite_mensual_usd) if empresa.plan_gasto == "limitado" and empresa.limite_mensual_usd is not None else None
    usado = round(gasto_ciclo / limite * 100, 1) if limite else None
    dias_mes = calendar.monthrange(hoy.year, hoy.month)[1]
    limite_dia = float(empresa.limite_diario_usd) if empresa.plan_gasto == "limitado" and empresa.limite_diario_usd is not None else None
    gasto_hoy = gasto_dia(db, empresa.id)
    proyeccion = None
    if gasto_ciclo > 0:
        ini_mes = datetime(hoy.year, hoy.month, 1, tzinfo=TZ)
        trans = (datetime.now(TZ) - ini_mes).total_seconds() / 86400
        proyeccion = round(gasto_ciclo / max(trans, 0.5) * dias_mes, 2)

    return dict(
        range_from=desde.isoformat(), range_to=hasta.isoformat(), group_by=agrupar, model=modelo,
        plan=dict(mode=empresa.plan_gasto, monthly_limit_usd=limite, daily_limit_usd=limite_dia),
        billing=dict(month=mes, spent_usd=round(gasto_ciclo, 6), used_pct=usado,
                     limit_reached=bool(limite is not None and gasto_ciclo >= limite),
                     near_limit=bool(usado is not None and ALERTA_PCT <= usado < 100), projected_usd=proyeccion,
                     daily_spent_usd=round(gasto_hoy, 6), daily_used_pct=round(gasto_hoy / limite_dia * 100, 1) if limite_dia else None,
                     daily_limit_reached=bool(limite_dia is not None and gasto_hoy >= limite_dia)),
        spent_usd=round(gasto, 6), calls=llamadas, input_tokens=t_in, output_tokens=t_out, conversations=convs,
        avg_cost_per_conversation_usd=round(gasto / convs, 6) if convs else None,
        by_model=por_modelo, series=serie)
