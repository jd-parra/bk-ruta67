import { Router } from 'express';
import { z } from 'zod';
import { ROLES } from '../../../shared/codigos.js';
import { autenticar, exigirRol } from '../../middlewares/autenticar.js';
import { validar } from '../../middlewares/validar.js';
import { recargar } from '../recargas/servicio.js';
import { listarMovimientos, obtenerBilletera } from './servicio.js';

const MAX_RECARGA = 10_000_000; // 100.000,00 Bs
const LIMITE_MOVIMIENTOS = { defecto: 20, maximo: 100 };

const esquemaRecarga = z.object({
  monto: z
    .number({ error: 'El monto es obligatorio' })
    .int('El monto va en céntimos, sin decimales')
    .positive('El monto debe ser mayor a 0')
    .max(MAX_RECARGA, 'El monto máximo por recarga es 100.000,00 Bs'),
  // Fase 1: solo simulada. El pago móvil llega con la pasarela del banco.
  metodo: z.literal('simulada', { error: 'Por ahora solo se permiten recargas simuladas' }),
});

const esquemaMovimientos = z.object({
  limite: z.coerce
    .number()
    .int()
    .min(1)
    .max(LIMITE_MOVIMIENTOS.maximo)
    .default(LIMITE_MOVIMIENTOS.defecto),
});

export const rutasBilletera = Router();
const soloPasajero = [autenticar(), exigirRol(ROLES.PASAJERO)];

rutasBilletera.get('/billetera', ...soloPasajero, async (req, res) => {
  res.json(await obtenerBilletera(req.usuario));
});

rutasBilletera.post('/recargas', ...soloPasajero, validar(esquemaRecarga), async (req, res) => {
  res.status(201).json(await recargar(req.usuario, req.body));
});

rutasBilletera.get(
  '/movimientos',
  ...soloPasajero,
  validar(esquemaMovimientos, 'query'),
  async (req, res) => {
    res.json(await listarMovimientos(req.usuario.id, req.validado.query.limite));
  },
);
