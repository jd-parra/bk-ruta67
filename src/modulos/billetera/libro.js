// ÚNICO lugar que cambia saldos. Toda operación de dinero pasa por moverSaldo() dentro de
// una transacción: actualiza la billetera (bloqueando la fila) e inserta los movimientos
// en UNA sola consulta. El CHECK de la BD es el que impide un saldo negativo.
import { CODIGOS_ERROR } from '../../../shared/codigos.js';
import { ErrorApp } from '../../utils/ErrorApp.js';

export const TIPOS_MOVIMIENTO = Object.freeze({
  RECARGA: 'recarga',
  RESERVA: 'reserva',
  COBRO: 'cobro',
  LIBERACION: 'liberacion',
});

const VIOLACION_CHECK = '23514';

// UPDATE bloquea la billetera hasta el fin de la transacción. Cada movimiento guarda el
// disponible que quedó después de él: el final menos lo que movieron los que vienen detrás.
const MOVER_SALDO = `
  WITH billetera AS (
    UPDATE pasaje.billeteras
    SET saldo_disponible = saldo_disponible + $2,
        saldo_reservado = saldo_reservado + $3,
        actualizado_en = now()
    WHERE usuario_id = $1
    RETURNING saldo_disponible, saldo_reservado
  ), nuevos AS (
    INSERT INTO pasaje.movimientos
      (usuario_id, tipo, monto, saldo_disponible_despues, recarga_id, boleto_bid, cobro_id)
    SELECT $1, m.tipo, m.monto, b.saldo_disponible - m.despues, m.recarga_id, m.boleto_bid, m.cobro_id
    FROM billetera b,
      jsonb_to_recordset($4::jsonb) AS m(
        tipo text, monto bigint, despues bigint, recarga_id uuid, boleto_bid uuid, cobro_id uuid
      )
  )
  SELECT saldo_disponible, saldo_reservado FROM billetera`;

/**
 * Aplica uno o varios cambios de saldo y los deja en el libro.
 * El `monto` de cada movimiento es su cambio del saldo disponible (+ entra, − sale), como en §5.
 *
 * @param {import('pg').PoolClient} cliente dentro de una transacción
 * @param {string} usuarioId
 * @param {Cambio | Cambio[]} cambios
 * @typedef {{
 *   tipo: string,
 *   disponible?: number,  // delta del saldo disponible
 *   reservado?: number,   // delta del saldo reservado
 *   recargaId?: string, boletoBid?: string, cobroId?: string,
 * }} Cambio
 * @returns {Promise<{ saldoDisponible: number, saldoReservado: number }>}
 * @throws {ErrorApp} SALDO_INSUFICIENTE si el disponible quedaría negativo
 */
export async function moverSaldo(cliente, usuarioId, cambios) {
  const lista = Array.isArray(cambios) ? cambios : [cambios];
  const deltaDisponible = sumar(lista, 'disponible');
  const deltaReservado = sumar(lista, 'reservado');

  let filas;
  try {
    ({ rows: filas } = await cliente.query(MOVER_SALDO, [
      usuarioId,
      deltaDisponible,
      deltaReservado,
      JSON.stringify(aMovimientos(lista)),
    ]));
  } catch (error) {
    throw traducirError(error, usuarioId);
  }
  if (!filas[0]) throw new ErrorApp(CODIGOS_ERROR.NO_ENCONTRADO, 'No tienes billetera');
  return {
    saldoDisponible: filas[0].saldo_disponible,
    saldoReservado: filas[0].saldo_reservado,
  };
}

/**
 * Bloquea la billetera hasta el fin de la transacción y devuelve sus saldos.
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

function sumar(lista, campo) {
  return lista.reduce((total, cambio) => total + (cambio[campo] ?? 0), 0);
}

/** Cada movimiento con `despues` = disponible que movieron los que vienen detrás de él. */
function aMovimientos(lista) {
  let restante = sumar(lista, 'disponible');
  return lista.map((cambio) => {
    restante -= cambio.disponible ?? 0;
    return {
      tipo: cambio.tipo,
      monto: cambio.disponible ?? 0,
      despues: restante,
      recarga_id: cambio.recargaId ?? null,
      boleto_bid: cambio.boletoBid ?? null,
      cobro_id: cambio.cobroId ?? null,
    };
  });
}

function traducirError(error, usuarioId) {
  if (error.code !== VIOLACION_CHECK) return error;
  if (/saldo_reservado/.test(error.constraint ?? '')) {
    return new Error(`Saldo reservado negativo para ${usuarioId}: el libro está inconsistente`);
  }
  return new ErrorApp(CODIGOS_ERROR.SALDO_INSUFICIENTE, 'No tienes saldo suficiente');
}
