import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aHex, desdeHex } from '../bytes.js';
import {
  codificarQR,
  comandoPedirBoleto,
  comandoRecibo,
  comandoSelect,
  crearTarjetaHCE,
  decodificarQR,
  esOk,
  leerRespuestaPedirBoleto,
} from '../protocolo.js';

const vectores = JSON.parse(readFileSync(new URL('../vectores.json', import.meta.url)));
const { nfc, boleto: vectorBoleto } = vectores;

test('los comandos coinciden byte a byte con el §9', () => {
  assert.equal(aHex(comandoSelect()).toUpperCase(), nfc.select);
  assert.equal(aHex(comandoPedirBoleto(nfc.pedirBoleto.datos)).toUpperCase(), nfc.pedirBoleto.hex);
  assert.equal(aHex(comandoRecibo(nfc.recibo.datos)).toUpperCase(), nfc.recibo.hex);
});

test('leer la respuesta al PEDIR_BOLETO', () => {
  const respuesta = desdeHex(nfc.respuestaPedirBoleto.hex);
  const leida = leerRespuestaPedirBoleto(respuesta);
  assert.equal(leida.ok, true);
  assert.equal(leida.raw, vectorBoleto.raw);
  assert.equal(leida.tramoSugerido, nfc.respuestaPedirBoleto.tramoSugerido);
  assert.equal(leida.boleto.length, 106);
});

test('respuestas sin boletos o mal formadas', () => {
  assert.deepEqual(leerRespuestaPedirBoleto(Uint8Array.of(0x6a, 0x82)), {
    ok: false,
    motivo: 'SIN_BOLETOS',
  });
  assert.equal(leerRespuestaPedirBoleto(Uint8Array.of(0x90, 0x00)).motivo, 'RESPUESTA_INVALIDA');
  assert.equal(esOk(Uint8Array.of(0x90, 0x00)), true);
  assert.equal(esOk(Uint8Array.of(0x6d, 0x00)), false);
});

/** Un toque completo: el lector (recolector) contra la tarjeta HCE (pasajero). */
function nuevaTarjeta({ abierta = true, boleto = vectorBoleto.raw } = {}) {
  const recibos = [];
  const pedidos = [];
  const tarjeta = crearTarjetaHCE({
    pagarAbierta: () => abierta,
    siguienteBoleto: (linea, unidad) => {
      pedidos.push([linea, unidad]);
      return boleto ? { raw: boleto, tramoSugerido: linea === 1 ? 2 : 0 } : null;
    },
    alRecibo: (recibo) => recibos.push(recibo),
  });
  return { tarjeta, recibos, pedidos };
}

test('toque completo: los dos teléfonos se quedan con el mismo registro', () => {
  const { tarjeta, recibos, pedidos } = nuevaTarjeta();

  assert.equal(aHex(tarjeta.procesar(comandoSelect())), '9000');

  const respuesta = tarjeta.procesar(comandoPedirBoleto({ lineaCodigo: 1, unidadCodigo: 101 }));
  const leida = leerRespuestaPedirBoleto(respuesta);
  assert.equal(leida.raw, vectorBoleto.raw);
  assert.equal(leida.tramoSugerido, 2);
  assert.deepEqual(pedidos, [[1, 101]]);

  const ocurridoEn = '2026-10-01T15:30:00.000Z';
  const recibo = comandoRecibo({
    bid: vectorBoleto.datos.bid,
    tramoCodigo: 2,
    monto: 10000,
    ocurridoEn,
  });
  assert.equal(aHex(tarjeta.procesar(recibo)), '9000');
  assert.deepEqual(recibos, [
    {
      bid: vectorBoleto.datos.bid,
      lineaCodigo: 1,
      unidadCodigo: 101,
      tramoCodigo: 2,
      monto: 10000,
      ocurridoEn,
    },
  ]);
});

test('con la pantalla "Pagar" cerrada, la tarjeta no responde', () => {
  const { tarjeta } = nuevaTarjeta({ abierta: false });
  assert.equal(tarjeta.procesar(comandoSelect()), null);
});

test('sin boletos → 6A 82', () => {
  const { tarjeta } = nuevaTarjeta({ boleto: null });
  tarjeta.procesar(comandoSelect());
  const respuesta = tarjeta.procesar(comandoPedirBoleto({ lineaCodigo: 1, unidadCodigo: 101 }));
  assert.equal(aHex(respuesta), '6a82');
});

test('AID ajeno, comando sin SELECT previo o desconocido → 6D 00', () => {
  const { tarjeta } = nuevaTarjeta();
  const otroAid = desdeHex('00A4040007A000000003101000');
  assert.equal(aHex(tarjeta.procesar(otroAid)), '6d00');
  assert.equal(
    aHex(tarjeta.procesar(comandoPedirBoleto({ lineaCodigo: 1, unidadCodigo: 101 }))),
    '6d00',
  );
  tarjeta.procesar(comandoSelect());
  assert.equal(aHex(tarjeta.procesar(desdeHex('80990000'))), '6d00');
  tarjeta.reiniciar();
  assert.equal(
    aHex(tarjeta.procesar(comandoPedirBoleto({ lineaCodigo: 1, unidadCodigo: 101 }))),
    '6d00',
  );
});

test('QR ida y vuelta', () => {
  const texto = codificarQR({ raw: vectorBoleto.raw, tramoSugerido: 3 });
  assert.equal(texto, `P2:${vectorBoleto.raw}.3`);
  assert.deepEqual(decodificarQR(texto), { raw: vectorBoleto.raw, tramoSugerido: 3 });
  assert.equal(codificarQR({ raw: 'abc' }), 'P2:abc.0');
});

test('QR ajeno o mal formado → null', () => {
  for (const texto of ['https://ejemplo.com', 'P2:', 'P2:abc', 'P2:abc.x', 'P2:abc.70000', null]) {
    assert.equal(decodificarQR(texto), null, String(texto));
  }
});
