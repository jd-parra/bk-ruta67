// Corre las migraciones con la misma configuración que la app (SSL, BD de pruebas en modo test).
//   npm run bd:migrar          → aplica las pendientes
//   npm run bd:revertir        → revierte la última
import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import { config } from '../config/index.js';
import { ESQUEMA } from './esquema.js';

const CARPETA_MIGRACIONES = fileURLToPath(new URL('./migraciones', import.meta.url));

/**
 * Aplica o revierte migraciones.
 * @param {{ direccion?: 'up' | 'down', cantidad?: number, silencioso?: boolean }} [opciones]
 * @returns {Promise<void>}
 */
export async function migrar({ direccion = 'up', cantidad = Infinity, silencioso = false } = {}) {
  await runner({
    databaseUrl: {
      connectionString: config.bd.url,
      ssl: config.bd.ssl ? { rejectUnauthorized: false } : false,
    },
    dir: CARPETA_MIGRACIONES,
    direction: direccion,
    count: cantidad,
    schema: ESQUEMA,
    createSchema: true,
    migrationsSchema: ESQUEMA,
    migrationsTable: 'migraciones',
    // El lock de node-pg-migrate es de sesión y no funciona con el Transaction pooler.
    noLock: true,
    checkOrder: true,
    log: silencioso ? () => {} : console.log,
  });
}

const esLlamadaDirecta = process.argv[1] === fileURLToPath(import.meta.url);
if (esLlamadaDirecta) {
  const direccion = process.argv[2] === 'down' ? 'down' : 'up';
  migrar({ direccion, cantidad: direccion === 'down' ? 1 : Infinity })
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
