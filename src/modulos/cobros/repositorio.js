// Cobros con los datos que necesita el serializador (nombre del pasajero y si tiene conflicto).
const DETALLE = `
  SELECT c.id, c.bid, c.pasajero_id, c.recolector_id, u.nombre AS pasajero_nombre,
    c.categoria_aplicada, c.linea_codigo, c.tramo_codigo, c.tramo_nombre, c.unidad_codigo,
    c.monto, c.metodo, c.ocurrido_en, c.sincronizado_en, c.confirmado_por,
    EXISTS (SELECT 1 FROM pasaje.conflictos cf WHERE cf.cobro_original_id = c.id) AS tiene_conflicto
  FROM pasaje.cobros c
  JOIN pasaje.usuarios u ON u.id = c.pasajero_id
`;

/**
 * Bloquea el boleto (hasta el fin de la transacción) y trae su cobro vigente, en una consulta.
 * @returns {Promise<{ boleto: object | null, cobro: object | null }>}
 */
export async function bloquearBoletoConCobro(bd, bid) {
  const { rows } = await bd.query(
    `SELECT b.bid, b.usuario_id, b.categoria, b.monto_reservado, b.expira_en, b.estado,
       c.id AS c_id, c.recolector_id AS c_recolector_id, c.unidad_id AS c_unidad_id,
       c.monto AS c_monto, c.ocurrido_en AS c_ocurrido_en, c.sincronizado_en AS c_sincronizado_en,
       c.confirmado_por AS c_confirmado_por
     FROM pasaje.boletos b
     LEFT JOIN pasaje.cobros c ON c.bid = b.bid AND c.anulado_en IS NULL
     WHERE b.bid = $1
     FOR UPDATE OF b`,
    [bid],
  );
  const fila = rows[0];
  if (!fila) return { boleto: null, cobro: null };
  const {
    c_id: id,
    c_recolector_id,
    c_unidad_id,
    c_monto,
    c_ocurrido_en,
    c_sincronizado_en,
    c_confirmado_por,
    ...boleto
  } = fila;
  const cobro = id
    ? {
        id,
        bid,
        recolector_id: c_recolector_id,
        unidad_id: c_unidad_id,
        monto: c_monto,
        ocurrido_en: c_ocurrido_en,
        sincronizado_en: c_sincronizado_en,
        confirmado_por: c_confirmado_por,
      }
    : null;
  return { boleto, cobro };
}

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

/** Inserta el cobro y marca el boleto como usado, en una consulta. @returns {Promise<string>} id */
export async function insertar(bd, c) {
  const { rows } = await bd.query(
    `WITH usado AS (
       UPDATE pasaje.boletos SET estado = 'usado', actualizado_en = now() WHERE bid = $1
     )
     INSERT INTO pasaje.cobros
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

/** Agrega quién confirmó el cobro ('recolector' o 'pasajero'), si no estaba. */
export async function agregarConfirmacion(bd, cobroId, origen) {
  await bd.query(
    `UPDATE pasaje.cobros SET confirmado_por = array_append(confirmado_por, $2)
     WHERE id = $1 AND NOT ($2 = ANY (confirmado_por))`,
    [cobroId, origen],
  );
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
