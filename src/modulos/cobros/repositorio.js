// Cobros con los datos que necesita el serializador (nombre del pasajero y si tiene conflicto).
const DETALLE = `
  SELECT c.id, c.bid, c.pasajero_id, c.recolector_id, u.nombre AS pasajero_nombre,
    c.categoria_aplicada, c.linea_codigo, c.tramo_codigo, c.tramo_nombre, c.unidad_codigo,
    c.monto, c.metodo, c.ocurrido_en, c.sincronizado_en, c.confirmado_por,
    EXISTS (SELECT 1 FROM pasaje.conflictos cf WHERE cf.cobro_original_id = c.id) AS tiene_conflicto
  FROM pasaje.cobros c
  JOIN pasaje.usuarios u ON u.id = c.pasajero_id
`;

/** Cobro vigente (no anulado) de un boleto, o null. */
export async function buscarVigentePorBid(bd, bid) {
  const { rows } = await bd.query(
    `SELECT id, bid, pasajero_id, recolector_id, monto, ocurrido_en, sincronizado_en
     FROM pasaje.cobros WHERE bid = $1 AND anulado_en IS NULL`,
    [bid],
  );
  return rows[0] ?? null;
}

export async function buscarDetalle(bd, cobroId) {
  const { rows } = await bd.query(`${DETALLE} WHERE c.id = $1`, [cobroId]);
  return rows[0] ?? null;
}

export async function listarPorRecolector(bd, recolectorId, desde) {
  const { rows } = await bd.query(
    `${DETALLE}
     WHERE c.recolector_id = $1 AND c.anulado_en IS NULL AND c.ocurrido_en >= $2
     ORDER BY c.ocurrido_en DESC`,
    [recolectorId, desde],
  );
  return rows;
}

/** @returns {Promise<string>} id del cobro */
export async function insertar(bd, c) {
  const { rows } = await bd.query(
    `INSERT INTO pasaje.cobros
       (bid, pasajero_id, recolector_id, unidad_id, tramo_id, tabulador_id, linea_codigo,
        tramo_codigo, tramo_nombre, unidad_codigo, categoria_aplicada, monto, monto_recolector,
        metodo, ocurrido_en, confirmado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     RETURNING id`,
    [
      c.bid,
      c.pasajeroId,
      c.recolectorId,
      c.unidadId,
      c.tramoId,
      c.tabuladorId,
      c.lineaCodigo,
      c.tramoCodigo,
      c.tramoNombre,
      c.unidadCodigo,
      c.categoriaAplicada,
      c.monto,
      c.montoRecolector,
      c.metodo,
      c.ocurridoEn,
      c.confirmadoPor,
    ],
  );
  return rows[0].id;
}

export async function anular(bd, cobroId) {
  await bd.query('UPDATE pasaje.cobros SET anulado_en = now() WHERE id = $1', [cobroId]);
}

export async function insertarConflicto(bd, c) {
  await bd.query(
    `INSERT INTO pasaje.conflictos
       (bid, cobro_original_id, pasajero_id, recolector_id, unidad_id, monto, ocurrido_en)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [c.bid, c.cobroOriginalId, c.pasajeroId, c.recolectorId, c.unidadId, c.monto, c.ocurridoEn],
  );
}
