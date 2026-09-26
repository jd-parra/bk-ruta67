// Socket.IO de verdad: servidor HTTP + cliente socket.io-client.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { io as conectar } from 'socket.io-client';
import { crearApp } from '../src/app.js';
import { pool } from '../src/bd/pool.js';
import { iniciarTiempoReal } from '../src/tiempoReal/socket.js';
import { prepararBd } from './ayudantes/bd.js';
import { como, TEL, tokenDe } from './ayudantes/api.js';

let servidor;
let socketIo;
let base;
const clientes = [];

before(async () => {
  await prepararBd();
  servidor = http.createServer(crearApp());
  socketIo = iniciarTiempoReal(servidor);
  await new Promise((listo) => servidor.listen(0, listo));
  base = `http://localhost:${servidor.address().port}`;
});

after(async () => {
  clientes.forEach((c) => c.close());
  socketIo.close();
  await pool.end();
});

function cliente(token) {
  const socket = conectar(base, {
    auth: { token },
    transports: ['websocket'],
    reconnection: false,
  });
  clientes.push(socket);
  return socket;
}

const esperar = (socket, evento) =>
  new Promise((resolver, rechazar) => {
    const limite = setTimeout(() => rechazar(new Error(`no llegó ${evento}`)), 5000);
    socket.once(evento, (datos) => {
      clearTimeout(limite);
      resolver(datos);
    });
  });

test('sin token válido la conexión se rechaza', async () => {
  const error = await esperar(cliente('basura'), 'connect_error');
  assert.equal(error.message, 'NO_AUTENTICADO');
});

test('Ana recibe cobro:confirmado en vivo cuando Luis le cobra', async () => {
  const socketAna = cliente(await tokenDe(TEL.ANA));
  await esperar(socketAna, 'connect');

  await como(TEL.ANA).post('/recargas', { monto: 20000, metodo: 'simulada' });
  const [boleto] = (await como(TEL.ANA).post('/boletos', { cantidad: 1 })).body.boletos;

  const llegada = esperar(socketAna, 'cobro:confirmado');
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
  const { cobro, billetera } = await llegada;
  assert.equal(cobro.bid, boleto.bid);
  assert.equal(cobro.monto, 10000);
  assert.equal(billetera.saldoDisponible, 10000);
});

test('la central ve moverse las unidades y los recolectores reciben paquete:actualizado', async () => {
  const socketCentral = cliente(await tokenDe(TEL.CENTRAL));
  const socketLuis = cliente(await tokenDe(TEL.LUIS));
  await Promise.all([esperar(socketCentral, 'connect'), esperar(socketLuis, 'connect')]);

  const ubicacion = esperar(socketCentral, 'unidad:ubicacion');
  await como(TEL.LUIS).post('/ubicaciones', { lat: 8.6, lng: -71.15 });
  assert.deepEqual(await ubicacion, { unidadCodigo: 101, lat: 8.6, lng: -71.15 });

  const paquete = esperar(socketLuis, 'paquete:actualizado');
  await como(TEL.PEDRO).post('/recargas', { monto: 30000, metodo: 'simulada' });
  await como(TEL.PEDRO).post('/boletos', { cantidad: 1 });
  await como(TEL.PEDRO).post('/boletos/revocar');
  assert.deepEqual(await paquete, {});
});

test('los pasajeros reciben tarifa:aviso cuando la central carga un tabulador', async () => {
  const socketRosa = cliente(await tokenDe(TEL.ROSA));
  await esperar(socketRosa, 'connect');
  const aviso = esperar(socketRosa, 'tarifa:aviso');
  await como(TEL.CENTRAL).post('/central/tabuladores', {
    fuente: 'Gaceta de prueba',
    vigenteDesde: '2099-06-01T04:00:00Z',
    descuentos: { general: 0, estudiante: 0.5, exonerado: 1 },
    recargoDomingoFeriado: 0,
    urbanoMinimo: 30000,
    suburbano: [{ hastaKm: 9999, monto: 50000 }],
  });
  const recibido = await aviso;
  assert.equal(recibido.tipo, 'CAMBIO_TARIFA');
  assert.equal(recibido.vigenteDesde, '2099-06-01T04:00:00.000Z');
});
