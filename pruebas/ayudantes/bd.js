// Deja la BD de pruebas migrada y con la semilla recién cargada.
import { migrar } from '../../src/bd/migrar.js';
import { sembrar } from '../../src/bd/semilla.js';

/** @returns {Promise<void>} */
export async function prepararBd() {
  await migrar({ silencioso: true });
  await sembrar();
}
