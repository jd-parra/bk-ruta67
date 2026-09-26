// ÚNICO lugar que cambia saldos. Toda operación de dinero pasa por moverSaldo() dentro de
// una transacción: bloquea la billetera, valida, actualiza e inserta el movimiento.
import { CODIGOS_ERROR } from '../../../shared/codigos.js';
import { ErrorApp } from '../../utils/ErrorApp.js';

export const TIPOS_MOVIMIENTO = Object.freeze({
  RECARGA: 'recarga',
  RESERVA: 'reserva',
  COBRO: 'cobro',
  LIBERACION: 'liberacion',
});

/**
 * Aplica un cambio de saldo y deja el movimiento en el libro.
 * El `monto` del movimiento es el cambio del saldo disponible (+ entra, − sale), como en §5.
 *
 * @param {import('pg').PoolClient} cliente dentro de una transacción
 * @param {string} usuarioId
 * @param {{
 *   tipo: string,
 *   disponible?: number,  // delta del saldo disponible
 *   reservado?: number,   // delta del saldo reservado
 *   recargaId?: string, boletoBid?: string, cobroId?: string,
 * }} cambio
 * @returns {Promise<{ saldoDisponible: number, saldoReservado: number }>}
 * @throws {ErrorApp} SALDO_INSUFICIENTE si el disponible quedaría negativo
 */
export async function moverSaldo(cliente, usuarioId, cambio) {
  const { tipo, disponible = 0, reservado = 0, recargaId, boletoBid, cobroId } = cambio;
  const actual = await bloquearBilletera(cliente, usuarioId);
  const saldoDisponible = actual.saldo_disponible + disponible;
  const saldoReservado = actual.saldo_reservado + reservado;

  if (saldoDisponible < 0) {
    throw new ErrorApp(CODIGOS_ERROR.SALDO_INSUFICIENTE, 'No tienes saldo suficiente');
  }
  if (saldoReservado < 0) {
    throw new Error(`Saldo reservado negativo para ${usuarioId}: el libro está inconsistente`);
  }

  await cliente.query(
    `UPDATE pasaje.billeteras
     SET saldo_disponible = $2, saldo_reservado = $3, actualizado_en = now()
     WHERE usuario_id = $1`,
    [usuarioId, saldoDisponible, saldoReservado],
  );
  await cliente.query(
    `INSERT INTO pasaje.movimientos
       (usuario_id, tipo, monto, saldo_disponible_despues, recarga_id, boleto_bid, cobro_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [usuarioId, tipo, disponible, saldoDisponible, recargaId, boletoBid, cobroId],
  );
  return { saldoDisponible, saldoReservado };
}

/**
 * Bloquea la billetera hasta el fin de la transacción (SELECT … FOR UPDATE).
 * @param {import('pg').PoolClient} cliente
 * @param {string} usuarioId
 */
export async function bloquearBilletera(cliente, usuarioId) {
  const { rows } = await cliente.query(
    `SELECT saldo_disponible, saldo_reservado FROM pasaje.billeteras
     WHERE usuario_id = $1 FOR UPDATE`,
    [usuarioId],
  );
  if (!rows[0]) throw new ErrorApp(CODIGOS_ERROR.NO_ENCONTRADO, 'No tienes billetera');
  return rows[0];
}
