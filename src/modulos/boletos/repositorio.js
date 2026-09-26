const COLUMNAS = 'bid, usuario_id, categoria, monto_reservado, expira_en, estado';

export async function insertar(bd, { bid, usuarioId, categoria, montoReservado, expiraEn }) {
  await bd.query(
    `INSERT INTO pasaje.boletos (bid, usuario_id, categoria, monto_reservado, expira_en)
     VALUES ($1, $2, $3, $4, $5)`,
    [bid, usuarioId, categoria, montoReservado, expiraEn],
  );
}

export async function listarActivos(bd, usuarioId) {
  const { rows } = await bd.query(
    `SELECT ${COLUMNAS} FROM pasaje.boletos
     WHERE usuario_id = $1 AND estado = 'activo' AND expira_en > now()
     ORDER BY expira_en`,
    [usuarioId],
  );
  return rows;
}

/** Bloquea el boleto hasta el fin de la transacción. */
export async function bloquear(bd, bid) {
  const { rows } = await bd.query(
    `SELECT ${COLUMNAS} FROM pasaje.boletos WHERE bid = $1 FOR UPDATE`,
    [bid],
  );
  return rows[0] ?? null;
}

export async function cambiarEstado(bd, bid, estado) {
  await bd.query(`UPDATE pasaje.boletos SET estado = $2, actualizado_en = now() WHERE bid = $1`, [
    bid,
    estado,
  ]);
}

/** Marca como revocados los activos de un usuario y los devuelve. */
export async function revocarActivos(bd, usuarioId) {
  const { rows } = await bd.query(
    `UPDATE pasaje.boletos SET estado = 'revocado', actualizado_en = now()
     WHERE usuario_id = $1 AND estado = 'activo'
     RETURNING ${COLUMNAS}`,
    [usuarioId],
  );
  return rows;
}

/**
 * bid que el recolector debe rechazar sin conexión: revocados que todavía no vencieron
 * y activos de cuentas bloqueadas.
 */
export async function listarBidsRevocados(bd) {
  const { rows } = await bd.query(
    `SELECT b.bid FROM pasaje.boletos b
     JOIN pasaje.usuarios u ON u.id = b.usuario_id
     WHERE b.expira_en > now() - interval '1 day'
       AND (b.estado = 'revocado' OR (b.estado = 'activo' AND u.bloqueado))
     ORDER BY b.bid`,
  );
  return rows.map((r) => r.bid);
}

/** Activos vencidos hace más de `horasGracia` (para el trabajo diario). */
export async function listarVencidos(bd, horasGracia) {
  const { rows } = await bd.query(
    `SELECT ${COLUMNAS} FROM pasaje.boletos
     WHERE estado = 'activo' AND expira_en < now() - make_interval(hours => $1)
     ORDER BY usuario_id`,
    [horasGracia],
  );
  return rows;
}
