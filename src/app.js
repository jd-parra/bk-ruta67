import express from 'express';
import pinoHttp from 'pino-http';
import { logger } from './utils/logger.js';
import { manejadorErrores, rutaNoEncontrada } from './middlewares/manejadorErrores.js';

const PREFIJO_API = '/api/v1';

/**
 * Arma la app de Express sin escuchar en ningún puerto (así las pruebas la usan directo).
 * @returns {import('express').Express}
 */
export function crearApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(pinoHttp({ logger }));
  app.use(express.json({ limit: '1mb' }));

  const api = express.Router();
  api.get('/salud', (_req, res) => res.json({ ok: true }));
  app.use(PREFIJO_API, api);

  app.use(rutaNoEncontrada);
  app.use(manejadorErrores);
  return app;
}
