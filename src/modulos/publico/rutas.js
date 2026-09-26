import { Router } from 'express';
import { vigenteYProximo } from '../tabuladores/servicio.js';

export const rutasPublico = Router();

/** Sin auth: tabulador vigente y el próximo, si ya se cargó (§6.6). */
rutasPublico.get('/publico/tarifas', async (_req, res) => {
  const { tabulador, proximo } = await vigenteYProximo();
  res.json({ tabulador, proximo });
});
