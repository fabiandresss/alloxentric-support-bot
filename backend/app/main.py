import threading
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import CORS_ORIGINS, EMBEDDINGS_WARMUP
from app.routers import auth, empresas, tickets, documentos, chat, publico, metricas
from app.services import embeddings

@asynccontextmanager
async def lifespan(_: FastAPI):
    # precarga el modelo de embeddings en segundo plano: así la primera consulta o subida no espera varios segundos
    if EMBEDDINGS_WARMUP:
        threading.Thread(target=embeddings.get_embedder, name="warmup-embeddings", daemon=True).start()
    yield


app = FastAPI(title="Chatbot de Soporte Alloxentric", version="0.2.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"])
for r in (auth, empresas, tickets, documentos, chat, publico, metricas):
    app.include_router(r.router)


@app.get("/health")
def health():
    # no carga el modelo: informa qué backend de embeddings hay configurado y cuál está activo
    return {"ok": True, "embeddings": embeddings.estado()}
