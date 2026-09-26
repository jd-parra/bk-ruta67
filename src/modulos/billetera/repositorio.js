const DIAS_AVISOS = 30;
const MAX_AVISOS = 10;

export async function leerSaldos(bd, usuarioId) {
  const { rows } = await bd.query(
    `SELECT saldo_disponible, saldo_reservado FROM pasaje.billeteras WHERE usuario_id = $1`,
    [usuarioId],
  );
  return rows[0] ?? null;
}

export async function contarBoletosActivos(bd, usuarioId) {
  const { rows } = await bd.query(
    `SELECT count(*)::int AS n FROM pasaje.boletos WHERE usuario_id = $1 AND estado = 'activo' AND expira_en > now()`,
    [usuarioId],
  );
  return rows[0].n;
}

/** Avisos personales y globales recientes. */
export async function listarAvisos(bd, usuarioId) {
  const { rows } = await bd.query(
    `SELECT id, tipo, mensaje, vigente_desde FROM pasaje.avisos
     WHERE (usuario_id = $1 OR usuario_id IS NULL)
       AND creado_en > now() - interval '${DIAS_AVISOS} days'
     ORDER BY creado_en DESC LIMIT ${MAX_AVISOS}`,
    [usuarioId],
  );
  return rows;
}

export async function listarMovimientos(bd, usuarioId, limite) {
  const { rows } = await bd.query(
    `SELECT id, tipo, monto, saldo_disponible_despues, cobro_id, creado_en
     FROM pasaje.movimientos WHERE usuario_id = $1
     ORDER BY creado_en DESC, id LIMIT $2`,
    [usuarioId, limite],
  );
  return rows;
}

/**
 * Crea un aviso. `usuarioId` null = para todos los pasajeros.
 * @returns {Promise<object>} la fila creada
 */
export async function crearAviso(bd, { usuarioId = null, tipo, mensaje, vigenteDesde = null }) {
  const { rows } = await bd.query(
    `INSERT INTO pasaje.avisos (usuario_id, tipo, mensaje, vigente_desde)
     VALUES ($1, $2, $3, $4) RETURNING id, tipo, mensaje, vigente_desde`,
    [usuarioId, tipo, mensaje, vigenteDesde],
  );
  return rows[0];
}
