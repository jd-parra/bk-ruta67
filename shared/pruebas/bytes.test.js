// Las pruebas sí usan Buffer: solo para comparar contra una implementación conocida.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aBase64url, aHex, bytesAUuid, desdeBase64url, desdeHex, uuidABytes } from '../bytes.js';

test('base64url coincide con Buffer para todos los largos de 0 a 120', () => {
  for (let largo = 0; largo <= 120; largo++) {
    const bytes = Uint8Array.from({ length: largo }, (_, i) => (i * 37 + largo) & 0xff);
    const esperado = Buffer.from(bytes).toString('base64url');
    assert.equal(aBase64url(bytes), esperado, `largo ${largo}`);
    assert.deepEqual(desdeBase64url(esperado), bytes, `ida y vuelta, largo ${largo}`);
  }
});

test('desdeBase64url acepta base64 normal con relleno', () => {
  const bytes = Uint8Array.from([251, 255, 191, 0, 1]);
  assert.deepEqual(desdeBase64url(Buffer.from(bytes).toString('base64')), bytes);
});

test('desdeBase64url rechaza caracteres inválidos', () => {
  assert.throws(() => desdeBase64url('ab$d'));
  assert.throws(() => desdeBase64url('abcde'));
});

test('hex ida y vuelta', () => {
  const bytes = Uint8Array.from([0, 15, 16, 255]);
  assert.equal(aHex(bytes), '000f10ff');
  assert.deepEqual(desdeHex('000f10ff'), bytes);
  assert.throws(() => desdeHex('abc'));
});

test('UUID ida y vuelta', () => {
  const uuid = '11111111-2222-4333-8444-555555555555';
  assert.equal(uuidABytes(uuid).length, 16);
  assert.equal(bytesAUuid(uuidABytes(uuid)), uuid);
  assert.equal(bytesAUuid(uuidABytes(uuid.toUpperCase())), uuid);
  assert.throws(() => uuidABytes('no-es-uuid'));
});
