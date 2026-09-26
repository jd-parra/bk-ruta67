import { Router } from 'express';
import { z } from 'zod';
import { LIMITES, ROLES } from '../../../shared/codigos.js';
import { autenticar, exigirRol } from '../../middlewares/autenticar.js';
import { validar } from '../../middlewares/validar.js';
import { anularCobro, sincronizarCobros } from '../sincronizacion/servicio.js';
import { armarPaquete, cobrosDelRecolector } from './servicio.js';

const MAX_COBROS_POR_SYNC = 500;

const esquemaCobroLocal = z.object({
  raw: z.string().min(1).max(400),
  tramoCodigo: z.number().int().min(LIMITES.CODIGO_MIN).max(LIMITES.CODIGO_MAX),
  monto: z.number().int().min(0),
  metodo: z.enum(['nfc', 'qr']),
  ocurridoEn: z.iso.datetime({ offset: true, error: 'ocurridoEn debe ser una fecha ISO 8601' }),
});

const esquemaSync = z.object({
  cobros: z.array(esquemaCobroLocal).min(1).max(MAX_COBROS_POR_SYNC),
});

const esquemaDesde = z.object({ desde: z.iso.datetime({ offset: true }).optional() });
const esquemaBid = z.object({ bid: z.uuid('bid inválido') });

export const rutasRecolector = Router();
const soloRecolector = [autenticar(), exigirRol(ROLES.RECOLECTOR)];

rutasRecolector.get('/recolector/paquete', ...soloRecolector, async (req, res) => {
  res.json(await armarPaquete(req.usuario));
});

rutasRecolector.get(
  '/recolector/cobros',
  ...soloRecolector,
  validar(esquemaDesde, 'query'),
  async (req, res) => {
    const { desde } = req.validado.query;
    res.json(await cobrosDelRecolector(req.usuario, desde ? new Date(desde) : undefined));
  },
);

rutasRecolector.post('/sync/cobros', ...soloRecolector, validar(esquemaSync), async (req, res) => {
  res.json(await sincronizarCobros(req.usuario, req.body.cobros));
});

rutasRecolector.delete(
  '/sync/cobros/:bid',
  ...soloRecolector,
  validar(esquemaBid, 'params'),
  async (req, res) => {
    await anularCobro(req.usuario, req.validado.params.bid);
    res.status(204).end();
  },
);
