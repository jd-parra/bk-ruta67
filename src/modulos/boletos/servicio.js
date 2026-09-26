import { randomUUID } from 'node:crypto';
import { boletoARaw, calcularExpira, firmarBoleto } from '../../../shared/boleto.js';
import { CODIGOS_ERROR, LIMITES } from '../../../shared/codigos.js';
import { tarifaMaximaRed } from '../../../shared/tarifa.js';
import { conTransaccion } from '../../bd/pool.js';
import { EVENTOS, SALAS } from '../../tiempoReal/eventos.js';
import { emitir } from '../../tiempoReal/emisor.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import { obtenerLlaves } from '../../utils/llaves.js';
import { moverSaldo, TIPOS_MOVIMIENTO } from '../billetera/libro.js';
import { obtenerBilletera } from '../billetera/servicio.js';
import { lineasParaTarifas } from '../lineas/servicio.js';
import { vigenteYProximo } from '../tabuladores/servicio.js';
import { categoriaEfectiva } from '../usuarios/categoria.js';
import * as repositorio from './repositorio.js';

/**
 * Emite boletos hasta completar 5 activos, según alcance el saldo disponible (§6.2, §8.2).
 * Cada boleto reserva la tarifa más cara de la red para la categoría del pasajero.
 * @param {object} usuario fila de BD
 * @param {number} cantidad pedida
 * @returns {Promise<{ boletos: object[], billetera: object }>}
 * @throws {ErrorApp} SALDO_INSUFICIENTE si no alcanza ni para uno
 */
export async function emitirBoletos(usuario, cantidad) {
  const categoria = categoriaEfectiva(usuario);
  const montoReservado = await calcularReserva(categoria);
  const boletos = await conTransaccion(async (cliente) => {
    const { disponible, activos } = await repositorio.bloquearParaEmitir(cliente, usuario.id);
    const aEmitir = cuantosEmitir({
      pedidos: cantidad,
      libres: LIMITES.MAX_BOLETOS_ACTIVOS - activos,
      disponible,
      montoReservado,
    });
    if (aEmitir === 0) return [];

    const expiraEn = new Date(calcularExpira(new Date()) * 1000);
    const nuevos = Array.from({ length: aEmitir }, () => ({
      bid: randomUUID(),
      usuario_id: usuario.id,
      categoria,
      monto_reservado: montoReservado,
      expira_en: expiraEn,
    }));
    await repositorio.insertarVarios(cliente, nuevos);
    await moverSaldo(
      cliente,
      usuario.id,
      nuevos.map((b) => ({
        tipo: TIPOS_MOVIMIENTO.RESERVA,
        disponible: -montoReservado,
        reservado: montoReservado,
        boletoBid: b.bid,
      })),
    );
    return nuevos.map(serializarBoleto);
  });
  return { boletos, billetera: await obtenerBilletera(usuario) };
}

/**
 * Boletos activos del pasajero, con su `raw` (la firma Ed25519 es determinista: se regenera igual).
 * @param {object} usuario fila de BD
 */
export async function listarActivos(usuario, bd) {
  const filas = await repositorio.listarActivos(bd, usuario.id);
  return filas.map(serializarBoleto);
}

/**
 * Revoca todos los boletos activos y libera su reserva.
 * Quien llama debe ejecutar `avisarRecolectores()` DESPUÉS del commit si revocó alguno.
 * @param {import('pg').PoolClient} cliente dentro de una transacción
 * @param {string} usuarioId
 * @returns {Promise<number>} cuántos se revocaron
 */
export async function revocarTodos(cliente, usuarioId) {
  const revocados = await repositorio.revocarActivos(cliente, usuarioId);
  if (revocados.length > 0) {
    await moverSaldo(
      cliente,
      usuarioId,
      revocados.map((boleto) => ({
        tipo: TIPOS_MOVIMIENTO.LIBERACION,
        disponible: boleto.monto_reservado,
        reservado: -boleto.monto_reservado,
        boletoBid: boleto.bid,
      })),
    );
  }
  return revocados.length;
}

/**
 * Revoca los boletos del pasajero (teléfono perdido) y avisa a los recolectores.
 * @param {object} usuario fila de BD
 * @returns {Promise<{ revocados: number, billetera: object }>}
 */
export async function revocarPorPerdida(usuario) {
  const revocados = await conTransaccion((cliente) => revocarTodos(cliente, usuario.id));
  if (revocados > 0) avisarRecolectores();
  return { revocados, billetera: await obtenerBilletera(usuario) };
}

/** Los recolectores deben volver a pedir el paquete (cambió la lista de revocados, etc.). */
export function avisarRecolectores() {
  emitir(SALAS.rol('recolector'), EVENTOS.PAQUETE_ACTUALIZADO, {});
}

/**
 * Cuántos boletos emitir. Con reserva 0 (exonerados) el saldo no limita.
 * @throws {ErrorApp} SALDO_INSUFICIENTE si hay cupo pero no saldo para ninguno
 */
export function cuantosEmitir({ pedidos, libres, disponible, montoReservado }) {
  const porSaldo = montoReservado > 0 ? Math.floor(disponible / montoReservado) : Infinity;
  const cantidad = Math.max(0, Math.min(pedidos, libres, porSaldo));
  if (cantidad === 0 && libres > 0 && pedidos > 0) {
    throw new ErrorApp(
      CODIGOS_ERROR.SALDO_INSUFICIENTE,
      'No tienes saldo suficiente para un boleto. Recarga e intenta de nuevo',
    );
  }
  return cantidad;
}

async function calcularReserva(categoria) {
  const [{ tabulador }, lineas] = await Promise.all([vigenteYProximo(), lineasParaTarifas()]);
  return tarifaMaximaRed({ lineas, tabulador, categoria });
}

/** Fila de boleto → `BoletoEmitido` del contrato. */
function serializarBoleto(fila) {
  const expira = Math.floor(fila.expira_en.getTime() / 1000);
  const bytes = firmarBoleto(
    {
      bid: fila.bid,
      uid: fila.usuario_id,
      categoria: fila.categoria,
      montoReservado: fila.monto_reservado,
      expira,
    },
    obtenerLlaves().secreta,
  );
  return {
    bid: fila.bid,
    raw: boletoARaw(bytes),
    montoReservado: fila.monto_reservado,
    expiraEn: new Date(expira * 1000).toISOString(),
  };
}
