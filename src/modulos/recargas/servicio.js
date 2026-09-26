import { conTransaccion } from '../../bd/pool.js';
import { moverSaldo, TIPOS_MOVIMIENTO } from '../billetera/libro.js';
import { obtenerBilletera } from '../billetera/servicio.js';

/**
 * Recarga simulada (fase 1): se confirma al instante y suma al saldo disponible.
 * @param {object} usuario fila de BD
 * @param {{ monto: number, metodo: 'simulada' }} datos
 * @returns {Promise<{ recarga: object, billetera: object }>}
 */
export async function recargar(usuario, { monto, metodo }) {
  const recarga = await conTransaccion(async (cliente) => {
    const { rows } = await cliente.query(
      `INSERT INTO pasaje.recargas (usuario_id, monto, metodo, estado)
       VALUES ($1, $2, $3, 'confirmada')
       RETURNING id, monto, metodo, estado, creado_en`,
      [usuario.id, monto, metodo],
    );
    await moverSaldo(cliente, usuario.id, {
      tipo: TIPOS_MOVIMIENTO.RECARGA,
      disponible: monto,
      recargaId: rows[0].id,
    });
    return rows[0];
  });
  return { recarga: serializarRecarga(recarga), billetera: await obtenerBilletera(usuario) };
}

function serializarRecarga(fila) {
  return {
    id: fila.id,
    monto: fila.monto,
    metodo: fila.metodo,
    estado: fila.estado,
    creadoEn: fila.creado_en.toISOString(),
  };
}
