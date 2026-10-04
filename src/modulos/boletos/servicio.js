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
 * Tras un aumento, los activos que reservaron de menos se revocan y su reserva vuelve al
 * disponible antes de emitir: el pasajero queda con boletos que cubren el pasaje nuevo.
 * @param {object} usuario fila de BD
 * @param {number} cantidad pedida
 * @returns {Promise<{ boletos: object[], billetera: object }>}
 * @throws {ErrorApp} SALDO_INSUFICIENTE si no alcanza ni para uno (y entonces no se revoca nada)
 */
export async function emitirBoletos(usuario, cantidad) {
  const categoria = categoriaEfectiva(usuario);
  const montoReservado = await calcularReserva(categoria);
  const { boletos, reemplazados } = await conTransaccion(async (cliente) => {
    const bloqueo = await repositorio.bloquearParaEmitir(cliente, usuario.id);
    const viejos = await repositorio.revocarInsuficientes(cliente, usuario.id, montoReservado);
    await liberarReservas(cliente, usuario.id, viejos);
    // Si no alcanza ni para uno, SALDO_INSUFICIENTE deshace también la revocación: los viejos
    // siguen sirviendo hasta el aumento y, después, para las rutas más baratas.
    const aEmitir = cuantosEmitir({
      pedidos: cantidad,
      libres: LIMITES.MAX_BOLETOS_ACTIVOS - (bloqueo.activos - viejos.length),
      disponible: bloqueo.disponible + viejos.reduce((suma, b) => suma + b.monto_reservado, 0),
      montoReservado,
    });
    if (aEmitir === 0) return { boletos: [], reemplazados: viejos.length };

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
    return { boletos: nuevos.map(serializarBoleto), reemplazados: viejos.length };
  });
  if (reemplazados > 0) avisarRecolectores(); // los viejos pasan a la lista de revocados
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
  await liberarReservas(cliente, usuarioId, revocados);
  return revocados.length;
}

/** Devuelve al disponible lo que reservaban unos boletos recién revocados. */
async function liberarReservas(cliente, usuarioId, boletos) {
  if (boletos.length === 0) return;
  await moverSaldo(
    cliente,
    usuarioId,
    boletos.map((boleto) => ({
      tipo: TIPOS_MOVIMIENTO.LIBERACION,
      disponible: boleto.monto_reservado,
      reservado: -boleto.monto_reservado,
      boletoBid: boleto.bid,
    })),
  );
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
 * Cuántos boletos emitir. Con reserva 0 (descuento del 100 %) el saldo no limita.
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

/** Lo más caro de la red con el tabulador vigente o con el próximo: así sirven también después de un aumento ya anunciado. */
async function calcularReserva(categoria) {
  const [{ tabulador, proximo }, lineas] = await Promise.all([
    vigenteYProximo(),
    lineasParaTarifas(),
  ]);
  return Math.max(
    ...[tabulador, proximo]
      .filter(Boolean)
      .map((t) => tarifaMaximaRed({ lineas, tabulador: t, categoria })),
  );
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
