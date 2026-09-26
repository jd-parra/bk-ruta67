import { Router } from 'express';
import { z } from 'zod';
import { LIMITES, ROLES } from '../../../shared/codigos.js';
import { autenticar, exigirRol } from '../../middlewares/autenticar.js';
import { validar } from '../../middlewares/validar.js';
import { frecuentesDe, sincronizarRecibos } from './recibos.js';

const MAX_RECIBOS_POR_SYNC = 500;
const codigoCorto = z.number().int().min(LIMITES.CODIGO_MIN).max(LIMITES.CODIGO_MAX);

const esquemaReciboLocal = z.object({
  bid: z.uuid('bid inválido'),
  lineaCodigo: codigoCorto,
  unidadCodigo: codigoCorto,
  tramoCodigo: codigoCorto,
  monto: z.number().int().min(0),
  ocurridoEn: z.iso.datetime({ offset: true, error: 'ocurridoEn debe ser una fecha ISO 8601' }),
});

const esquemaSyncRecibos = z.object({
  recibos: z.array(esquemaReciboLocal).min(1).max(MAX_RECIBOS_POR_SYNC),
});

export const rutasSincronizacionPasajero = Router();
const soloPasajero = [autenticar(), exigirRol(ROLES.PASAJERO)];

rutasSincronizacionPasajero.post(
  '/sync/recibos',
  ...soloPasajero,
  validar(esquemaSyncRecibos),
  async (req, res) => {
    res.json(await sincronizarRecibos(req.usuario, req.body.recibos));
  },
);

rutasSincronizacionPasajero.get('/me/frecuentes', ...soloPasajero, async (req, res) => {
  res.json(await frecuentesDe(req.usuario.id));
});
