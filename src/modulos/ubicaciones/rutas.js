import { Router } from 'express';
import { z } from 'zod';
import { ROLES } from '../../../shared/codigos.js';
import { pool } from '../../bd/pool.js';
import { autenticar, exigirRol } from '../../middlewares/autenticar.js';
import { validar } from '../../middlewares/validar.js';
import { EVENTOS } from '../../tiempoReal/eventos.js';
import { emitirATodos } from '../../tiempoReal/emisor.js';
import { unidadDelRecolector } from '../recolector/servicio.js';

const MINUTOS_MAPA = 5;

const esquemaUbicacion = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const rutasUbicaciones = Router();

/** El recolector en turno manda su ubicación cada 30 s (§6.3). Se guarda solo la última. */
rutasUbicaciones.post(
  '/ubicaciones',
  autenticar(),
  exigirRol(ROLES.RECOLECTOR),
  validar(esquemaUbicacion),
  async (req, res) => {
    const unidad = await unidadDelRecolector(req.usuario.id);
    const { lat, lng } = req.body;
    await pool.query(
      `INSERT INTO pasaje.ubicaciones_unidad (unidad_id, lat, lng, actualizado_en)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (unidad_id) DO UPDATE SET lat = $2, lng = $3, actualizado_en = now()`,
      [unidad.id, lat, lng],
    );
    emitirATodos(EVENTOS.UNIDAD_UBICACION, { unidadCodigo: unidad.codigo, lat, lng });
    res.status(204).end();
  },
);

/** Unidades con ubicación de los últimos 5 minutos (§6.6). */
rutasUbicaciones.get('/mapa/unidades', autenticar(), async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT un.codigo, un.placa, l.nombre AS linea_nombre, ub.lat, ub.lng, ub.actualizado_en
     FROM pasaje.ubicaciones_unidad ub
     JOIN pasaje.unidades un ON un.id = ub.unidad_id
     JOIN pasaje.lineas l ON l.id = un.linea_id
     WHERE ub.actualizado_en > now() - interval '${MINUTOS_MAPA} minutes'
     ORDER BY un.codigo`,
  );
  res.json(
    rows.map((r) => ({
      unidadCodigo: r.codigo,
      placa: r.placa,
      lineaNombre: r.linea_nombre,
      lat: r.lat,
      lng: r.lng,
      actualizadoEn: r.actualizado_en.toISOString(),
    })),
  );
});
