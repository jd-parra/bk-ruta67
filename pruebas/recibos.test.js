// Fase 2: recibos del pasajero (§6.4) y rutas frecuentes (§6.2).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/bd/pool.js';
import { prepararBd } from './ayudantes/bd.js';
import { como, espiarEventos, TEL, verificarLibro } from './ayudantes/api.js';

const eventos = espiarEventos();

before(async () => {
  await prepararBd();
  await como(TEL.ANA).post('/recargas', { monto: 100000, metodo: 'simulada' });
});
after(() => pool.end());

let segundos = Math.floor(Date.now() / 1000) - 600;
/** Un instante distinto por viaje, en segundo exacto (como viaja en el recibo NFC). */
const nuevoInstante = () => new Date(++segundos * 1000).toISOString();

const pedirBoleto = async () =>
  (await como(TEL.ANA).post('/boletos', { cantidad: 1 })).body.boletos[0];

const recibo = (boleto, ocurridoEn, extra = {}) => ({
  bid: boleto.bid,
  lineaCodigo: 1,
  unidadCodigo: 101,
  tramoCodigo: 1,
  monto: 10000,
  ocurridoEn,
  ...extra,
});
const subirRecibos = (...recibos) => como(TEL.ANA).post('/sync/recibos', { recibos });
const cobroLuis = (boleto, ocurridoEn) =>
  como(TEL.LUIS).post('/sync/cobros', {
    cobros: [{ raw: boleto.raw, tramoCodigo: 1, monto: 10000, metodo: 'nfc', ocurridoEn }],
  });

describe('el recibo llega primero', () => {
  let boleto;
  let instante;

  test('crea el cobro, con Luis (dueño de la unidad 101) como recolector', async () => {
    boleto = await pedirBoleto();
    instante = nuevoInstante();
    eventos.length = 0;
    const res = await subirRecibos(recibo(boleto, instante));
    assert.equal(res.status, 200);
    const [resultado] = res.body.resultados;
    assert.equal(resultado.estado, 'ok');
    assert.equal(resultado.cobro.monto, 10000);
    assert.equal(resultado.cobro.unidadCodigo, 101);
    assert.deepEqual(resultado.cobro.confirmadoPor, ['pasajero']);
    assert.ok(eventos.some((e) => e.evento === 'cobro:confirmado'));

    const deLuis = await como(TEL.LUIS).get(`/recolector/cobros?desde=${instante}`);
    assert.equal(deLuis.body.cantidad, 1);
  });

  test('el cobro de Luis que llega después solo lo confirma (sin cobrar dos veces)', async () => {
    const saldoAntes = (await como(TEL.ANA).get('/billetera')).body.saldoDisponible;
    const conMs = new Date(Date.parse(instante) + 700).toISOString();
    const res = await cobroLuis(boleto, conMs);
    const [resultado] = res.body.resultados;
    assert.equal(resultado.estado, 'ok');
    assert.deepEqual(resultado.cobro.confirmadoPor, ['pasajero', 'recolector']);
    const saldoDespues = (await como(TEL.ANA).get('/billetera')).body.saldoDisponible;
    assert.equal(saldoDespues, saldoAntes);
  });

  test('reenviar cualquiera de los dos → duplicado', async () => {
    const otraVezRecibo = await subirRecibos(recibo(boleto, instante));
    const otraVezCobro = await cobroLuis(boleto, instante);
    assert.equal(otraVezRecibo.body.resultados[0].estado, 'duplicado');
    assert.equal(otraVezCobro.body.resultados[0].estado, 'duplicado');
  });
});

describe('el cobro del recolector llega primero', () => {
  test('el recibo lo confirma', async () => {
    const boleto = await pedirBoleto();
    const instante = nuevoInstante();
    await cobroLuis(boleto, instante);
    const res = await subirRecibos(recibo(boleto, instante));
    assert.equal(res.body.resultados[0].estado, 'ok');
    assert.deepEqual(res.body.resultados[0].cobro.confirmadoPor, ['recolector', 'pasajero']);
  });
});

describe('recibos inválidos', () => {
  test('boleto de otro pasajero, línea que no es de la unidad, unidad inexistente', async () => {
    await como(TEL.PEDRO).post('/recargas', { monto: 50000, metodo: 'simulada' });
    const [dePedro] = (await como(TEL.PEDRO).post('/boletos', { cantidad: 1 })).body.boletos;
    const mio = await pedirBoleto();

    const res = await subirRecibos(
      recibo(dePedro, nuevoInstante()),
      recibo(mio, nuevoInstante(), { lineaCodigo: 3 }),
      recibo(mio, nuevoInstante(), { unidadCodigo: 999 }),
      recibo(mio, nuevoInstante(), { tramoCodigo: 9 }),
    );
    assert.deepEqual(
      res.body.resultados.map((r) => r.codigo),
      ['BOLETO_INVALIDO', 'TRAMO_INVALIDO', 'VALIDACION', 'TRAMO_INVALIDO'],
    );
  });

  test('body inválido → 400; un recolector no puede subir recibos → 403', async () => {
    assert.equal((await como(TEL.ANA).post('/sync/recibos', { recibos: [] })).status, 400);
    const res = await como(TEL.LUIS).post('/sync/recibos', {
      recibos: [recibo({ bid: '00000000-0000-4000-8000-00000000abcd' }, nuevoInstante())],
    });
    assert.equal(res.status, 403);
  });
});

describe('rutas frecuentes', () => {
  test('GET /me/frecuentes cuenta los viajes por línea y tramo', async () => {
    const res = await como(TEL.ANA).get('/me/frecuentes');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, [{ lineaCodigo: 1, tramoCodigo: 1, veces: 2 }]);
  });
});

describe('doble gasto reportado por el propio pasajero', () => {
  test('un recibo de otra unidad para un boleto ya cobrado → conflicto y bloqueo', async () => {
    const boleto = await pedirBoleto();
    await cobroLuis(boleto, nuevoInstante());
    const res = await subirRecibos(
      recibo(boleto, nuevoInstante(), { unidadCodigo: 102, lineaCodigo: 3 }),
    );
    assert.equal(res.body.resultados[0].estado, 'conflicto');
    assert.equal((await como(TEL.ANA).get('/me')).body.bloqueado, true);
  });

  test('el libro cuadra', verificarLibro);
});
