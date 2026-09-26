import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { crearApp } from '../src/app.js';
import { pool } from '../src/bd/pool.js';

const app = crearApp();

after(() => pool.end());

test('GET /api/v1/salud responde ok y la BD contesta', async () => {
  const respuesta = await request(app).get('/api/v1/salud');
  assert.equal(respuesta.status, 200);
  assert.deepEqual(respuesta.body, { ok: true, bd: 'ok' });
});

test('ruta desconocida responde con el formato de error del contrato', async () => {
  const respuesta = await request(app).get('/api/v1/no-existe');
  assert.equal(respuesta.status, 404);
  assert.equal(respuesta.body.error.codigo, 'NO_ENCONTRADO');
  assert.equal(typeof respuesta.body.error.mensaje, 'string');
});

test('JSON mal formado responde VALIDACION', async () => {
  const respuesta = await request(app)
    .post('/api/v1/salud')
    .set('Content-Type', 'application/json')
    .send('{malo');
  assert.equal(respuesta.status, 400);
  assert.equal(respuesta.body.error.codigo, 'VALIDACION');
});
