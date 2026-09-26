import { pool } from '../../bd/pool.js';
import { memoizar } from '../../utils/cache.js';
import { vigenteYProximo } from '../tabuladores/servicio.js';
import * as repositorio from './repositorio.js';
import { serializarLinea } from './serializadores.js';

const TTL_MS = 60_000;

// Para calcular tarifas y cobrar. La `frecuencia` de esta copia puede estar desactualizada:
// quien la muestre (/lineas, paquete) consulta en vivo.
const cacheLineas = memoizar(() => repositorio.listarConTramos(pool), TTL_MS);

/**
 * Todas las líneas con la tarifa de cada tramo según el tabulador vigente (frecuencia en vivo).
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
 * Con el pool usa la caché; dentro de una transacción consulta directo.
 * @returns {Promise<{ id: string, codigo: number, tipo: string, tramos: object[] }[]>}
 */
export async function lineasParaTarifas(bd = pool) {
  return bd === pool ? cacheLineas.obtener() : repositorio.listarConTramos(bd);
}

/**
 * Una línea con sus tramos, desde la caché (para cobrar).
 * @param {string} lineaId
 * @returns {Promise<object | null>}
 */
export async function lineaParaCobrar(lineaId) {
  const enCache = (await cacheLineas.obtener()).find((l) => l.id === lineaId);
  if (enCache) return enCache;
  cacheLineas.invalidar(); // puede ser una línea recién creada
  return (await cacheLineas.obtener()).find((l) => l.id === lineaId) ?? null;
}
