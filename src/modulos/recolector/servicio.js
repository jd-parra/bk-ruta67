import { CODIGOS_ERROR } from '../../../shared/codigos.js';
import { pool } from '../../bd/pool.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import { inicioDeHoyVenezuela } from '../../utils/fechas.js';
import { obtenerLlaves } from '../../utils/llaves.js';
import { listarBidsRevocados } from '../boletos/repositorio.js';
import * as cobros from '../cobros/repositorio.js';
import { serializarCobro } from '../cobros/serializadores.js';
import * as lineas from '../lineas/repositorio.js';
import { serializarLinea } from '../lineas/serializadores.js';
import { feriadosRecientes, vigenteYProximo } from '../tabuladores/servicio.js';
import * as unidades from '../unidades/repositorio.js';
import { serializarUnidad } from '../unidades/serializadores.js';

/**
 * Unidad del recolector o error si no tiene una asignada.
 * @throws {ErrorApp} NO_ENCONTRADO
 */
export async function unidadDelRecolector(recolectorId, bd = pool) {
  const unidad = await unidades.buscarPorRecolector(bd, recolectorId);
  if (!unidad) {
    throw new ErrorApp(
      CODIGOS_ERROR.NO_ENCONTRADO,
      'No tienes una unidad asignada. Pide a la central que te asigne una',
    );
  }
  return unidad;
}

/**
 * Todo lo que el recolector necesita para cobrar sin conexión (§6.3).
 * @param {object} recolector fila de BD
 */
export async function armarPaquete(recolector) {
  const unidad = await unidadDelRecolector(recolector.id);
  const [{ tabulador, proximo }, linea, feriados, revocados] = await Promise.all([
    vigenteYProximo(pool),
    lineas.buscarConTramos(pool, unidad.linea_id),
    feriadosRecientes(pool),
    listarBidsRevocados(pool),
  ]);
  return {
    llavePublica: obtenerLlaves().publicaBase64url,
    unidad: serializarUnidad(unidad),
    linea: serializarLinea(linea, tabulador, { porFrecuencia: true }),
    tabulador,
    tabuladorProximo: proximo,
    feriados,
    revocados,
    generadoEn: new Date().toISOString(),
  };
}

/**
 * Cobros del recolector en [desde, hasta) (por defecto, desde el inicio de hoy en Venezuela y sin límite).
 * @param {object} recolector fila de BD
 * @param {Date} [desde]
 * @param {Date} [hasta] exclusivo
 */
export async function cobrosDelRecolector(recolector, desde = inicioDeHoyVenezuela(), hasta = null) {
  const filas = await cobros.listarPorRecolector(pool, recolector.id, desde, hasta);
  const lista = filas.map(serializarCobro);
  return {
    total: lista.reduce((suma, c) => suma + c.monto, 0),
    cantidad: lista.length,
    cobros: lista,
  };
}
