const COLUMNAS = 'bid, usuario_id, categoria, monto_reservado, expira_en, estado';

/** Inserta varios boletos en una sola consulta. */
export async function insertarVarios(bd, boletos) {
  await bd.query(
    `INSERT INTO pasaje.boletos (bid, usuario_id, categoria, monto_reservado, expira_en)
     SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::text[], $4::bigint[], $5::timestamptz[])`,
    [
      boletos.map((b) => b.bid),
      boletos.map((b) => b.usuario_id),
      boletos.map((b) => b.categoria),
      boletos.map((b) => b.monto_reservado),
      boletos.map((b) => b.expira_en),
    ],
  );
}

/**
 * Bloquea la billetera (hasta el fin de la transacción) y cuenta los boletos activos, en una consulta.
 * @returns {Promise<{ disponible: number, activos: number }>}
 */
export async function bloquearParaEmitir(bd, usuarioId) {
  const { rows } = await bd.query(
    `SELECT b.saldo_disponible AS disponible,
       (SELECT count(*)::int FROM pasaje.boletos x
        WHERE x.usuario_id = b.usuario_id AND x.estado = 'activo' AND x.expira_en > now()) AS activos
     FROM pasaje.billeteras b WHERE b.usuario_id = $1 FOR UPDATE`,
    [usuarioId],
  );
  if (!rows[0]) throw new Error(`El pasajero ${usuarioId} no tiene billetera`);
  return rows[0];
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
