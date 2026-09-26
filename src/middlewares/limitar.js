// Límite de intentos contra fuerza bruta: las claves pueden ser de solo 4 dígitos.
// Memoria del proceso: suficiente para un solo servidor.
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { CODIGOS_ERROR } from '../../shared/codigos.js';
import { config } from '../config/index.js';

const QUINCE_MINUTOS = 15 * 60 * 1000;
const UNA_HORA = 60 * 60 * 1000;

function responderLimite(mensaje) {
  return (_req, res) => {
    res.status(429).json({ error: { codigo: CODIGOS_ERROR.DEMASIADOS_INTENTOS, mensaje } });
  };
}

/** Login: cuenta solo los intentos FALLIDOS, por teléfono + IP. */
export const limitarLogin = rateLimit({
  windowMs: QUINCE_MINUTOS,
  limit: config.limites.login,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${String(req.body?.telefono ?? '')}`,
  handler: responderLimite('Demasiados intentos fallidos. Espera 15 minutos e intenta de nuevo'),
});

/** Registro: cuentas nuevas por IP. */
export const limitarRegistro = rateLimit({
  windowMs: UNA_HORA,
  limit: config.limites.registro,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  handler: responderLimite('Demasiados registros desde esta red. Intenta más tarde'),
});
