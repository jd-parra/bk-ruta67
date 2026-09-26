import pg from 'pg';
import { config } from '../config/index.js';

// BIGINT (int8) llega como string por defecto; los montos en céntimos caben en Number.
pg.types.setTypeParser(pg.types.builtins.INT8, (valor) => Number(valor));
// NUMERIC (km, recargos, descuentos) como número.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (valor) => Number(valor));

export const pool = new pg.Pool({
  connectionString: config.bd.url,
  ssl: config.bd.ssl ? { rejectUnauthorized: false } : false,
  max: 10,
});

/**
 * Corre `fn` dentro de una transacción. Hace COMMIT si termina bien y ROLLBACK si lanza.
 * @template T
 * @param {(cliente: pg.PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function conTransaccion(fn) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const resultado = await fn(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (error) {
    await cliente.query('ROLLBACK');
    throw error;
  } finally {
    cliente.release();
  }
}
