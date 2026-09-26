import pg from 'pg';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

// BIGINT (int8) llega como string por defecto; los montos en céntimos caben en Number.
pg.types.setTypeParser(pg.types.builtins.INT8, (valor) => Number(valor));
// NUMERIC (km, recargos, descuentos) como número.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (valor) => Number(valor));

const CONEXIONES_MAX = 10;
const CONEXIONES_TIBIAS = 4;

export const pool = new pg.Pool({
  connectionString: config.bd.url,
  ssl: config.bd.ssl ? { rejectUnauthorized: false } : false,
  max: CONEXIONES_MAX,
  // Abrir una conexión a Supabase cuesta ~1,4 s (TLS hasta Virginia). Por defecto pg cierra
  // las conexiones tras 10 s sin uso; así casi cada petición pagaba ese costo. Las dejamos abiertas.
  idleTimeoutMillis: 0,
  keepAlive: true,
});

// Si Supabase corta una conexión inactiva, pg la descarta y abre otra; solo lo registramos.
pool.on('error', (error) =>
  logger.warn({ err: error }, 'conexión a la BD cerrada por el servidor'),
);

/**
 * Abre varias conexiones al arrancar, para que las primeras peticiones no paguen el TLS.
 * @returns {Promise<void>}
 */
export async function calentarPool() {
  const clientes = await Promise.all(
    Array.from({ length: CONEXIONES_TIBIAS }, () => pool.connect()),
  );
  clientes.forEach((cliente) => cliente.release());
}

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
