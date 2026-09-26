// Respaldo y restauración de todos los datos del esquema `pasaje` en un JSON.
// Supabase gratis no hace backups, y pg_dump no funciona por el Transaction pooler.
import { conTransaccion } from './pool.js';

// En orden de dependencias: cada tabla solo referencia a las anteriores.
export const TABLAS = [
  'usuarios',
  'billeteras',
  'recargas',
  'tabuladores',
  'feriados',
  'lineas',
  'tramos',
  'unidades',
  'boletos',
  'cobros',
  'conflictos',
  'movimientos',
  'ubicaciones_unidad',
  'avisos',
];

const VERSION_FORMATO = 1;

/**
 * Lee todas las tablas en una sola transacción (una foto consistente).
 * @returns {Promise<{ formato: number, creadoEn: string, tablas: Record<string, object[]> }>}
 */
export async function crearRespaldo() {
  const tablas = await conTransaccion(async (cliente) => {
    await cliente.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const resultado = {};
    for (const tabla of TABLAS) {
      // row_to_json conserva los tipos tal cual (fechas ISO, jsonb, arreglos).
      const { rows } = await cliente.query(
        `SELECT coalesce(json_agg(row_to_json(t)), '[]') AS filas FROM pasaje.${tabla} t`,
      );
      resultado[tabla] = rows[0].filas;
    }
    return resultado;
  });
  return { formato: VERSION_FORMATO, creadoEn: new Date().toISOString(), tablas };
}

/**
 * Reemplaza TODOS los datos por los del respaldo, en una transacción (todo o nada).
 * @param {{ formato: number, tablas: Record<string, object[]> }} respaldo
 * @returns {Promise<Record<string, number>>} filas restauradas por tabla
 * @throws {Error} si el formato no es el esperado
 */
export async function restaurarRespaldo(respaldo) {
  if (respaldo?.formato !== VERSION_FORMATO || !respaldo.tablas) {
    throw new Error('El archivo no es un respaldo de Pasaje válido');
  }
  return conTransaccion(async (cliente) => {
    await cliente.query(`TRUNCATE ${TABLAS.map((t) => `pasaje.${t}`).join(', ')} CASCADE`);
    const conteo = {};
    for (const tabla of TABLAS) {
      const filas = respaldo.tablas[tabla] ?? [];
      await cliente.query(
        `INSERT INTO pasaje.${tabla}
         SELECT * FROM json_populate_recordset(NULL::pasaje.${tabla}, $1::json)`,
        [JSON.stringify(filas)],
      );
      conteo[tabla] = filas.length;
    }
    return conteo;
  });
}
