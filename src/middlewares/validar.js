import { CODIGOS_ERROR } from '../../shared/codigos.js';
import { ErrorApp } from '../utils/ErrorApp.js';

/**
 * Valida `req[fuente]` con un esquema zod y lo reemplaza por el resultado limpio.
 * Si falla → 400 VALIDACION con los detalles en `detalle`.
 * @param {import('zod').ZodType} esquema
 * @param {'body' | 'query' | 'params'} [fuente]
 */
export function validar(esquema, fuente = 'body') {
  return (req, _res, next) => {
    const resultado = esquema.safeParse(req[fuente] ?? {});
    if (!resultado.success) {
      next(
        new ErrorApp(CODIGOS_ERROR.VALIDACION, mensajeDe(resultado.error), {
          detalle: resultado.error.issues.map(({ path, message }) => ({
            campo: path.join('.'),
            mensaje: message,
          })),
        }),
      );
      return;
    }
    // En Express 5 req.query es de solo lectura: guardamos el resultado aparte.
    req.validado = { ...req.validado, [fuente]: resultado.data };
    if (fuente === 'body') req.body = resultado.data;
    next();
  };
}

function mensajeDe(error) {
  const [primero] = error.issues;
  return primero?.message ?? 'Datos inválidos';
}
