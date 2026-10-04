// Aumento de pasaje: los boletos emitidos antes no deben dejar al pasajero sin poder pagar (§8.2).
// Las pruebas de este archivo corren en orden y comparten estado.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/bd/pool.js';
import { invalidarCaches } from '../src/utils/cache.js';
import { prepararBd } from './ayudantes/bd.js';
import { como, espiarEventos, TEL, verificarLibro } from './ayudantes/api.js';

const eventos = espiarEventos();

before(prepararBd);
after(() => pool.end());

// Semilla: lo más caro de la red es 28.000 (suburbano ≤ 10 km); Ana es estudiante (50 %).
const RESERVA_ANTES = 14000;
// Aumento: suburbano ≤ 10 km pasa a 35.000 → 17.500 para estudiante.
const RESERVA_DESPUES = 17500;

const aumento = {
  fuente: 'Gaceta Oficial N° 44.000',
  vigenteDesde: '2099-01-01T04:00:00Z',
  descuentos: { general: 0, estudiante: 0.5, exonerado: 0.5 },
  recargoDomingoFeriado: 0,
  urbanoMinimo: 25000,
  suburbano: [
    { hastaKm: 10, monto: 35000 },
    { hastaKm: 9999, monto: 120000 },
  ],
};

let viejos;

describe('boletos y aumento de pasaje', () => {
  test('antes del aumento, Ana recibe 5 boletos con la reserva de hoy', async () => {
    assert.equal(
      (await como(TEL.ANA).post('/recargas', { monto: 100000, metodo: 'simulada' })).status,
      201,
    );
    const res = await como(TEL.ANA).post('/boletos', {});
    assert.equal(res.status, 201);
    assert.equal(res.body.boletos.length, 5);
    assert.ok(res.body.boletos.every((b) => b.montoReservado === RESERVA_ANTES));
    viejos = res.body.boletos.map((b) => b.bid);
  });

  test('con un aumento anunciado, al renovar se cambian por boletos que cubren el pasaje nuevo', async () => {
    assert.equal((await como(TEL.CENTRAL).post('/central/tabuladores', aumento)).status, 201);
    invalidarCaches();
    eventos.length = 0;

    const res = await como(TEL.ANA).post('/boletos', {});
    assert.equal(res.status, 201);
    assert.equal(res.body.boletos.length, 5);
    assert.ok(res.body.boletos.every((b) => b.montoReservado === RESERVA_DESPUES));

    // Mismo dinero, otra reserva: 100.000 = 5 × 17.500 apartados + 12.500 libres.
    assert.equal(res.body.billetera.saldoReservado, 5 * RESERVA_DESPUES);
    assert.equal(res.body.billetera.saldoDisponible, 100000 - 5 * RESERVA_DESPUES);
    assert.equal(res.body.billetera.boletosActivos, 5);

    const activos = (await como(TEL.ANA).get('/boletos')).body.map((b) => b.bid);
    assert.ok(
      viejos.every((bid) => !activos.includes(bid)),
      'los viejos ya no están activos',
    );
  });

  test('los viejos quedan revocados para los recolectores y se les avisa', async () => {
    assert.ok(eventos.some((e) => e.evento === 'paquete:actualizado'));
    const paquete = await como(TEL.LUIS).get('/recolector/paquete');
    assert.ok(viejos.every((bid) => paquete.body.revocados.includes(bid)));
  });

  test('renovar otra vez no cambia nada: los boletos nuevos ya alcanzan', async () => {
    eventos.length = 0;
    const res = await como(TEL.ANA).post('/boletos', {});
    assert.equal(res.status, 201);
    assert.deepEqual(res.body.boletos, []);
    assert.ok(!eventos.some((e) => e.evento === 'paquete:actualizado'));
  });

  test('sin saldo para ni un boleto nuevo, conserva los viejos', async () => {
    // Pedro recarga lo justo para 1 boleto de hoy (28.000), pero no para uno con el aumento (35.000).
    await pool.query(`DELETE FROM pasaje.tabuladores WHERE fuente = $1`, [aumento.fuente]);
    invalidarCaches();
    await como(TEL.PEDRO).post('/recargas', { monto: 28000, metodo: 'simulada' });
    const antes = await como(TEL.PEDRO).post('/boletos', { cantidad: 1 });
    assert.equal(antes.body.boletos.length, 1);

    assert.equal((await como(TEL.CENTRAL).post('/central/tabuladores', aumento)).status, 201);
    invalidarCaches();
    const res = await como(TEL.PEDRO).post('/boletos', {});
    assert.equal(res.status, 422);
    assert.equal(res.body.error.codigo, 'SALDO_INSUFICIENTE');

    const activos = (await como(TEL.PEDRO).get('/boletos')).body;
    assert.deepEqual(
      activos.map((b) => b.bid),
      antes.body.boletos.map((b) => b.bid),
    );
  });

  test('el libro cuadra', verificarLibro);
});
