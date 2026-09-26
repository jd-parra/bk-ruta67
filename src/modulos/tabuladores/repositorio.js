const COLUMNAS = `id, fuente, vigente_desde, descuentos, recargo_domingo_feriado,
  urbano_minimo, suburbano, creado_en`;

/** Todos los tabuladores, del más nuevo al más viejo. */
export async function listar(bd) {
  const { rows } = await bd.query(
    `SELECT ${COLUMNAS} FROM pasaje.tabuladores ORDER BY vigente_desde DESC`,
  );
  return rows;
}

/**
 * @param {import('pg').PoolClient} bd
 * @param {object} t Tabulador del contrato (sin id)
 */
export async function crear(bd, t) {
  const { rows } = await bd.query(
    `INSERT INTO pasaje.tabuladores
       (fuente, vigente_desde, descuentos, recargo_domingo_feriado, urbano_minimo, suburbano)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${COLUMNAS}`,
    [
      t.fuente,
      t.vigenteDesde,
      JSON.stringify(t.descuentos),
      t.recargoDomingoFeriado,
      t.urbanoMinimo,
      JSON.stringify(t.suburbano),
    ],
  );
  return rows[0];
}

/** Feriados desde una fecha (`YYYY-MM-DD`). */
export async function listarFeriados(bd, desdeFecha) {
  const { rows } = await bd.query(
    `SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha FROM pasaje.feriados
     WHERE fecha >= $1 ORDER BY fecha`,
    [desdeFecha],
  );
  return rows.map((r) => r.fecha);
}
