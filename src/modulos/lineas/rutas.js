import { Router } from 'express';
import { autenticar } from '../../middlewares/autenticar.js';
import { listarLineas } from './servicio.js';

export const rutasLineas = Router();

rutasLineas.get('/lineas', autenticar(), async (_req, res) => {
  res.json(await listarLineas());
});
