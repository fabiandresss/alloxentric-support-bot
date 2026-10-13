"""Batería de calidad del motor RAG: ¿responde cuando debe y deriva cuando no tiene respaldo?

Mide la recuperación con el embedder activo, sin base de datos (fragmenta el corpus como la ingesta, embebe y compara por coseno),
así que corre igual con Docker, sin Docker o en CI. No llama a DeepSeek.

    python calidad_rag/evaluar.py                      # modelo real (sentence-transformers)
    python calidad_rag/evaluar.py --backend hash       # embedder léxico (línea base)
    python calidad_rag/evaluar.py --umbral 0.8 --json  # umbral de la empresa; guarda resultados_<embedder>.json

Entrega: precisión de la fuente, separación entre preguntas con y sin respaldo (AUC), la decisión responder/derivar al umbral
indicado, los errores uno por uno y una recomendación de `sim_min/sim_max` para el embedder (se copian a services/embeddings.py).
"""
import argparse
import json
import os
import statistics
import sys
from pathlib import Path

AQUI = Path(__file__).parent
sys.path.insert(0, str(AQUI.parent))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--backend", choices=["sentence-transformers", "hash"], default=None)
    ap.add_argument("--umbral", type=float, default=0.8, help="umbral_rag de la empresa (confianza mínima para responder)")
    ap.add_argument("--json", action="store_true", help="guardar resultados_<embedder>.json")
    a = ap.parse_args()
    if a.backend:
        os.environ["EMBEDDINGS_BACKEND"] = a.backend
    os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://x:x@127.0.0.1:5432/x")   # no se conecta

    from app.services import embeddings                   # noqa: E402 (después de fijar el entorno)
    from app.services.ingesta import dividir               # noqa: E402
    from app.services.motor_rag import confianza_de        # noqa: E402

    corpus = json.loads((AQUI / "corpus.json").read_text(encoding="utf-8"))["documentos"]
    preg = json.loads((AQUI / "preguntas.json").read_text(encoding="utf-8"))
    emb = embeddings.get_embedder()
    print(f"Embedder: {emb.id}   sim_min={emb.sim_min}  sim_max={emb.sim_max}   umbral={a.umbral}")

    frags = [(d["nombre"], t) for d in corpus for t in dividir(d["texto"])]
    fv = emb.embed([t for _, t in frags])

    def top(q: str):
        qv = emb.embed([q])[0]
        sims = sorted(((sum(x * y for x, y in zip(qv, v)), i) for i, v in enumerate(fv)), reverse=True)
        return sims[0][0], frags[sims[0][1]][0], [frags[i][0] for _, i in sims[:3]]

    con = [(x["q"], x["doc"], *top(x["q"])) for x in preg["con_respaldo"]]
    sin = [(x["q"], x["tipo"], *top(x["q"])) for x in preg["sin_respaldo"]]

    # ---- recuperación
    acc1 = sum(1 for _, doc, s, d1, _ in con if d1 == doc) / len(con)
    hit3 = sum(1 for _, doc, s, d1, top3 in con if doc in top3) / len(con)
    s_con, s_sin = [c[2] for c in con], [c[2] for c in sin]
    auc = sum((x > y) + 0.5 * (x == y) for x in s_con for y in s_sin) / (len(s_con) * len(s_sin))

    def dist(v):
        return f"min {min(v):.2f} · p25 {statistics.quantiles(v, n=4)[0]:.2f} · mediana {statistics.median(v):.2f} · máx {max(v):.2f}"

    print(f"\nFragmentos: {len(frags)} | con respaldo: {len(con)} | sin respaldo: {len(sin)}")
    print(f"Fuente correcta en el top-1: {acc1:.0%}  (en el top-3: {hit3:.0%})")
    print(f"Similitud top-1  CON respaldo: {dist(s_con)}")
    print(f"Similitud top-1  SIN respaldo: {dist(s_sin)}")
    print(f"Separación (AUC): {auc:.3f}   (1.0 = ninguna pregunta sin respaldo supera a una con respaldo)")

    # ---- mejor umbral de similitud (Youden J) y recomendación de rango
    candidatos = sorted(set(s_con + s_sin))
    mejor = max(candidatos, key=lambda t: (sum(x >= t for x in s_con) / len(s_con)) - (sum(y >= t for y in s_sin) / len(s_sin)))
    tpr = sum(x >= mejor for x in s_con) / len(s_con)
    fpr = sum(y >= mejor for y in s_sin) / len(s_sin)
    print(f"Mejor corte de similitud: {mejor:.3f}  → responde bien {tpr:.0%} de las con respaldo, responde mal {fpr:.0%} de las sin respaldo")
    sim_max = max(mejor + 0.05, statistics.quantiles(s_con, n=10)[-1])
    sim_min = (mejor - a.umbral * sim_max) / (1 - a.umbral)
    print(f"Recomendación para {emb.id}: sim_min = {sim_min:.2f}, sim_max = {sim_max:.2f}  "
          f"(para que el umbral {a.umbral} caiga en el corte {mejor:.2f})")

    # ---- decisión con la configuración ACTUAL del embedder
    def decide(s):
        return confianza_de(s, emb) >= a.umbral

    ok_resp = sum(decide(c[2]) and c[3] == c[1] for c in con)
    resp_otra_fuente = sum(decide(c[2]) and c[3] != c[1] for c in con)
    deriv_de_mas = sum(not decide(c[2]) for c in con)
    deriv_ok = sum(not decide(x[2]) for x in sin)
    resp_mal = sum(decide(x[2]) for x in sin)
    print(f"\nDecisión con la configuración actual (umbral {a.umbral}):")
    print(f"  con respaldo → respondió con la fuente correcta: {ok_resp}/{len(con)} · con otra fuente: {resp_otra_fuente} · derivó de más: {deriv_de_mas}")
    print(f"  sin respaldo → derivó (correcto): {deriv_ok}/{len(sin)} · respondió igual (PELIGROSO, alucina): {resp_mal}")
    print(f"  exactitud global: {(ok_resp + deriv_ok) / (len(con) + len(sin)):.0%}")

    print("\nTabla de umbrales (qué pasa si la empresa cambia su umbral_rag):")
    print("  umbral | responde bien (con respaldo) | responde mal (sin respaldo) | deriva de más")
    for u in (0.5, 0.6, 0.7, 0.8, 0.9):
        r_bien = sum(confianza_de(c[2], emb) >= u and c[3] == c[1] for c in con)
        r_mal = sum(confianza_de(x[2], emb) >= u for x in sin)
        print(f"   {u:.1f}   |      {r_bien:2d}/{len(con)} = {r_bien / len(con):4.0%}         |"
              f"      {r_mal:2d}/{len(sin)} = {r_mal / len(sin):4.0%}        |   {len(con) - r_bien:2d}")

    print("\nErrores:")
    for q, doc, s, d1, _ in con:
        if not (decide(s) and d1 == doc):
            print(f"  [derivó de más / fuente errónea] sim {s:.2f} conf {confianza_de(s, emb):.2f} → {d1}  ·  {q}")
    for q, tipo, s, d1, _ in sin:
        if decide(s):
            print(f"  [respondió sin respaldo] sim {s:.2f} conf {confianza_de(s, emb):.2f} → {d1}  ·  ({tipo}) {q}")

    if a.json:
        out = AQUI / f"resultados_{emb.id.replace(':', '_').replace('/', '_')}.json"
        out.write_text(json.dumps({
            "embedder": emb.id, "umbral": a.umbral, "sim_min": emb.sim_min, "sim_max": emb.sim_max,
            "acc_fuente_top1": acc1, "hit_top3": hit3, "auc": auc, "mejor_corte": mejor,
            "recomendacion": {"sim_min": round(sim_min, 2), "sim_max": round(sim_max, 2)},
            "con_respaldo": [{"q": q, "sim": round(s, 4), "doc_esperado": d, "doc_top1": d1} for q, d, s, d1, _ in con],
            "sin_respaldo": [{"q": q, "tipo": t, "sim": round(s, 4), "doc_top1": d1} for q, t, s, d1, _ in sin],
        }, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\nGuardado: {out.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
