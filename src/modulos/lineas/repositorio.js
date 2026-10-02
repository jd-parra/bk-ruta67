const DIAS_FRECUENCIA = 30;

// Líneas con sus tramos y la frecuencia de cada tramo (cobros vigentes de los últimos 30 días).
const CONSULTA_LINEAS = `
  SELECT l.id, l.codigo, l.nombre, l.tipo,
    coalesce(
      json_agg(
        json_build_object(
          'id', t.id, 'codigo', t.codigo, 'nombre', t.nombre, 'km', t.km,
          'tarifaManual', t.tarifa_manual, 'trazo', t.trazo, 'frecuencia', coalesce(f.veces, 0)
        ) ORDER BY t.codigo
      ) FILTER (WHERE t.id IS NOT NULL),
      '[]'
    ) AS tramos
  FROM pasaje.lineas l
  LEFT JOIN pasaje.tramos t ON t.linea_id = l.id
  LEFT JOIN (
    SELECT tramo_id, count(*)::int AS veces FROM pasaje.cobros
    WHERE anulado_en IS NULL AND ocurrido_en > now() - interval '${DIAS_FRECUENCIA} days'
    GROUP BY tramo_id
  ) f ON f.tramo_id = t.id
`;

/** Todas las líneas con tramos, ordenadas por código. */
export async function listarConTramos(bd) {
  const { rows } = await bd.query(`${CONSULTA_LINEAS} GROUP BY l.id ORDER BY l.codigo`);
  return rows;
}

/** Una línea con tramos, o null. */
export async function buscarConTramos(bd, lineaId) {
  const { rows } = await bd.query(`${CONSULTA_LINEAS} WHERE l.id = $1 GROUP BY l.id`, [lineaId]);
  return rows[0] ?? null;
}

export async function buscarPorCodigo(bd, codigo) {
  const { rows } = await bd.query(
    'SELECT id, codigo, nombre, tipo FROM pasaje.lineas WHERE codigo = $1',
    [codigo],
  );
  return rows[0] ?? null;
}

/** Tramo por código dentro de una línea, o null. */
export async function buscarTramo(bd, lineaId, codigoTramo) {
  const { rows } = await bd.query(
    `SELECT id, linea_id, codigo, nombre, km, tarifa_manual
     FROM pasaje.tramos WHERE linea_id = $1 AND codigo = $2`,
    [lineaId, codigoTramo],
  );
  return rows[0] ?? null;
}

export async function crearLinea(bd, { codigo, nombre, tipo }) {
  const { rows } = await bd.query(
    'INSERT INTO pasaje.lineas (codigo, nombre, tipo) VALUES ($1, $2, $3) RETURNING id',
    [codigo, nombre, tipo],
  );
  return rows[0].id;
}

export async function actualizarLinea(bd, lineaId, { nombre, tipo }) {
  const { rowCount } = await bd.query(
    `UPDATE pasaje.lineas SET nombre = coalesce($2, nombre), tipo = coalesce($3, tipo)
     WHERE id = $1`,
    [lineaId, nombre ?? null, tipo ?? null],
  );
  return rowCount > 0;
}

/**
 * Crea o actualiza un tramo por (línea, código). `tarifaManual: null` la quita.
 * `trazo` sin enviar deja el que tenía; `trazo: null` lo borra.
 */
export async function guardarTramo(bd, lineaId, { codigo, nombre, km, tarifaManual, trazo }) {
  await bd.query(
    `INSERT INTO pasaje.tramos (linea_id, codigo, nombre, km, tarifa_manual, trazo)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (linea_id, codigo)
     DO UPDATE SET nombre = EXCLUDED.nombre, km = EXCLUDED.km, tarifa_manual = EXCLUDED.tarifa_manual,
       trazo = CASE WHEN $7 THEN EXCLUDED.trazo ELSE pasaje.tramos.trazo END`,
    [
      lineaId,
      codigo,
      nombre,
      km,
      tarifaManual ?? null,
      trazo ? JSON.stringify(trazo) : null,
      trazo !== undefined,
    ],
  );
}
