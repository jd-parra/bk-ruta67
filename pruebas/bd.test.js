import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/bd/pool.js';
import { prepararBd } from './ayudantes/bd.js';

before(prepararBd);
after(() => pool.end());

const contar = async (tabla) =>
  (await pool.query(`SELECT count(*)::int AS n FROM pasaje.${tabla}`)).rows[0].n;

test('la semilla carga usuarios, líneas, tramos, unidades y tabulador', async () => {
  assert.equal(await contar('usuarios'), 6);
  assert.equal(await contar('billeteras'), 3); // solo pasajeros
  assert.equal(await contar('lineas'), 3);
  assert.equal(await contar('tramos'), 5);
  assert.equal(await contar('unidades'), 2);
  assert.equal(await contar('tabuladores'), 1);
});

test('unidad 101 en la línea 1 con Luis y 102 en la línea 3 con Marta', async () => {
  const { rows } = await pool.query(`
    SELECT un.codigo, l.codigo AS linea, us.nombre
    FROM pasaje.unidades un
    JOIN pasaje.lineas l ON l.id = un.linea_id
    JOIN pasaje.usuarios us ON us.id = un.recolector_id
    ORDER BY un.codigo`);
  assert.deepEqual(rows, [
    { codigo: 101, linea: 1, nombre: 'Luis Recolector' },
    { codigo: 102, linea: 3, nombre: 'Marta Recolectora' },
  ]);
});

test('las claves se guardan con bcrypt, nunca en texto plano', async () => {
  const { rows } = await pool.query('SELECT clave_hash FROM pasaje.usuarios');
  for (const { clave_hash: hash } of rows) assert.match(hash, /^\$2[aby]\$10\$/);
});

test('ninguna tabla queda en el esquema public', async () => {
  const { rows } = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name IN ('usuarios', 'billeteras', 'cobros')`,
  );
  assert.deepEqual(rows, []);
});

test('movimientos es solo inserción', async () => {
  const usuarioId = '00000000-0000-4000-8000-000000000001';
  const { rows } = await pool.query(
    `INSERT INTO pasaje.movimientos (usuario_id, tipo, monto, saldo_disponible_despues)
     VALUES ($1, 'recarga', 100, 100) RETURNING id`,
    [usuarioId],
  );
  await assert.rejects(
    pool.query('UPDATE pasaje.movimientos SET monto = 1 WHERE id = $1', [rows[0].id]),
    /solo inserción/,
  );
  await assert.rejects(
    pool.query('DELETE FROM pasaje.movimientos WHERE id = $1', [rows[0].id]),
    /solo inserción/,
  );
});

test('el saldo no puede quedar negativo', async () => {
  await assert.rejects(
    pool.query(
      `UPDATE pasaje.billeteras SET saldo_disponible = -1
       WHERE usuario_id = '00000000-0000-4000-8000-000000000001'`,
    ),
    /check constraint/,
  );
});

test('los códigos cortos llegan hasta 65535 y no más', async () => {
  await pool.query(
    `INSERT INTO pasaje.lineas (codigo, nombre, tipo) VALUES (65535, 'Máxima', 'urbana')`,
  );
  await assert.rejects(
    pool.query(`INSERT INTO pasaje.lineas (codigo, nombre, tipo) VALUES (65536, 'X', 'urbana')`),
    /check constraint/,
  );
});
