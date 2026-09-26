import { Router } from 'express';
import { pool } from '../../bd/pool.js';

export const rutasSalud = Router();

/** Responde si la API está viva y si la base de datos contesta. */
rutasSalud.get('/salud', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, bd: 'ok' });
  } catch (error) {
    res.status(503).json({ ok: false, bd: 'sin conexion', detalle: error.message });
  }
});
