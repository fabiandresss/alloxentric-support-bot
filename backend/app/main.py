from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import CORS_ORIGINS
from app.routers import auth, empresas, tickets, documentos, chat, publico, metricas
from app.services import embeddings

app = FastAPI(title="Chatbot de Soporte Alloxentric", version="0.2.0")
app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"])
for r in (auth, empresas, tickets, documentos, chat, publico, metricas):
    app.include_router(r.router)


@app.get("/health")
def health():
    # no carga el modelo: informa qué backend de embeddings hay configurado y cuál está activo
    return {"ok": True, "embeddings": embeddings.estado()}
