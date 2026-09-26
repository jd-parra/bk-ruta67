import { Router } from 'express';
import { z } from 'zod';
import { LIMITES, ROLES } from '../../../shared/codigos.js';
import { pool } from '../../bd/pool.js';
import { autenticar, exigirRol } from '../../middlewares/autenticar.js';
import { validar } from '../../middlewares/validar.js';
import { emitirBoletos, listarActivos, revocarPorPerdida } from './servicio.js';

const esquemaEmitir = z.object({
  cantidad: z
    .number()
    .int()
    .min(1)
    .max(LIMITES.MAX_BOLETOS_ACTIVOS)
    .default(LIMITES.MAX_BOLETOS_ACTIVOS),
});

export const rutasBoletos = Router();
const soloPasajero = [autenticar(), exigirRol(ROLES.PASAJERO)];

rutasBoletos.post('/boletos', ...soloPasajero, validar(esquemaEmitir), async (req, res) => {
  res.status(201).json(await emitirBoletos(req.usuario, req.body.cantidad));
});

rutasBoletos.get('/boletos', ...soloPasajero, async (req, res) => {
  res.json(await listarActivos(req.usuario, pool));
});

rutasBoletos.post('/boletos/revocar', ...soloPasajero, async (req, res) => {
  res.json(await revocarPorPerdida(req.usuario));
});
