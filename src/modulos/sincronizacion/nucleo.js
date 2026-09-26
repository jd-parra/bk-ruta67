// Núcleo común de /sync/cobros (recolector) y /sync/recibos (pasajero).
// Un "uso" es un boleto usado en una unidad, reportado por cualquiera de los dos teléfonos.
// El primero que llega crea el cobro; el segundo solo lo confirma (`confirmadoPor`, §6.4).
import { BOLETO, CODIGOS_ERROR } from '../../../shared/codigos.js';
import { calcularMonto } from '../../../shared/tarifa.js';
import { pool } from '../../bd/pool.js';
import { EVENTOS, SALAS } from '../../tiempoReal/eventos.js';
import { emitir } from '../../tiempoReal/emisor.js';
import { aSegundos } from '../../utils/fechas.js';
import { moverSaldo, TIPOS_MOVIMIENTO } from '../billetera/libro.js';
import { crearAviso } from '../billetera/repositorio.js';
import { obtenerBilleteraPorId } from '../billetera/servicio.js';
import { avisarRecolectores, revocarTodos } from '../boletos/servicio.js';
import * as cobros from '../cobros/repositorio.js';
import { serializarCobro } from '../cobros/serializadores.js';
import { vigenteEn } from '../tabuladores/servicio.js';

export const ESTADOS = Object.freeze({
  OK: 'ok',
  DUPLICADO: 'duplicado',
  CONFLICTO: 'conflicto',
  RECHAZADO: 'rechazado',
});

export function rechazado(bid, codigo) {
  return { bid, estado: ESTADOS.RECHAZADO, codigo };
}

/**
 * Registra un uso de boleto dentro de una transacción. Aplica las reglas en orden.
 * @param {import('pg').PoolClient} cliente
 * @param {{
 *   bid: string,
 *   origen: 'recolector' | 'pasajero',
 *   pasajeroId?: string,          // si viene (recibos), el boleto debe ser suyo
 *   recolectorId: string,
 *   unidad: { id: string, codigo: number },
 *   linea: { codigo: number, tipo: string },
 *   tramo: { id: string, codigo: number, nombre: string, km: number, tarifaManual?: number },
 *   tabuladores: object[], feriados: string[],
 *   montoReportado: number, metodo: 'nfc' | 'qr', ocurridoEn: string,
 * }} uso
 */
export async function registrarUso(cliente, uso) {
  const { bid } = uso;
  const { boleto, cobro: existente } = await cobros.bloquearBoletoConCobro(cliente, bid);
  if (!boleto || (uso.pasajeroId && boleto.usuario_id !== uso.pasajeroId)) {
    return rechazado(bid, CODIGOS_ERROR.BOLETO_INVALIDO); // no lo emitió este backend, o no es suyo
  }
  if (existente) return resolverRepetido(cliente, uso, boleto, existente);

  if (boleto.estado === 'revocado' || boleto.estado === 'usado') {
    return rechazado(bid, CODIGOS_ERROR.BOLETO_USADO);
  }
  const vencido =
    aSegundos(boleto.expira_en) <= aSegundos(uso.ocurridoEn) - BOLETO.TOLERANCIA_RELOJ_SEG;
  if (boleto.estado === 'vencido' || vencido) return rechazado(bid, CODIGOS_ERROR.BOLETO_VENCIDO);

  const tabulador = vigenteEn(uso.tabuladores, uso.ocurridoEn);
  if (!tabulador) return rechazado(bid, CODIGOS_ERROR.VALIDACION);
  const monto = calcularMonto({
    linea: uso.linea,
    tramo: uso.tramo,
    tabulador,
    categoria: boleto.categoria,
    ocurridoEn: uso.ocurridoEn,
    feriados: uso.feriados,
  });
  if (monto > boleto.monto_reservado) return rechazado(bid, CODIGOS_ERROR.BOLETO_INSUFICIENTE);

  const cobroId = await cobros.insertar(cliente, {
    bid,
    pasajeroId: boleto.usuario_id,
    recolectorId: uso.recolectorId,
    unidadId: uso.unidad.id,
    tramoId: uso.tramo.id,
    tabuladorId: tabulador.id,
    lineaCodigo: uso.linea.codigo,
    tramoCodigo: uso.tramo.codigo,
    tramoNombre: uso.tramo.nombre,
    unidadCodigo: uso.unidad.codigo,
    categoriaAplicada: boleto.categoria,
    monto,
    montoRecolector: uso.montoReportado,
    metodo: uso.metodo,
    ocurridoEn: uso.ocurridoEn,
    confirmadoPor: [uso.origen],
  });
  await cobrarDeLaReserva(cliente, boleto, monto, cobroId);
  return { bid, estado: ESTADOS.OK, cobroId, pasajeroId: boleto.usuario_id, cobroNuevo: true };
}

/** El cobro sale de lo reservado; la diferencia vuelve al disponible (§8.2). */
async function cobrarDeLaReserva(cliente, boleto, monto, cobroId) {
  const reservado = boleto.monto_reservado;
  const cambios = [{ tipo: TIPOS_MOVIMIENTO.COBRO, reservado: -reservado, cobroId }];
  if (reservado > monto) {
    cambios.push({ tipo: TIPOS_MOVIMIENTO.LIBERACION, disponible: reservado - monto, cobroId });
  }
  await moverSaldo(cliente, boleto.usuario_id, cambios);
}

/**
 * El boleto ya tiene un cobro. Si es el mismo viaje (misma unidad, mismo segundo):
 *  - reportado otra vez por el mismo teléfono → duplicado;
 *  - reportado por el otro teléfono → se confirma (ok).
 * Si es otro viaje, es doble gasto: conflicto y cuenta bloqueada (§8.4).
 */
async function resolverRepetido(cliente, uso, boleto, existente) {
  const mismoViaje =
    existente.unidad_id === uso.unidad.id &&
    aSegundos(existente.ocurrido_en) === aSegundos(uso.ocurridoEn);

  if (mismoViaje) {
    if (existente.confirmado_por.includes(uso.origen)) {
      return { bid: uso.bid, estado: ESTADOS.DUPLICADO, cobroId: existente.id };
    }
    await cobros.agregarConfirmacion(cliente, existente.id, uso.origen);
    return { bid: uso.bid, estado: ESTADOS.OK, cobroId: existente.id };
  }

  await cobros.insertarConflicto(cliente, {
    bid: uso.bid,
    cobroOriginalId: existente.id,
    pasajeroId: boleto.usuario_id,
    recolectorId: uso.recolectorId,
    unidadId: uso.unidad.id,
    monto: existente.monto,
    ocurridoEn: uso.ocurridoEn,
  });
  await bloquearPorDobleGasto(cliente, boleto.usuario_id);
  return {
    bid: uso.bid,
    estado: ESTADOS.CONFLICTO,
    codigo: CODIGOS_ERROR.BOLETO_USADO,
    cobroId: existente.id,
    avisarRecolectores: true,
  };
}

async function bloquearPorDobleGasto(cliente, usuarioId) {
  await cliente.query('UPDATE pasaje.usuarios SET bloqueado = true WHERE id = $1', [usuarioId]);
  await revocarTodos(cliente, usuarioId);
  await crearAviso(cliente, {
    usuarioId,
    tipo: 'CUENTA_BLOQUEADA',
    mensaje:
      'Detectamos un boleto usado dos veces. Tu cuenta está bloqueada: comunícate con la central',
  });
}

/** Eventos y datos que solo se deben mandar con la transacción ya confirmada. */
export async function completarDespuesDelCommit(resultado) {
  if (resultado.avisarRecolectores) avisarRecolectores();
  if (!resultado.cobroId) return resultado;

  const [detalle, billetera] = await Promise.all([
    cobros.buscarDetalle(pool, resultado.cobroId),
    resultado.cobroNuevo ? obtenerBilleteraPorId(resultado.pasajeroId) : null,
  ]);
  const cobro = serializarCobro(detalle);
  if (resultado.cobroNuevo) {
    emitir(SALAS.usuario(resultado.pasajeroId), EVENTOS.COBRO_CONFIRMADO, { cobro, billetera });
  }
  const { bid, estado, codigo } = resultado;
  return codigo ? { bid, estado, codigo, cobro } : { bid, estado, cobro };
}
