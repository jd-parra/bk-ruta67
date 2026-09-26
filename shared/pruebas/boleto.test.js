import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import nacl from 'tweetnacl';
import {
  boletoARaw,
  calcularExpira,
  construirCuerpo,
  decodificarBoleto,
  firmarBoleto,
  rawABoleto,
  validarBoletoParaCobro,
  verificarFirma,
} from '../boleto.js';
import { aHex, desdeBase64url, desdeHex } from '../bytes.js';

const vectores = JSON.parse(readFileSync(new URL('../vectores.json', import.meta.url)));
const { boleto: vector } = vectores;
const par = nacl.sign.keyPair.fromSeed(desdeHex(vector.semillaHex));
const ahoraSeg = vector.datos.expira - 3600;

test('la llave pública del vector sale de la semilla', () => {
  assert.equal(boletoARaw(par.publicKey), vector.publica);
});

test('los 42 bytes firmados coinciden con el vector', () => {
  assert.equal(aHex(construirCuerpo(vector.datos)), vector.cuerpoHex);
});

test('el boleto firmado coincide byte a byte con el vector', () => {
  const boleto = firmarBoleto(vector.datos, par.secretKey);
  assert.equal(boleto.length, 106);
  assert.equal(boletoARaw(boleto), vector.raw);
});

test('decodificar el vector devuelve los datos originales', () => {
  const boleto = decodificarBoleto(rawABoleto(vector.raw));
  const { bid, uid, categoria, montoReservado, expira } = boleto;
  assert.deepEqual({ bid, uid, categoria, montoReservado, expira }, vector.datos);
  assert.equal(boleto.version, 1);
});

test('la firma se verifica con la llave correcta y falla con otra', () => {
  const boleto = rawABoleto(vector.raw);
  assert.equal(verificarFirma(boleto, desdeBase64url(vector.publica)), true);
  assert.equal(verificarFirma(boleto, nacl.sign.keyPair().publicKey), false);
});

test('cambiar un solo byte invalida la firma', () => {
  for (const posicion of [0, 1, 20, 33, 36, 40, 50, 105]) {
    const alterado = rawABoleto(vector.raw);
    alterado[posicion] ^= 0x01;
    assert.equal(verificarFirma(alterado, par.publicKey), false, `byte ${posicion}`);
  }
});

test('decodificar rechaza largo, versión o categoría inválidos', () => {
  assert.throws(() => decodificarBoleto(new Uint8Array(105)));
  const otraVersion = rawABoleto(vector.raw);
  otraVersion[0] = 2;
  assert.throws(() => decodificarBoleto(otraVersion));
  const otraCategoria = rawABoleto(vector.raw);
  otraCategoria[33] = 9;
  assert.throws(() => decodificarBoleto(otraCategoria));
});

test('construirCuerpo rechaza valores fuera de rango', () => {
  assert.throws(() => construirCuerpo({ ...vector.datos, montoReservado: -1 }));
  assert.throws(() => construirCuerpo({ ...vector.datos, montoReservado: 1.5 }));
  assert.throws(() => construirCuerpo({ ...vector.datos, expira: 2 ** 32 }));
  assert.throws(() => construirCuerpo({ ...vector.datos, categoria: 'vip' }));
  assert.throws(() => construirCuerpo({ ...vector.datos, bid: 'x' }));
});

test('calcularExpira suma 7 días', () => {
  const emitido = new Date('2026-09-25T00:00:00Z');
  assert.equal(calcularExpira(emitido), Date.parse('2026-10-02T00:00:00Z') / 1000);
});

// §8.3: reglas en orden
const contexto = { llavePublica: par.publicKey, ahoraSeg, monto: 10000 };

test('boleto válido pasa y devuelve los datos', () => {
  const resultado = validarBoletoParaCobro(vector.raw, contexto);
  assert.equal(resultado.ok, true);
  assert.equal(resultado.boleto.bid, vector.datos.bid);
});

test('BOLETO_INVALIDO: basura, firma mala o llave equivocada', () => {
  assert.equal(validarBoletoParaCobro('###', contexto).codigo, 'BOLETO_INVALIDO');
  assert.equal(validarBoletoParaCobro('AAAA', contexto).codigo, 'BOLETO_INVALIDO');
  const otraLlave = { ...contexto, llavePublica: nacl.sign.keyPair().publicKey };
  assert.equal(validarBoletoParaCobro(vector.raw, otraLlave).codigo, 'BOLETO_INVALIDO');
});

test('BOLETO_VENCIDO respeta 10 minutos de tolerancia', () => {
  const { expira } = vector.datos;
  const dentro = { ...contexto, ahoraSeg: expira + 9 * 60 };
  const fuera = { ...contexto, ahoraSeg: expira + 10 * 60 };
  assert.equal(validarBoletoParaCobro(vector.raw, dentro).ok, true);
  assert.equal(validarBoletoParaCobro(vector.raw, fuera).codigo, 'BOLETO_VENCIDO');
});

test('BOLETO_USADO si el bid está revocado o ya cobrado', () => {
  const usado = { ...contexto, yaUsado: (bid) => bid === vector.datos.bid };
  assert.equal(validarBoletoParaCobro(vector.raw, usado).codigo, 'BOLETO_USADO');
});

test('BOLETO_INSUFICIENTE si el monto supera lo reservado', () => {
  const justo = { ...contexto, monto: vector.datos.montoReservado };
  const deMas = { ...contexto, monto: vector.datos.montoReservado + 1 };
  assert.equal(validarBoletoParaCobro(vector.raw, justo).ok, true);
  assert.equal(validarBoletoParaCobro(vector.raw, deMas).codigo, 'BOLETO_INSUFICIENTE');
});

test('el orden importa: vencido gana sobre insuficiente', () => {
  const ambos = { ...contexto, ahoraSeg: vector.datos.expira + 3600, monto: 999999 };
  assert.equal(validarBoletoParaCobro(vector.raw, ambos).codigo, 'BOLETO_VENCIDO');
});
