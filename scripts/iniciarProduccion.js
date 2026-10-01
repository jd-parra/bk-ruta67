// Prepara una BD de producción recién migrada, sin los usuarios de prueba de la semilla:
//   1. crea la cuenta de la central (si ese teléfono no existe)
//   2. carga tabulador, feriados y líneas del §13 solo si todavía no hay tabuladores
//
//   node --env-file=.env.produccion scripts/iniciarProduccion.js \
//     --nombre "Central Mérida" --telefono 0414XXXXXXX --clave "una-clave-larga"
//
// Es seguro correrlo dos veces: no duplica nada.
import { parseArgs } from 'node:util';
import { conTransaccion, pool } from '../src/bd/pool.js';
import { FERIADOS_SEMILLA, LINEAS_SEMILLA, TABULADOR_SEMILLA } from '../src/bd/datosSemilla.js';
import { insertarFeriados, insertarLineas, insertarTabulador } from '../src/bd/semilla.js';
import { hashearClave } from '../src/modulos/auth/servicio.js';

const LARGO_MINIMO_CLAVE = 10;
const TELEFONO_VALIDO = /^04\d{9}$/;

const { values: datos } = parseArgs({
  options: {
    nombre: { type: 'string', default: 'Central Mérida' },
    telefono: { type: 'string' },
    clave: { type: 'string' },
  },
});

function validar({ telefono, clave }) {
  if (!telefono || !TELEFONO_VALIDO.test(telefono)) {
    throw new Error('--telefono: 11 dígitos empezando por 04');
  }
  if (!clave || clave.length < LARGO_MINIMO_CLAVE) {
    throw new Error(`--clave: mínimo ${LARGO_MINIMO_CLAVE} caracteres`);
  }
}

async function crearCentral(cliente, { nombre, telefono, claveHash }) {
  const { rowCount } = await cliente.query(
    `INSERT INTO pasaje.usuarios (nombre, telefono, clave_hash, rol)
     VALUES ($1, $2, $3, 'central')
     ON CONFLICT (telefono) DO NOTHING`,
    [nombre, telefono, claveHash],
  );
  return rowCount > 0;
}

async function cargarTarifasYLineas(cliente) {
  const { rows } = await cliente.query('SELECT count(*)::int AS n FROM pasaje.tabuladores');
  if (rows[0].n > 0) return false;
  await insertarTabulador(cliente, TABULADOR_SEMILLA);
  await insertarFeriados(cliente, FERIADOS_SEMILLA);
  await insertarLineas(cliente, LINEAS_SEMILLA);
  return true;
}

async function iniciar() {
  validar(datos);
  const claveHash = await hashearClave(datos.clave);
  const resultado = await conTransaccion(async (cliente) => ({
    central: await crearCentral(cliente, { ...datos, claveHash }),
    tarifas: await cargarTarifasYLineas(cliente),
  }));
  console.log(
    resultado.central
      ? `Central creada: ${datos.telefono}`
      : `La cuenta ${datos.telefono} ya existía`,
  );
  console.log(
    resultado.tarifas
      ? 'Tabulador, feriados y líneas cargados (revísalos en el panel)'
      : 'Ya había tabulador: no se tocaron tarifas ni líneas',
  );
}

iniciar()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
