import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { crearRespaldo, restaurarRespaldo, TABLAS } from '../src/bd/respaldo.js';
import { pool } from '../src/bd/pool.js';
import { prepararBd } from './ayudantes/bd.js';
import { como, TEL, verificarLibro } from './ayudantes/api.js';

before(async () => {
  await prepararBd();
  await como(TEL.ANA).post('/recargas', { monto: 50000, metodo: 'simulada' });
  const [boleto] = (await como(TEL.ANA).post('/boletos', { cantidad: 2 })).body.boletos;
  await como(TEL.LUIS).post('/sync/cobros', {
    cobros: [
      {
        raw: boleto.raw,
        tramoCodigo: 1,
        monto: 10000,
        metodo: 'nfc',
        ocurridoEn: new Date().toISOString(),
      },
    ],
  });
});
after(() => pool.end());

const contar = async () => {
  const conteo = {};
  for (const tabla of TABLAS) {
    conteo[tabla] = (await pool.query(`SELECT count(*)::int AS n FROM pasaje.${tabla}`)).rows[0].n;
  }
  return conteo;
};

test('respaldar, romper todo y restaurar deja la BD exactamente igual', async () => {
  const antes = await contar();
  const saldoAntes = (await como(TEL.ANA).get('/billetera')).body;
  const respaldo = JSON.parse(JSON.stringify(await crearRespaldo())); // como si viniera de un archivo

  await pool.query('TRUNCATE pasaje.cobros, pasaje.movimientos CASCADE');
  await pool.query('UPDATE pasaje.billeteras SET saldo_disponible = 0');

  const restauradas = await restaurarRespaldo(respaldo);
  assert.deepEqual(restauradas, antes);
  assert.deepEqual(await contar(), antes);
  assert.deepEqual((await como(TEL.ANA).get('/billetera')).body, saldoAntes);
  await verificarLibro();
});

test('rechaza un archivo que no es un respaldo', async () => {
  await assert.rejects(restaurarRespaldo({ hola: 1 }), /no es un respaldo/);
});
