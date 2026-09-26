import { CODIGOS_ERROR } from '../../../shared/codigos.js';
import { fechaVenezuela, tabuladorVigente } from '../../../shared/tarifa.js';
import { pool } from '../../bd/pool.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import * as repositorio from './repositorio.js';
import { serializarTabulador } from './serializadores.js';

const DIAS_FERIADOS_PASADOS = 7;

/**
 * Tabulador vigente y el próximo (si ya hay uno cargado a futuro), en forma de contrato.
 * @param {import('pg').Pool | import('pg').PoolClient} [bd]
 * @param {Date} [ahora]
 * @returns {Promise<{ tabulador: object, proximo: object | null, todos: object[] }>}
 * @throws {ErrorApp} si no hay ningún tabulador vigente
 */
export async function vigenteYProximo(bd = pool, ahora = new Date()) {
  const todos = (await repositorio.listar(bd)).map(serializarTabulador);
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
export async function feriadosRecientes(bd = pool, ahora = new Date()) {
  const desde = new Date(ahora.getTime() - DIAS_FERIADOS_PASADOS * 24 * 60 * 60 * 1000);
  return repositorio.listarFeriados(bd, fechaVenezuela(desde).fecha);
}
