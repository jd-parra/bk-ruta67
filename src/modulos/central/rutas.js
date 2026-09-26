import { Router } from 'express';
import { ROLES } from '../../../shared/codigos.js';
import { autenticar, exigirRol } from '../../middlewares/autenticar.js';
import { validar } from '../../middlewares/validar.js';
import * as esquemas from './esquemas.js';
import { obtenerResumen } from './resumen.js';
import * as tarifas from './tarifas.js';
import * as unidades from './unidades.js';
import * as usuarios from './usuarios.js';

export const rutasCentral = Router();
rutasCentral.use('/central', autenticar(), exigirRol(ROLES.CENTRAL));

const id = validar(esquemas.esquemaId, 'params');
const idDe = (req) => req.validado.params.id;

rutasCentral.get('/central/resumen', validar(esquemas.esquemaDesde, 'query'), async (req, res) => {
  const { desde } = req.validado.query;
  res.json(await obtenerResumen(desde ? new Date(desde) : undefined));
});

// Tabuladores (gaceta)
rutasCentral.get('/central/tabuladores', async (_req, res) => {
  res.json(await tarifas.listarTabuladores());
});
rutasCentral.post('/central/tabuladores', validar(esquemas.esquemaTabulador), async (req, res) => {
  res.status(201).json(await tarifas.crearTabulador(req.body));
});

// Líneas y tramos
rutasCentral.get('/central/lineas', async (_req, res) => {
  res.json(await tarifas.listarLineasCentral());
});
rutasCentral.post('/central/lineas', validar(esquemas.esquemaLinea), async (req, res) => {
  res.status(201).json(await tarifas.crearLinea(req.body));
});
rutasCentral.put(
  '/central/lineas/:id',
  id,
  validar(esquemas.esquemaLineaCambios),
  async (req, res) => {
    res.json(await tarifas.actualizarLinea(idDe(req), req.body));
  },
);

// Categorías y bloqueos
rutasCentral.get('/central/categorias/pendientes', async (_req, res) => {
  res.json(await usuarios.listarCategoriasPendientes());
});
rutasCentral.put(
  '/central/usuarios/:id/categoria',
  id,
  validar(esquemas.esquemaCategoria),
  async (req, res) => {
    res.json(await usuarios.resolverCategoria(idDe(req), req.body.verificada));
  },
);
rutasCentral.get(
  '/central/conflictos',
  validar(esquemas.esquemaConflictos, 'query'),
  async (req, res) => {
    res.json(await usuarios.listarConflictos(req.validado.query.todos === 'true'));
  },
);
rutasCentral.put(
  '/central/usuarios/:id/bloqueo',
  id,
  validar(esquemas.esquemaBloqueo),
  async (req, res) => {
    res.json(await usuarios.cambiarBloqueo(idDe(req), req.body.bloqueado));
  },
);

// Unidades y recolectores
rutasCentral.get('/central/unidades', async (_req, res) => {
  res.json(await unidades.listarUnidades());
});
rutasCentral.post('/central/unidades', validar(esquemas.esquemaUnidad), async (req, res) => {
  res.status(201).json(await unidades.crearUnidad(req.body));
});
rutasCentral.put(
  '/central/unidades/:id',
  id,
  validar(esquemas.esquemaUnidadCambios),
  async (req, res) => {
    res.json(await unidades.actualizarUnidad(idDe(req), req.body));
  },
);
rutasCentral.get('/central/recolectores', async (_req, res) => {
  res.json(await unidades.listarRecolectores());
});
