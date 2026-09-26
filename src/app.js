import cors from 'cors';
import express from 'express';
import pinoHttp from 'pino-http';
import { logger } from './utils/logger.js';
import { manejadorErrores, rutaNoEncontrada } from './middlewares/manejadorErrores.js';
import { rutasAuth } from './modulos/auth/rutas.js';
import { rutasBilletera } from './modulos/billetera/rutas.js';
import { rutasBoletos } from './modulos/boletos/rutas.js';
import { rutasCentral } from './modulos/central/rutas.js';
import { rutasLineas } from './modulos/lineas/rutas.js';
import { rutasPublico } from './modulos/publico/rutas.js';
import { rutasRecolector } from './modulos/recolector/rutas.js';
import { rutasSalud } from './modulos/salud/rutas.js';
import { rutasUbicaciones } from './modulos/ubicaciones/rutas.js';

const PREFIJO_API = '/api/v1';

/**
 * Arma la app de Express sin escuchar en ningún puerto (así las pruebas la usan directo).
 * @returns {import('express').Express}
 */
export function crearApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(
    pinoHttp({
      logger,
      quietReqLogger: true,
      serializers: {
        req: (req) => ({ metodo: req.method, url: req.originalUrl }),
        res: (res) => ({ estado: res.statusCode }),
      },
      customSuccessMessage: (req, res, ms) =>
        `${req.method} ${req.originalUrl} → ${res.statusCode} (${ms} ms)`,
      customErrorMessage: (req, res) => `${req.method} ${req.originalUrl} → ${res.statusCode}`,
    }),
  );
  // Fase 1: red local, cualquier origen (el panel web corre en otro puerto). Auth va por Bearer, no cookies.
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  const api = express.Router();
  for (const rutas of [
    rutasSalud,
    rutasAuth,
    rutasPublico,
    rutasBilletera,
    rutasBoletos,
    rutasLineas,
    rutasRecolector,
    rutasUbicaciones,
    rutasCentral,
  ]) {
    api.use(rutas);
  }
  app.use(PREFIJO_API, api);

  app.use(rutaNoEncontrada);
  app.use(manejadorErrores);
  return app;
}
