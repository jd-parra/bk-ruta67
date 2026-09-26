// Trabajo diario (§8.1): los boletos vencidos sin usar liberan su reserva.
// Se espera un día de gracia después de `expira` para que los cobros hechos sin conexión
// alcancen a sincronizar antes de liberar la reserva.
import cron from 'node-cron';
import { conTransaccion, pool } from '../bd/pool.js';
import { moverSaldo, TIPOS_MOVIMIENTO } from '../modulos/billetera/libro.js';
import * as boletos from '../modulos/boletos/repositorio.js';
import { ZONA_HORARIA } from '../../shared/codigos.js';
import { logger } from '../utils/logger.js';

const HORAS_GRACIA = 24;
const TODOS_LOS_DIAS_4AM = '0 4 * * *';

/**
 * Marca como vencidos los boletos expirados y libera su reserva.
 * @returns {Promise<number>} cuántos boletos venció
 */
export async function vencerBoletos() {
  const vencidos = await boletos.listarVencidos(pool, HORAS_GRACIA);
  let procesados = 0;
  for (const boleto of vencidos) {
    const liberado = await conTransaccion(async (cliente) => {
      const actual = await boletos.bloquear(cliente, boleto.bid);
      if (actual?.estado !== 'activo') return false; // lo cobraron mientras tanto
      await boletos.cambiarEstado(cliente, boleto.bid, 'vencido');
      await moverSaldo(cliente, boleto.usuario_id, {
        tipo: TIPOS_MOVIMIENTO.LIBERACION,
        disponible: actual.monto_reservado,
        reservado: -actual.monto_reservado,
        boletoBid: boleto.bid,
      });
      return true;
    });
    if (liberado) procesados++;
  }
  return procesados;
}

/** Corre una vez al arrancar y luego todos los días a las 4:00 (hora de Venezuela). */
export function programarVencimientos() {
  const correr = () =>
    vencerBoletos()
      .then((n) => n > 0 && logger.info(`${n} boletos vencidos liberaron su reserva`))
      .catch((error) => logger.error({ err: error }, 'falló el vencimiento de boletos'));
  correr();
  return cron.schedule(TODOS_LOS_DIAS_4AM, correr, { timezone: ZONA_HORARIA });
}
