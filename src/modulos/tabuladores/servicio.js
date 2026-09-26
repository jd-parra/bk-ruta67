import { CODIGOS_ERROR } from '../../../shared/codigos.js';
import { fechaVenezuela, tabuladorVigente } from '../../../shared/tarifa.js';
import { pool } from '../../bd/pool.js';
import { memoizar } from '../../utils/cache.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import * as repositorio from './repositorio.js';
import { serializarTabulador } from './serializadores.js';

const DIAS_FERIADOS_PASADOS = 7;
const TTL_MS = 60_000;

const cacheTabuladores = memoizar(
  async () => (await repositorio.listar(pool)).map(serializarTabulador),
  TTL_MS,
);
const cacheFeriados = memoizar(() => {
  const desde = new Date(Date.now() - DIAS_FERIADOS_PASADOS * 24 * 60 * 60 * 1000);
  return repositorio.listarFeriados(pool, fechaVenezuela(desde).fecha);
}, TTL_MS);

/**
 * Todos los tabuladores en forma de contrato. Con el pool usa la caché; dentro de una
 * transacción consulta directo (para ver lo que la transacción aún no confirmó).
 * @param {import('pg').Pool | import('pg').PoolClient} [bd]
 */
export async function listarTodos(bd = pool) {
  if (bd === pool) return cacheTabuladores.obtener();
  return (await repositorio.listar(bd)).map(serializarTabulador);
}

/**
 * Tabulador vigente y el próximo (si ya hay uno cargado a futuro), en forma de contrato.
 * @param {import('pg').Pool | import('pg').PoolClient} [bd]
 * @param {Date} [ahora]
 * @returns {Promise<{ tabulador: object, proximo: object | null, todos: object[] }>}
 * @throws {ErrorApp} si no hay ningún tabulador vigente
 */
export async function vigenteYProximo(bd = pool, ahora = new Date()) {
  const todos = await listarTodos(bd);
  const tabulador = tabuladorVigente(todos, ahora);
  if (!tabulador) {
    throw new ErrorApp(CODIGOS_ERROR.ERROR_INTERNO, 'No hay un tabulador vigente cargado', {
      estado: 503,
    });
  }
  const futuros = todos.filter((t) => new Date(t.vigenteDesde) > ahora);
  const proximo = futuros.at(-1) ?? null; // la lista viene de más nuevo a más viejo
  return { tabulador, proximo, todos };
}

/**
 * Tabulador que aplicaba en un instante dado (para cobros sincronizados tarde).
 * @param {object[]} todos tabuladores en forma de contrato
 * @param {Date | string} instante
 */
export function vigenteEn(todos, instante) {
  return tabuladorVigente(todos, instante);
}

/** Feriados desde hace una semana (sirven para cobros offline recientes). */
export function feriadosRecientes() {
  return cacheFeriados.obtener();
}
