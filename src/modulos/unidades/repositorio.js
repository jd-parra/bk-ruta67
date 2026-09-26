const COLUMNAS = `un.id, un.codigo, un.placa, un.linea_id, un.recolector_id,
  l.codigo AS linea_codigo, l.nombre AS linea_nombre, l.tipo AS linea_tipo,
  us.nombre AS recolector_nombre, us.telefono AS recolector_telefono`;

const DESDE = `FROM pasaje.unidades un
  JOIN pasaje.lineas l ON l.id = un.linea_id
  LEFT JOIN pasaje.usuarios us ON us.id = un.recolector_id`;

/** Unidad asignada a un recolector, con datos de su línea, o null. */
export async function buscarPorRecolector(bd, recolectorId) {
  const { rows } = await bd.query(`SELECT ${COLUMNAS} ${DESDE} WHERE un.recolector_id = $1`, [
    recolectorId,
  ]);
  return rows[0] ?? null;
}

export async function buscarPorId(bd, id) {
  const { rows } = await bd.query(`SELECT ${COLUMNAS} ${DESDE} WHERE un.id = $1`, [id]);
  return rows[0] ?? null;
}

export async function listar(bd) {
  const { rows } = await bd.query(`SELECT ${COLUMNAS} ${DESDE} ORDER BY un.codigo`);
  return rows;
}

export async function crear(bd, { codigo, placa, lineaId, recolectorId }) {
  const { rows } = await bd.query(
    `INSERT INTO pasaje.unidades (codigo, placa, linea_id, recolector_id)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [codigo, placa, lineaId, recolectorId ?? null],
  );
  return rows[0].id;
}

/** Cambia línea y/o recolector. `recolectorId: null` deja la unidad sin recolector. */
export async function actualizar(bd, id, { lineaId, recolectorId }) {
  const campos = [];
  const valores = [id];
  if (lineaId !== undefined) campos.push(`linea_id = $${valores.push(lineaId)}`);
  if (recolectorId !== undefined) campos.push(`recolector_id = $${valores.push(recolectorId)}`);
  if (campos.length === 0) return;
  await bd.query(`UPDATE pasaje.unidades SET ${campos.join(', ')} WHERE id = $1`, valores);
}
