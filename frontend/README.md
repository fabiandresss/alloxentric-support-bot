# Alloxentric SupportHub — frontend

Prototipo generado en Google AI Studio, conectado al backend FastAPI (`../backend`).

```bash
cp .env.example .env     # VITE_API_URL=http://localhost:8000
npm install
npm run dev              # http://localhost:3000
```

Toda la comunicación con el backend está en `src/api/client.ts`. Los tipos de `src/types/index.ts`
coinciden con las respuestas de la API (ver `../docs/MAPEO_FRONTEND.md`).
