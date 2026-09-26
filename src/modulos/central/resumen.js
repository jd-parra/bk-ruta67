import { CATEGORIAS } from '../../../shared/codigos.js';
import { pool } from '../../bd/pool.js';
import { inicioDeHoyVenezuela } from '../../utils/fechas.js';

/**
 * Números del día (o desde una fecha) para el panel de la central.
 * @param {Date} [desde] por defecto, inicio de hoy en Venezuela
 */
export async function obtenerResumen(desde = inicioDeHoyVenezuela()) {
  const [totales, porLinea, porCategoria, otros] = await Promise.all([
    pool.query(
      `SELECT count(*)::int AS cobros, coalesce(sum(monto), 0)::bigint AS recaudado,
         count(DISTINCT pasajero_id)::int AS pasajeros
       FROM pasaje.cobros WHERE anulado_en IS NULL AND ocurrido_en >= $1`,
      [desde],
    ),
    pool.query(
      `SELECT l.codigo, l.nombre, count(c.id)::int AS cobros,
         coalesce(sum(c.monto), 0)::bigint AS recaudado
       FROM pasaje.lineas l
       LEFT JOIN pasaje.cobros c
         ON c.linea_codigo = l.codigo AND c.anulado_en IS NULL AND c.ocurrido_en >= $1
       GROUP BY l.codigo, l.nombre ORDER BY l.codigo`,
      [desde],
    ),
    pool.query(
      `SELECT categoria_aplicada AS categoria, count(*)::int AS cobros,
         sum(monto)::bigint AS recaudado
       FROM pasaje.cobros WHERE anulado_en IS NULL AND ocurrido_en >= $1
       GROUP BY categoria_aplicada`,
      [desde],
    ),
    pool.query(
      `SELECT
         (SELECT coalesce(sum(monto), 0)::bigint FROM pasaje.recargas
          WHERE estado = 'confirmada' AND creado_en >= $1) AS recargado,
         (SELECT count(*)::int FROM pasaje.conflictos WHERE resuelto_en IS NULL) AS conflictos,
         (SELECT count(*)::int FROM pasaje.usuarios
          WHERE rol = 'pasajero' AND categoria <> 'general' AND NOT categoria_verificada) AS pendientes,
         (SELECT count(*)::int FROM pasaje.ubicaciones_unidad
          WHERE actualizado_en > now() - interval '5 minutes') AS unidades`,
      [desde],
    ),
  ]);

  const { cobros, recaudado, pasajeros } = totales.rows[0];
  const extra = otros.rows[0];
  return {
    desde: desde.toISOString(),
    cobros,
    recaudado,
    pasajeros,
    recargado: extra.recargado,
    porLinea: porLinea.rows.map((r) => ({
      lineaCodigo: r.codigo,
      lineaNombre: r.nombre,
      cobros: r.cobros,
      recaudado: r.recaudado,
    })),
    porCategoria: resumirCategorias(porCategoria.rows),
    conflictosAbiertos: extra.conflictos,
    categoriasPendientes: extra.pendientes,
    unidadesEnLinea: extra.unidades,
  };
}

function resumirCategorias(filas) {
  const resumen = {};
  for (const categoria of Object.values(CATEGORIAS)) {
    const fila = filas.find((f) => f.categoria === categoria);
    resumen[categoria] = { cobros: fila?.cobros ?? 0, recaudado: fila?.recaudado ?? 0 };
  }
  return resumen;
}
