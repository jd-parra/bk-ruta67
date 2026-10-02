// Flujo completo de la fase 1: recarga → boletos → paquete → cobro → corrección → conflicto.
// Las pruebas de este archivo corren en orden y comparten estado.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { boletoARaw, firmarBoleto, rawABoleto, verificarFirma } from '../shared/boleto.js';
import { desdeBase64url } from '../shared/bytes.js';
import { pool } from '../src/bd/pool.js';
import { vencerBoletos } from '../src/trabajos/vencerBoletos.js';
import { invalidarCaches } from '../src/utils/cache.js';
import { prepararBd } from './ayudantes/bd.js';
import { API, app, como, espiarEventos, TEL, verificarLibro } from './ayudantes/api.js';

const eventos = espiarEventos();
const devKeys = JSON.parse(readFileSync(new URL('../shared/dev-keys.json', import.meta.url)));

before(prepararBd);
after(() => pool.end());

const ahora = () => new Date().toISOString();
const cobroLocal = (raw, tramoCodigo, extra = {}) => ({
  raw,
  tramoCodigo,
  monto: 0,
  metodo: 'nfc',
  ocurridoEn: ahora(),
  ...extra,
});
const sync = (telefono, ...cobros) => como(telefono).post('/sync/cobros', { cobros });

let boletosAna;
let boletosPedro;

describe('billetera y recargas', () => {
  test('Ana empieza en cero con tarifa de estudiante', async () => {
    const res = await como(TEL.ANA).get('/billetera');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      saldoDisponible: 0,
      saldoReservado: 0,
      boletosActivos: 0,
      tarifaReferencia: 10000,
      tarifaFuente: 'Gaceta Oficial, septiembre 2026 (valores de prueba)',
      viajesEstimados: 0,
      avisos: [],
    });
  });

  test('Rosa (exonerada) paga la mitad, igual que estudiante', async () => {
    const res = await como(TEL.ROSA).get('/billetera');
    assert.equal(res.body.tarifaReferencia, 10000);
    assert.equal(res.body.viajesEstimados, 0);
  });

  test('recarga simulada suma al disponible y deja movimiento', async () => {
    const res = await como(TEL.ANA).post('/recargas', { monto: 100000, metodo: 'simulada' });
    assert.equal(res.status, 201);
    assert.equal(res.body.recarga.estado, 'confirmada');
    assert.equal(res.body.billetera.saldoDisponible, 100000);
    assert.equal(res.body.billetera.viajesEstimados, 10);

    const movimientos = await como(TEL.ANA).get('/movimientos?limite=5');
    assert.equal(movimientos.body.length, 1);
    assert.equal(movimientos.body[0].tipo, 'recarga');
    assert.equal(movimientos.body[0].monto, 100000);
    assert.equal(movimientos.body[0].saldoDisponibleDespues, 100000);
  });

  test('recarga inválida: decimales, pago móvil o monto 0', async () => {
    for (const cuerpo of [
      { monto: 100.5, metodo: 'simulada' },
      { monto: 1000, metodo: 'pago_movil' },
      { monto: 0, metodo: 'simulada' },
    ]) {
      const res = await como(TEL.ANA).post('/recargas', cuerpo);
      assert.equal(res.status, 400, JSON.stringify(cuerpo));
    }
  });

  test('un recolector no puede ver billetera', async () => {
    const res = await como(TEL.LUIS).get('/billetera');
    assert.equal(res.status, 403);
    assert.equal(res.body.error.codigo, 'ROL_INVALIDO');
  });
});

describe('líneas y tarifas', () => {
  test('GET /publico/tarifas sin token', async () => {
    const res = await request(app).get(`${API}/publico/tarifas`);
    assert.equal(res.status, 200);
    assert.equal(res.body.tabulador.urbanoMinimo, 20000);
    assert.equal(res.body.proximo, null);
  });

  test('GET /lineas trae tarifaCompleta calculada por tramo', async () => {
    const res = await como(TEL.ANA).get('/lineas');
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 3);
    const ejido = res.body.find((l) => l.codigo === 3).tramos.find((t) => t.codigo === 1);
    assert.equal(ejido.tarifaCompleta, 28000);
    assert.equal(ejido.km, 9);
    assert.equal(ejido.frecuencia, 0);
    assert.equal('tarifaManual' in ejido, false);
  });
});

describe('boletos', () => {
  test('Ana recibe 5 boletos que reservan 14.000 c/u (máximo de la red, estudiante)', async () => {
    const res = await como(TEL.ANA).post('/boletos', { cantidad: 5 });
    assert.equal(res.status, 201);
    assert.equal(res.body.boletos.length, 5);
    for (const b of res.body.boletos) {
      assert.equal(b.montoReservado, 14000);
      assert.equal(verificarFirma(rawABoleto(b.raw), desdeBase64url(devKeys.publica)), true);
    }
    assert.equal(res.body.billetera.saldoDisponible, 30000);
    assert.equal(res.body.billetera.saldoReservado, 70000);
    assert.equal(res.body.billetera.boletosActivos, 5);
    boletosAna = res.body.boletos;
  });

  test('con 5 activos no emite más', async () => {
    const res = await como(TEL.ANA).post('/boletos', {});
    assert.equal(res.status, 201);
    assert.deepEqual(res.body.boletos, []);
  });

  test('GET /boletos devuelve los mismos raw (la firma es determinista)', async () => {
    const res = await como(TEL.ANA).get('/boletos');
    assert.deepEqual(res.body.map((b) => b.raw).sort(), boletosAna.map((b) => b.raw).sort());
  });

  test('sin saldo → 422 SALDO_INSUFICIENTE', async () => {
    const res = await como(TEL.PEDRO).post('/boletos', { cantidad: 1 });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.codigo, 'SALDO_INSUFICIENTE');
  });

  test('el saldo limita cuántos boletos se emiten', async () => {
    await como(TEL.PEDRO).post('/recargas', { monto: 60000, metodo: 'simulada' });
    const res = await como(TEL.PEDRO).post('/boletos', { cantidad: 5 });
    assert.equal(res.body.boletos.length, 2); // 60.000 / 28.000
    assert.equal(res.body.billetera.saldoDisponible, 4000);
    boletosPedro = res.body.boletos;
  });

  test('Rosa (exonerada) sin saldo no recibe boletos: paga la mitad, no viaja gratis', async () => {
    const res = await como(TEL.ROSA).post('/boletos', { cantidad: 5 });
    assert.equal(res.body.error.codigo, 'SALDO_INSUFICIENTE');
  });

  test('el libro cuadra', verificarLibro);
});

describe('paquete del recolector', () => {
  test('Luis recibe unidad 101, línea 1, tabulador, llave y revocados', async () => {
    const res = await como(TEL.LUIS).get('/recolector/paquete');
    assert.equal(res.status, 200);
    assert.equal(res.body.llavePublica, devKeys.publica);
    assert.equal(res.body.unidad.codigo, 101);
    assert.equal(res.body.linea.codigo, 1);
    assert.equal(res.body.linea.tramos.length, 2);
    assert.equal(res.body.tabulador.urbanoMinimo, 20000);
    assert.equal(res.body.tabuladorProximo, null);
    assert.ok(res.body.feriados.includes('2026-10-12'));
    assert.deepEqual(res.body.revocados, []);
    assert.deepEqual(Object.keys(res.body).sort(), [
      'feriados',
      'generadoEn',
      'linea',
      'llavePublica',
      'revocados',
      'tabulador',
      'tabuladorProximo',
      'unidad',
    ]);
  });

  test('un pasajero no puede pedir el paquete', async () => {
    const res = await como(TEL.ANA).get('/recolector/paquete');
    assert.equal(res.status, 403);
  });
});

describe('sincronizar cobros', () => {
  let primerCobro;

  test('Luis cobra a Ana el tramo 1: 10.000 y devuelve 4.000 al disponible', async () => {
    // Segundo exacto (.000): el recibo NFC viaja en segundos.
    const enSegundoExacto = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();
    primerCobro = cobroLocal(boletosAna[0].raw, 1, { monto: 10000, ocurridoEn: enSegundoExacto });
    const res = await sync(TEL.LUIS, primerCobro);
    assert.equal(res.status, 200);
    const [resultado] = res.body.resultados;
    assert.equal(resultado.estado, 'ok');
    assert.equal(resultado.bid, boletosAna[0].bid);
    assert.equal(resultado.cobro.monto, 10000);
    assert.equal(resultado.cobro.pasajeroNombre, 'Ana Pasajera');
    assert.equal(resultado.cobro.categoriaAplicada, 'estudiante');
    assert.equal(resultado.cobro.tramoNombre, 'Centro – Chorros de Milla');
    assert.equal(resultado.cobro.unidadCodigo, 101);
    assert.deepEqual(resultado.cobro.confirmadoPor, ['recolector']);
    assert.equal(resultado.cobro.estado, 'ok');

    const billetera = (await como(TEL.ANA).get('/billetera')).body;
    assert.equal(billetera.saldoDisponible, 34000);
    assert.equal(billetera.saldoReservado, 56000);
    assert.equal(billetera.boletosActivos, 4);
  });

  test('el cobro deja dos movimientos con el saldo correcto después de cada uno', async () => {
    const { rows } = await pool.query(
      `SELECT tipo, monto, saldo_disponible_despues AS despues FROM pasaje.movimientos
       WHERE cobro_id = (SELECT id FROM pasaje.cobros WHERE bid = $1 AND anulado_en IS NULL)
       ORDER BY tipo`,
      [boletosAna[0].bid],
    );
    assert.deepEqual(rows, [
      { tipo: 'cobro', monto: 0, despues: 30000 },
      { tipo: 'liberacion', monto: 4000, despues: 34000 },
    ]);
  });

  test('GET /movimientos: el cobro y su liberación traen el viaje con la tarifa real', async () => {
    const res = await como(TEL.ANA).get('/movimientos?limite=20');
    const delViaje = res.body.filter((m) => m.tipo === 'cobro' || m.tipo === 'liberacion');
    assert.ok(delViaje.length >= 2);
    for (const m of delViaje) {
      assert.equal(m.viaje.monto, 10000);
      assert.equal(typeof m.viaje.lineaNombre, 'string');
      assert.equal(typeof m.viaje.tramoNombre, 'string');
      assert.equal(typeof m.viaje.unidadCodigo, 'number');
    }
    assert.equal(
      res.body.some((m) => m.tipo === 'recarga' && 'viaje' in m),
      false,
    );
  });

  test('emitir 5 boletos dejó 5 reservas con el saldo bajando de 14.000 en 14.000', async () => {
    const { rows } = await pool.query(
      `SELECT saldo_disponible_despues AS despues FROM pasaje.movimientos
       WHERE tipo = 'reserva' AND usuario_id = '00000000-0000-4000-8000-000000000001'
       ORDER BY despues DESC`,
    );
    assert.deepEqual(
      rows.map((r) => r.despues),
      [86000, 72000, 58000, 44000, 30000],
    );
  });

  test('emite cobro:confirmado a la sala de Ana con cobro y billetera', () => {
    const evento = eventos.find((e) => e.evento === 'cobro:confirmado');
    assert.equal(evento.sala, 'usuario:00000000-0000-4000-8000-000000000001');
    assert.equal(evento.datos.cobro.monto, 10000);
    assert.equal(evento.datos.billetera.saldoDisponible, 34000);
  });

  test('reenviar el mismo cobro → duplicado, sin cobrar dos veces', async () => {
    const res = await sync(TEL.LUIS, primerCobro);
    assert.equal(res.body.resultados[0].estado, 'duplicado');
    assert.equal(res.body.resultados[0].cobro.monto, 10000);
    const billetera = (await como(TEL.ANA).get('/billetera')).body;
    assert.equal(billetera.saldoDisponible, 34000);
  });

  test('el mismo cobro con milisegundos distintos sigue siendo duplicado', async () => {
    const masMedioSegundo = new Date(Date.parse(primerCobro.ocurridoEn) + 500).toISOString();
    const res = await sync(TEL.LUIS, { ...primerCobro, ocurridoEn: masMedioSegundo });
    assert.equal(res.body.resultados[0].estado, 'duplicado');
  });

  test('rechazos en orden: firma, vencido, tramo, boleto desconocido', async () => {
    const alterado = rawABoleto(boletosAna[1].raw);
    alterado[40] ^= 1;
    const noEmitido = boletoARaw(
      firmarBoleto(
        {
          bid: '99999999-9999-4999-8999-999999999999',
          uid: '00000000-0000-4000-8000-000000000001',
          categoria: 'estudiante',
          montoReservado: 14000,
          expira: Math.floor(Date.now() / 1000) + 3600,
        },
        desdeBase64url(devKeys.secreta),
      ),
    );
    const enOchoDias = new Date(Date.now() + 8 * 24 * 3600 * 1000).toISOString();

    const res = await sync(
      TEL.LUIS,
      cobroLocal(boletoARaw(alterado), 1),
      cobroLocal(boletosAna[1].raw, 1, { ocurridoEn: enOchoDias }),
      cobroLocal(boletosAna[1].raw, 9),
      cobroLocal(noEmitido, 1),
      cobroLocal('basura', 1),
    );
    assert.deepEqual(
      res.body.resultados.map((r) => r.codigo),
      ['BOLETO_INVALIDO', 'BOLETO_VENCIDO', 'TRAMO_INVALIDO', 'BOLETO_INVALIDO', 'BOLETO_INVALIDO'],
    );
    assert.ok(res.body.resultados.every((r) => r.estado === 'rechazado'));
  });

  test('BOLETO_INSUFICIENTE si la tarifa real supera lo reservado', async () => {
    const linea1 = (await pool.query(`SELECT id FROM pasaje.lineas WHERE codigo = 1`)).rows[0].id;
    await pool.query(
      `UPDATE pasaje.tramos SET tarifa_manual = 50000 WHERE linea_id = $1 AND codigo = 2`,
      [linea1],
    );
    invalidarCaches(); // cambiamos el tramo por SQL, no por la central
    const res = await sync(TEL.LUIS, cobroLocal(boletosPedro[0].raw, 2));
    await pool.query(`UPDATE pasaje.tramos SET tarifa_manual = NULL WHERE linea_id = $1`, [linea1]);
    invalidarCaches();
    assert.equal(res.body.resultados[0].codigo, 'BOLETO_INSUFICIENTE');
  });

  test('sync valida el body: 400 sin cobros', async () => {
    const res = await como(TEL.LUIS).post('/sync/cobros', { cobros: [] });
    assert.equal(res.status, 400);
  });

  test('Marta cobra en la línea suburbana (102): Pedro paga 28.000', async () => {
    const res = await sync(TEL.MARTA, cobroLocal(boletosPedro[0].raw, 1, { monto: 28000 }));
    assert.equal(res.body.resultados[0].estado, 'ok');
    assert.equal(res.body.resultados[0].cobro.monto, 28000);
    assert.equal(res.body.resultados[0].cobro.lineaCodigo, 3);
  });

  test('frecuencia: el paquete ordena primero el tramo más cobrado', async () => {
    const res = await como(TEL.LUIS).get('/recolector/paquete');
    assert.equal(res.body.linea.tramos[0].codigo, 1);
    assert.equal(res.body.linea.tramos[0].frecuencia, 1);
  });

  test('cobros de hoy del recolector', async () => {
    const res = await como(TEL.LUIS).get('/recolector/cobros');
    assert.equal(res.status, 200);
    assert.equal(res.body.cantidad, 1);
    assert.equal(res.body.total, 10000);
  });

  test('cobros de un día anterior: el rango [desde, hasta) deja fuera los de hoy', async () => {
    const ahora = Date.now();
    const ayer = new Date(ahora - 48 * 3600 * 1000).toISOString();
    const haceUnaHora = new Date(ahora - 3600 * 1000).toISOString();
    const antes = await como(TEL.LUIS).get(`/recolector/cobros?desde=${ayer}&hasta=${haceUnaHora}`);
    assert.equal(antes.status, 200);
    assert.equal(antes.body.cantidad, 0);

    const conHoy = await como(TEL.LUIS).get(`/recolector/cobros?desde=${ayer}&hasta=${new Date(ahora + 60_000).toISOString()}`);
    assert.equal(conHoy.body.cantidad, 1);

    const alReves = await como(TEL.LUIS).get(`/recolector/cobros?desde=${haceUnaHora}&hasta=${ayer}`);
    assert.equal(alReves.status, 400);
  });

  test('el libro cuadra', verificarLibro);
});

describe('corregir un cobro (DELETE /sync/cobros/:bid)', () => {
  test('dentro de 2 min: anula, el boleto vuelve y se puede cobrar con otro tramo', async () => {
    const bid = boletosAna[0].bid;
    const res = await como(TEL.LUIS).delete(`/sync/cobros/${bid}`);
    assert.equal(res.status, 204);

    const billetera = (await como(TEL.ANA).get('/billetera')).body;
    assert.equal(billetera.saldoDisponible, 30000);
    assert.equal(billetera.saldoReservado, 70000);
    assert.equal(billetera.boletosActivos, 5);

    const otraVez = await sync(TEL.LUIS, cobroLocal(boletosAna[0].raw, 2, { monto: 10000 }));
    assert.equal(otraVez.body.resultados[0].estado, 'ok');
    assert.equal(otraVez.body.resultados[0].cobro.tramoCodigo, 2);
  });

  test('otro recolector no puede anularlo → 404', async () => {
    const res = await como(TEL.MARTA).delete(`/sync/cobros/${boletosAna[0].bid}`);
    assert.equal(res.status, 404);
  });

  test('después de 2 min → 409 CONFLICTO', async () => {
    await pool.query(
      `UPDATE pasaje.cobros SET sincronizado_en = now() - interval '3 minutes'
       WHERE bid = $1 AND anulado_en IS NULL`,
      [boletosAna[0].bid],
    );
    const res = await como(TEL.LUIS).delete(`/sync/cobros/${boletosAna[0].bid}`);
    assert.equal(res.status, 409);
    assert.equal(res.body.error.codigo, 'CONFLICTO');
  });

  test('el libro cuadra', verificarLibro);
});

describe('doble gasto (§8.4)', () => {
  test('el mismo boleto en otra unidad → conflicto, cuenta bloqueada, boletos revocados', async () => {
    eventos.length = 0;
    const res = await sync(TEL.MARTA, cobroLocal(boletosAna[0].raw, 1));
    const [resultado] = res.body.resultados;
    assert.equal(resultado.estado, 'conflicto');
    assert.equal(resultado.codigo, 'BOLETO_USADO');
    assert.equal(resultado.cobro.estado, 'conflicto');

    const perfil = await como(TEL.ANA).get('/me');
    assert.equal(perfil.body.bloqueado, true);
    const billetera = await como(TEL.ANA).get('/billetera');
    assert.equal(billetera.status, 403);
    assert.equal(billetera.body.error.codigo, 'CUENTA_BLOQUEADA');

    const { rows } = await pool.query(
      `SELECT saldo_disponible, saldo_reservado FROM pasaje.billeteras
       WHERE usuario_id = '00000000-0000-4000-8000-000000000001'`,
    );
    assert.deepEqual(rows[0], { saldo_disponible: 90000, saldo_reservado: 0 });
    assert.ok(eventos.some((e) => e.evento === 'paquete:actualizado'));
  });

  test('los boletos revocados aparecen en el paquete', async () => {
    const res = await como(TEL.LUIS).get('/recolector/paquete');
    assert.equal(res.body.revocados.length, 4);
    assert.ok(res.body.revocados.includes(boletosAna[1].bid));
  });

  test('un boleto revocado se rechaza como BOLETO_USADO', async () => {
    const res = await sync(TEL.LUIS, cobroLocal(boletosAna[1].raw, 1));
    assert.equal(res.body.resultados[0].codigo, 'BOLETO_USADO');
  });

  test('el libro cuadra', verificarLibro);
});

describe('revocar por pérdida y vencimiento', () => {
  test('Pedro revoca su boleto que le queda y recupera la reserva', async () => {
    const res = await como(TEL.PEDRO).post('/boletos/revocar');
    assert.equal(res.status, 200);
    assert.equal(res.body.revocados, 1);
    assert.equal(res.body.billetera.saldoReservado, 0);
    assert.equal(res.body.billetera.saldoDisponible, 32000);
  });

  test('el trabajo diario vence boletos expirados y libera la reserva', async () => {
    await como(TEL.PEDRO).post('/boletos', { cantidad: 1 });
    await pool.query(
      `UPDATE pasaje.boletos SET expira_en = now() - interval '2 days'
       WHERE usuario_id = '00000000-0000-4000-8000-000000000004' AND estado = 'activo'`,
    );
    assert.equal(await vencerBoletos(), 1);
    const billetera = (await como(TEL.PEDRO).get('/billetera')).body;
    assert.equal(billetera.saldoReservado, 0);
    assert.equal(billetera.saldoDisponible, 32000);
    assert.equal(await vencerBoletos(), 0);
  });

  test('el libro cuadra', verificarLibro);
});
