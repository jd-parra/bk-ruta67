import express from 'express';
import pinoHttp from 'pino-http';
import { logger } from './utils/logger.js';
import { manejadorErrores, rutaNoEncontrada } from './middlewares/manejadorErrores.js';
import { rutasSalud } from './modulos/salud/rutas.js';

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
  app.use(express.json({ limit: '1mb' }));

  const api = express.Router();
  api.use(rutasSalud);
  app.use(PREFIJO_API, api);

  app.use(rutaNoEncontrada);
  app.use(manejadorErrores);
  return app;
}
