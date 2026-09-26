# Pasaje — backend

Backend del MVP Pasaje (Mérida). Qué expone la API: [`CONTRATO.md`](CONTRATO.md). Cómo se escribe: [`CONVENCIONES.md`](CONVENCIONES.md). Plan: [`docs/PLAN_FASE1.md`](docs/PLAN_FASE1.md).

## Arrancar

```bash
cp .env.example .env
npm install
npm run bd:levantar     # Postgres local en el puerto 5433
npm run dev             # http://localhost:3000/api/v1/salud
npm test
```

Para usar Supabase, pon en `.env` la URL del **Session pooler** en `DATABASE_URL` y `PGSSL=true`.
