// POST /sync/cobros y DELETE /sync/cobros/:bid (CONTRATO.md §6.3, §8.3, §8.4).
// Cada cobro se procesa en su propia transacción: uno malo no frena a los demás.
import { decodificarBoleto, rawABoleto, verificarFirma } from '../../../shared/boleto.js';
import { BOLETO, CODIGOS_ERROR, LIMITES } from '../../../shared/codigos.js';
import { calcularMonto } from '../../../shared/tarifa.js';
import { conTransaccion, pool } from '../../bd/pool.js';
import { EVENTOS, SALAS } from '../../tiempoReal/eventos.js';
import { emitir } from '../../tiempoReal/emisor.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import { aSegundos } from '../../utils/fechas.js';
import { obtenerLlaves } from '../../utils/llaves.js';
import { moverSaldo, TIPOS_MOVIMIENTO } from '../billetera/libro.js';
import { crearAviso } from '../billetera/repositorio.js';
import { obtenerBilleteraPorId } from '../billetera/servicio.js';
import * as boletos from '../boletos/repositorio.js';
import { avisarRecolectores, revocarTodos } from '../boletos/servicio.js';
import * as cobros from '../cobros/repositorio.js';
import { serializarCobro } from '../cobros/serializadores.js';
import * as lineas from '../lineas/repositorio.js';
import { unidadDelRecolector } from '../recolector/servicio.js';
import { feriadosRecientes, vigenteEn, vigenteYProximo } from '../tabuladores/servicio.js';

const ESTADOS = Object.freeze({
  OK: 'ok',
  DUPLICADO: 'duplicado',
  CONFLICTO: 'conflicto',
  RECHAZADO: 'rechazado',
});

/**
 * Sincroniza cobros hechos por el recolector (fase 1: uno por llamada, justo después del toque).
 * Idempotente por `bid`.
 * @param {object} recolector fila de BD
 * @param {object[]} cobrosLocales CobroLocal[]
 * @returns {Promise<{ resultados: object[] }>}
 */
export async function sincronizarCobros(recolector, cobrosLocales) {
  const contexto = await armarContexto(recolector);
  const resultados = [];
  for (const local of cobrosLocales) {
    resultados.push(await procesarCobro(contexto, local));
  }
  return { resultados };
}

async function armarContexto(recolector) {
  const unidad = await unidadDelRecolector(recolector.id);
  const [linea, { todos }, feriados] = await Promise.all([
    lineas.buscarConTramos(pool, unidad.linea_id),
    vigenteYProximo(pool),
    feriadosRecientes(pool),
  ]);
  return { recolector, unidad, linea, tabuladores: todos, feriados, llaves: obtenerLlaves() };
}

/** Aplica las reglas en orden; la primera que falla define el resultado. */
async function procesarCobro(contexto, local) {
  const boleto = leerBoleto(local.raw, contexto.llaves.publica);
  if (!boleto) return rechazado(null, CODIGOS_ERROR.BOLETO_INVALIDO);

  const { bid } = boleto;
  if (boleto.expira <= aSegundos(local.ocurridoEn) - BOLETO.TOLERANCIA_RELOJ_SEG) {
    return rechazado(bid, CODIGOS_ERROR.BOLETO_VENCIDO);
  }

  const tramo = contexto.linea.tramos.find((t) => t.codigo === local.tramoCodigo);
  if (!tramo) return rechazado(bid, CODIGOS_ERROR.TRAMO_INVALIDO);

  const tabulador = vigenteEn(contexto.tabuladores, local.ocurridoEn);
  if (!tabulador) return rechazado(bid, CODIGOS_ERROR.VALIDACION);

  const monto = calcularMonto({
    linea: contexto.linea,
    tramo,
    tabulador,
    categoria: boleto.categoria,
    ocurridoEn: local.ocurridoEn,
    feriados: contexto.feriados,
  });

  const resultado = await conTransaccion((cliente) =>
    registrarCobro(cliente, { contexto, local, boleto, tramo, tabulador, monto }),
  );
  return completarDespuesDelCommit(resultado);
}

function leerBoleto(raw, llavePublica) {
  try {
    const bytes = rawABoleto(raw);
    return verificarFirma(bytes, llavePublica) ? decodificarBoleto(bytes) : null;
  } catch {
    return null;
  }
}

async function registrarCobro(cliente, { contexto, local, boleto, tramo, tabulador, monto }) {
  const { bid } = boleto;
  const fila = await boletos.bloquear(cliente, bid);
  if (!fila) return rechazado(bid, CODIGOS_ERROR.BOLETO_INVALIDO); // firmado pero no emitido aquí

  const existente = await cobros.buscarVigentePorBid(cliente, bid);
  if (existente) return resolverRepetido(cliente, { contexto, local, fila, existente, monto });

  if (fila.estado === 'revocado' || fila.estado === 'usado') {
    return rechazado(bid, CODIGOS_ERROR.BOLETO_USADO);
  }
  if (fila.estado === 'vencido') return rechazado(bid, CODIGOS_ERROR.BOLETO_VENCIDO);
  if (monto > fila.monto_reservado) return rechazado(bid, CODIGOS_ERROR.BOLETO_INSUFICIENTE);

  const cobroId = await cobros.insertar(cliente, {
    bid,
    pasajeroId: fila.usuario_id,
    recolectorId: contexto.recolector.id,
    unidadId: contexto.unidad.id,
    tramoId: tramo.id,
    tabuladorId: tabulador.id,
    lineaCodigo: contexto.linea.codigo,
    tramoCodigo: tramo.codigo,
    tramoNombre: tramo.nombre,
    unidadCodigo: contexto.unidad.codigo,
    categoriaAplicada: boleto.categoria,
    monto,
    montoRecolector: local.monto,
    metodo: local.metodo,
    ocurridoEn: local.ocurridoEn,
    confirmadoPor: ['recolector'],
  });
  await boletos.cambiarEstado(cliente, bid, 'usado');
  await cobrarDeLaReserva(cliente, fila, monto, cobroId);
  return { bid, estado: ESTADOS.OK, cobroId, pasajeroId: fila.usuario_id };
}

/** El cobro sale de lo reservado; la diferencia vuelve al disponible (§8.2). */
async function cobrarDeLaReserva(cliente, boleto, monto, cobroId) {
  const reservado = boleto.monto_reservado;
  await moverSaldo(cliente, boleto.usuario_id, {
    tipo: TIPOS_MOVIMIENTO.COBRO,
    reservado: -reservado,
    cobroId,
  });
  if (reservado > monto) {
    await moverSaldo(cliente, boleto.usuario_id, {
      tipo: TIPOS_MOVIMIENTO.LIBERACION,
      disponible: reservado - monto,
      cobroId,
    });
  }
}

/**
 * Mismo bid ya cobrado. Si es el mismo cobro reenviado (mismo recolector, mismo segundo) es un
 * duplicado inofensivo. Si no, es doble gasto: conflicto y cuenta bloqueada (§8.4).
 */
async function resolverRepetido(cliente, { contexto, local, fila, existente, monto }) {
  const mismoCobro =
    existente.recolector_id === contexto.recolector.id &&
    aSegundos(existente.ocurrido_en) === aSegundos(local.ocurridoEn);
  if (mismoCobro) {
    return { bid: fila.bid, estado: ESTADOS.DUPLICADO, cobroId: existente.id };
  }

  await cobros.insertarConflicto(cliente, {
    bid: fila.bid,
    cobroOriginalId: existente.id,
    pasajeroId: fila.usuario_id,
    recolectorId: contexto.recolector.id,
    unidadId: contexto.unidad.id,
    monto,
    ocurridoEn: local.ocurridoEn,
  });
  await bloquearPorDobleGasto(cliente, fila.usuario_id);
  return {
    bid: fila.bid,
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
async function completarDespuesDelCommit(resultado) {
  if (resultado.avisarRecolectores) avisarRecolectores();
  if (!resultado.cobroId) return resultado;

  const cobro = serializarCobro(await cobros.buscarDetalle(pool, resultado.cobroId));
  if (resultado.estado === ESTADOS.OK) {
    const billetera = await obtenerBilleteraPorId(resultado.pasajeroId);
    emitir(SALAS.usuario(resultado.pasajeroId), EVENTOS.COBRO_CONFIRMADO, { cobro, billetera });
  }
  const { bid, estado, codigo } = resultado;
  return codigo ? { bid, estado, codigo, cobro } : { bid, estado, cobro };
}

function rechazado(bid, codigo) {
  return { bid, estado: ESTADOS.RECHAZADO, codigo };
}

/**
 * Anula un cobro propio de hace menos de 2 minutos (botón "Corregir").
 * El boleto vuelve a quedar activo con su reserva completa, listo para cobrarse con otro tramo.
 * @param {object} recolector fila de BD
 * @param {string} bid
 * @throws {ErrorApp} NO_ENCONTRADO si no hay un cobro suyo con ese bid; CONFLICTO si ya pasó la ventana
 */
export async function anularCobro(recolector, bid) {
  await conTransaccion(async (cliente) => {
    const boleto = await boletos.bloquear(cliente, bid);
    const cobro = boleto && (await cobros.buscarVigentePorBid(cliente, bid));
    if (!cobro || cobro.recolector_id !== recolector.id) {
      throw new ErrorApp(CODIGOS_ERROR.NO_ENCONTRADO, 'No tienes un cobro con ese boleto');
    }
    if (Date.now() - cobro.sincronizado_en.getTime() > LIMITES.VENTANA_ANULAR_MS) {
      throw new ErrorApp(
        CODIGOS_ERROR.CONFLICTO,
        'Ya pasaron más de 2 minutos: pide a la central que corrija este cobro',
      );
    }

    await cobros.anular(cliente, cobro.id);
    await boletos.cambiarEstado(cliente, bid, 'activo');
    await volverAReservar(cliente, boleto, cobro);
  });
}

async function volverAReservar(cliente, boleto, cobro) {
  try {
    await moverSaldo(cliente, boleto.usuario_id, {
      tipo: TIPOS_MOVIMIENTO.RESERVA,
      disponible: -(boleto.monto_reservado - cobro.monto),
      reservado: boleto.monto_reservado,
      boletoBid: boleto.bid,
      cobroId: cobro.id,
    });
  } catch (error) {
    if (error.codigo !== CODIGOS_ERROR.SALDO_INSUFICIENTE) throw error;
    throw new ErrorApp(
      CODIGOS_ERROR.CONFLICTO,
      'El pasajero ya usó ese saldo: pide a la central que corrija este cobro',
    );
  }
}
