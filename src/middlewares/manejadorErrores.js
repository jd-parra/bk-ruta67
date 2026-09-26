import { CODIGOS_ERROR } from '../../shared/codigos.js';
import { ErrorApp } from '../utils/ErrorApp.js';
import { logger } from '../utils/logger.js';

/** Responde 404 con el formato de error del contrato. */
export function rutaNoEncontrada(req, _res, next) {
  next(new ErrorApp(CODIGOS_ERROR.NO_ENCONTRADO, `No existe ${req.method} ${req.path}`));
}

/**
 * Único lugar que arma `{ error: { codigo, mensaje, detalle? } }`.
 * Los errores no controlados se loguean completos y salen como ERROR_INTERNO.
 */
export function manejadorErrores(error, req, res, _next) {
  if (error instanceof ErrorApp) {
    res.status(error.estado).json({ error: cuerpoError(error) });
    return;
  }

  if (error.type === 'entity.parse.failed') {
    res.status(400).json({
      error: { codigo: CODIGOS_ERROR.VALIDACION, mensaje: 'El cuerpo no es un JSON válido' },
    });
    return;
  }

  logger.error({ err: error, ruta: `${req.method} ${req.originalUrl}` }, 'error no controlado');
  res.status(500).json({
    error: { codigo: CODIGOS_ERROR.ERROR_INTERNO, mensaje: 'Ocurrió un error, intenta de nuevo' },
  });
}

function cuerpoError({ codigo, message, detalle }) {
  return detalle === undefined
    ? { codigo, mensaje: message }
    : { codigo, mensaje: message, detalle };
}
