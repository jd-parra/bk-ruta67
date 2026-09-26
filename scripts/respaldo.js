// Respaldo de la BD de .env (Supabase) en respaldos/pasaje-<fecha>.json
//   npm run bd:respaldo
//   npm run bd:restaurar -- respaldos/pasaje-2026-09-26T10-00.json --confirmar
// ⚠️ El archivo incluye datos personales y hashes de claves: no lo subas a git ni lo compartas.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { pool } from '../src/bd/pool.js';
import { crearRespaldo, restaurarRespaldo } from '../src/bd/respaldo.js';

const CARPETA = new URL('../respaldos/', import.meta.url);

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { restaurar: { type: 'boolean' }, confirmar: { type: 'boolean' } },
});

async function respaldar() {
  const respaldo = await crearRespaldo();
  const nombre = `pasaje-${respaldo.creadoEn.slice(0, 16).replace(':', '-')}.json`;
  mkdirSync(CARPETA, { recursive: true });
  writeFileSync(new URL(nombre, CARPETA), JSON.stringify(respaldo));
  const filas = Object.values(respaldo.tablas).reduce((suma, t) => suma + t.length, 0);
  console.log(`Respaldo guardado en respaldos/${nombre} (${filas} filas)`);
}

async function restaurar() {
  const [archivo] = positionals;
  if (!archivo)
    throw new Error('Indica el archivo: npm run bd:restaurar -- respaldos/<archivo>.json');
  if (!values.confirmar) {
    throw new Error(
      `Esto BORRA todos los datos actuales y los reemplaza por ${archivo}. Agrega --confirmar`,
    );
  }
  const conteo = await restaurarRespaldo(JSON.parse(readFileSync(archivo, 'utf8')));
  console.log('Restaurado:', conteo);
}

(values.restaurar ? restaurar() : respaldar())
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
