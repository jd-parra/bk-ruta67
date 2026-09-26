// POST /sync/cobros y DELETE /sync/cobros/:bid (CONTRATO.md §6.3, §8.3, §8.4).
// Cada cobro se procesa en su propia transacción: uno malo no frena a los demás.
import { decodificarBoleto, rawABoleto, verificarFirma } from '../../../shared/boleto.js';
import { BOLETO, CODIGOS_ERROR, LIMITES } from '../../../shared/codigos.js';
import { conTransaccion } from '../../bd/pool.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import { aSegundos } from '../../utils/fechas.js';
import { obtenerLlaves } from '../../utils/llaves.js';
import { moverSaldo, TIPOS_MOVIMIENTO } from '../billetera/libro.js';
import * as boletos from '../boletos/repositorio.js';
import * as cobros from '../cobros/repositorio.js';
import { lineaParaCobrar } from '../lineas/servicio.js';
import { unidadDelRecolector } from '../recolector/servicio.js';
import { feriadosRecientes, vigenteYProximo } from '../tabuladores/servicio.js';
import { completarDespuesDelCommit, rechazado, registrarUso } from './nucleo.js';

/**
 * Sincroniza cobros hechos por el recolector (fase 1: uno por llamada; fase 2: la cola completa).
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
    lineaParaCobrar(unidad.linea_id),
    vigenteYProximo(),
    feriadosRecientes(),
  ]);
  return { recolector, unidad, linea, tabuladores: todos, feriados, llaves: obtenerLlaves() };
}

/** Lo que se puede revisar sin tocar la BD va primero (firma, vencimiento, tramo). */
async function procesarCobro(contexto, local) {
  const boleto = leerBoleto(local.raw, contexto.llaves.publica);
  if (!boleto) return rechazado(null, CODIGOS_ERROR.BOLETO_INVALIDO);

  const { bid } = boleto;
  if (boleto.expira <= aSegundos(local.ocurridoEn) - BOLETO.TOLERANCIA_RELOJ_SEG) {
    return rechazado(bid, CODIGOS_ERROR.BOLETO_VENCIDO);
  }
  const tramo = contexto.linea.tramos.find((t) => t.codigo === local.tramoCodigo);
  if (!tramo) return rechazado(bid, CODIGOS_ERROR.TRAMO_INVALIDO);

  const resultado = await conTransaccion((cliente) =>
    registrarUso(cliente, {
      bid,
      origen: 'recolector',
      recolectorId: contexto.recolector.id,
      unidad: contexto.unidad,
      linea: contexto.linea,
      tramo,
      tabuladores: contexto.tabuladores,
      feriados: contexto.feriados,
      montoReportado: local.monto,
      metodo: local.metodo,
      ocurridoEn: local.ocurridoEn,
    }),
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

/**
 * Anula un cobro propio de hace menos de 2 minutos (botón "Corregir").
 * El boleto vuelve a quedar activo con su reserva completa, listo para cobrarse con otro tramo.
 * @param {object} recolector fila de BD
 * @param {string} bid
 * @throws {ErrorApp} NO_ENCONTRADO si no hay un cobro suyo con ese bid; CONFLICTO si ya pasó la ventana
 */
export async function anularCobro(recolector, bid) {
  await conTransaccion(async (cliente) => {
    const { boleto, cobro } = await cobros.bloquearBoletoConCobro(cliente, bid);
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
