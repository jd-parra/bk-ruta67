// Borra todos los datos y carga la semilla del §13 del contrato.
//   npm run bd:semilla
// Se niega a correr en producción.
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { config } from '../config/index.js';
import { conTransaccion, pool } from './pool.js';
import {
  FERIADOS_SEMILLA,
  LINEAS_SEMILLA,
  TABULADOR_SEMILLA,
  UNIDADES_SEMILLA,
  USUARIOS_SEMILLA,
} from './datosSemilla.js';

const COSTO_BCRYPT = 10;
const TABLAS = [
  'avisos',
  'ubicaciones_unidad',
  'movimientos',
  'conflictos',
  'cobros',
  'boletos',
  'unidades',
  'tramos',
  'lineas',
  'feriados',
  'tabuladores',
  'recargas',
  'billeteras',
  'usuarios',
];

/**
 * Vacía las tablas y carga la semilla, todo en una transacción.
 * @returns {Promise<void>}
 * @throws {Error} en producción
 */
export async function sembrar() {
  if (config.entorno === 'production') throw new Error('La semilla no se corre en producción');

  const usuariosConHash = await Promise.all(
    USUARIOS_SEMILLA.map(async (u) => ({
      ...u,
      claveHash: await bcrypt.hash(u.clave, COSTO_BCRYPT),
    })),
  );

  await conTransaccion(async (cliente) => {
    await cliente.query(`TRUNCATE ${TABLAS.map((t) => `pasaje.${t}`).join(', ')} CASCADE`);
    await insertarUsuarios(cliente, usuariosConHash);
    await insertarTabulador(cliente, TABULADOR_SEMILLA);
    await insertarFeriados(cliente, FERIADOS_SEMILLA);
    const idsLineas = await insertarLineas(cliente, LINEAS_SEMILLA);
    await insertarUnidades(cliente, UNIDADES_SEMILLA, idsLineas);
  });
}

async function insertarUsuarios(cliente, usuarios) {
  for (const u of usuarios) {
    await cliente.query(
      `INSERT INTO pasaje.usuarios
         (id, nombre, telefono, clave_hash, rol, categoria, categoria_verificada)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        u.id,
        u.nombre,
        u.telefono,
        u.claveHash,
        u.rol,
        u.categoria ?? 'general',
        u.categoriaVerificada ?? false,
      ],
    );
    if (u.rol === 'pasajero') {
      await cliente.query('INSERT INTO pasaje.billeteras (usuario_id) VALUES ($1)', [u.id]);
    }
  }
}

async function insertarTabulador(cliente, t) {
  await cliente.query(
    `INSERT INTO pasaje.tabuladores
       (fuente, vigente_desde, descuentos, recargo_domingo_feriado, urbano_minimo, suburbano)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      t.fuente,
      t.vigenteDesde,
      JSON.stringify(t.descuentos),
      t.recargoDomingoFeriado,
      t.urbanoMinimo,
      JSON.stringify(t.suburbano),
    ],
  );
}

async function insertarFeriados(cliente, feriados) {
  for (const { fecha, nombre } of feriados) {
    await cliente.query('INSERT INTO pasaje.feriados (fecha, nombre) VALUES ($1, $2)', [
      fecha,
      nombre,
    ]);
  }
}

/** @returns {Promise<Map<number, string>>} código de línea → id */
async function insertarLineas(cliente, lineas) {
  const ids = new Map();
  for (const linea of lineas) {
    const { rows } = await cliente.query(
      'INSERT INTO pasaje.lineas (codigo, nombre, tipo) VALUES ($1, $2, $3) RETURNING id',
      [linea.codigo, linea.nombre, linea.tipo],
    );
    ids.set(linea.codigo, rows[0].id);
    for (const tramo of linea.tramos) {
      await cliente.query(
        'INSERT INTO pasaje.tramos (linea_id, codigo, nombre, km) VALUES ($1, $2, $3, $4)',
        [rows[0].id, tramo.codigo, tramo.nombre, tramo.km],
      );
    }
  }
  return ids;
}

async function insertarUnidades(cliente, unidades, idsLineas) {
  for (const unidad of unidades) {
    const recolector = USUARIOS_SEMILLA.find((u) => u.telefono === unidad.recolector);
    await cliente.query(
      `INSERT INTO pasaje.unidades (codigo, placa, linea_id, recolector_id)
       VALUES ($1, $2, $3, $4)`,
      [unidad.codigo, unidad.placa, idsLineas.get(unidad.linea), recolector.id],
    );
  }
}

const esLlamadaDirecta = process.argv[1] === fileURLToPath(import.meta.url);
if (esLlamadaDirecta) {
  sembrar()
    .then(() => console.log('Semilla cargada'))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
