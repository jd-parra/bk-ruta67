import { pool } from '../../bd/pool.js';
import { vigenteYProximo } from '../tabuladores/servicio.js';
import * as repositorio from './repositorio.js';
import { serializarLinea } from './serializadores.js';

/**
 * Todas las líneas con la tarifa de cada tramo según el tabulador vigente.
 * @returns {Promise<object[]>} Linea[] del contrato
 */
export async function listarLineas(bd = pool) {
  const [{ tabulador }, filas] = await Promise.all([
    vigenteYProximo(bd),
    repositorio.listarConTramos(bd),
  ]);
  return filas.map((fila) => serializarLinea(fila, tabulador));
}

/**
 * Líneas en la forma que necesita shared/tarifa.tarifaMaximaRed.
 * @returns {Promise<{ tipo: string, tramos: object[] }[]>}
 */
export async function lineasParaTarifas(bd = pool) {
  return repositorio.listarConTramos(bd);
}
