import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { crearApp } from '../src/app.js';
import { pool } from '../src/bd/pool.js';
import { config } from '../src/config/index.js';
import { autenticar, exigirRol } from '../src/middlewares/autenticar.js';
import { manejadorErrores } from '../src/middlewares/manejadorErrores.js';
import { prepararBd } from './ayudantes/bd.js';

const app = crearApp();
const API = '/api/v1';
const CAMPOS_USUARIO = [
  'bloqueado',
  'categoria',
  'categoriaVerificada',
  'creadoEn',
  'id',
  'nombre',
  'rol',
  'telefono',
];

before(prepararBd);
after(() => pool.end());

const login = (telefono, clave = '1234') =>
  request(app).post(`${API}/auth/login`).send({ telefono, clave });

describe('POST /auth/login', () => {
  test('Ana entra y recibe token + usuario con la forma del contrato', async () => {
    const res = await login('04140000001');
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.token, 'string');
    assert.deepEqual(Object.keys(res.body.usuario).sort(), CAMPOS_USUARIO);
    assert.equal(res.body.usuario.nombre, 'Ana Pasajera');
    assert.equal(res.body.usuario.categoria, 'estudiante');
    assert.equal(res.body.usuario.categoriaVerificada, true);
  });

  test('clave incorrecta y teléfono inexistente dan el mismo error', async () => {
    const malaClave = await login('04140000001', '9999');
    const noExiste = await login('04149999999');
    for (const res of [malaClave, noExiste]) {
      assert.equal(res.status, 401);
      assert.equal(res.body.error.codigo, 'NO_AUTENTICADO');
      assert.equal(res.body.error.mensaje, 'Teléfono o clave incorrectos');
    }
  });

  test('body inválido → 400 VALIDACION con detalle', async () => {
    const res = await request(app).post(`${API}/auth/login`).send({ telefono: '123' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.codigo, 'VALIDACION');
    assert.ok(Array.isArray(res.body.error.detalle));
  });
});

describe('POST /auth/registro', () => {
  test('crea un pasajero general ya verificado, con billetera', async () => {
    const res = await request(app)
      .post(`${API}/auth/registro`)
      .send({ nombre: 'Nuevo Pasajero', telefono: '04241112233', clave: 'abcd' });
    assert.equal(res.status, 201);
    assert.equal(res.body.usuario.rol, 'pasajero');
    assert.equal(res.body.usuario.categoria, 'general');
    assert.equal(res.body.usuario.categoriaVerificada, true);
    const { rows } = await pool.query(
      'SELECT saldo_disponible FROM pasaje.billeteras WHERE usuario_id = $1',
      [res.body.usuario.id],
    );
    assert.deepEqual(rows, [{ saldo_disponible: 0 }]);
  });

  test('estudiante queda pendiente de verificación', async () => {
    const res = await request(app).post(`${API}/auth/registro`).send({
      nombre: 'Estudiante Nuevo',
      telefono: '04261112233',
      clave: 'abcd',
      categoria: 'estudiante',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.usuario.categoria, 'estudiante');
    assert.equal(res.body.usuario.categoriaVerificada, false);
  });

  test('acepta rol "pasajero" explícito', async () => {
    const res = await request(app).post(`${API}/auth/registro`).send({
      nombre: 'Con Rol',
      telefono: '04161112233',
      clave: 'abcd',
      rol: 'pasajero',
    });
    assert.equal(res.status, 201);
  });

  test('no se puede registrar como central ni recolector', async () => {
    for (const rol of ['central', 'recolector']) {
      const res = await request(app)
        .post(`${API}/auth/registro`)
        .send({ nombre: 'Intruso', telefono: '04121112233', clave: 'abcd', rol });
      assert.equal(res.status, 400, rol);
      assert.equal(res.body.error.codigo, 'VALIDACION');
    }
  });

  test('teléfono repetido → 409 CONFLICTO', async () => {
    const res = await request(app)
      .post(`${API}/auth/registro`)
      .send({ nombre: 'Otra Ana', telefono: '04140000001', clave: 'abcd' });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.codigo, 'CONFLICTO');
  });

  test('el token del registro sirve para /me', async () => {
    const registro = await request(app)
      .post(`${API}/auth/registro`)
      .send({ nombre: 'Token Nuevo', telefono: '04121234567', clave: 'abcd' });
    const res = await request(app)
      .get(`${API}/me`)
      .set('Authorization', `Bearer ${registro.body.token}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.telefono, '04121234567');
  });
});

describe('GET /me y autenticar', () => {
  test('sin token → 401', async () => {
    const res = await request(app).get(`${API}/me`);
    assert.equal(res.status, 401);
    assert.equal(res.body.error.codigo, 'NO_AUTENTICADO');
  });

  test('token vencido o firmado con otro secreto → 401', async () => {
    const vencido = jwt.sign({ rol: 'pasajero' }, config.jwt.secreto, {
      subject: '00000000-0000-4000-8000-000000000001',
      expiresIn: -10,
    });
    const falso = jwt.sign({ rol: 'central' }, 'otro-secreto-cualquiera', {
      subject: '00000000-0000-4000-8000-000000000003',
    });
    for (const token of [vencido, falso, 'basura']) {
      const res = await request(app).get(`${API}/me`).set('Authorization', `Bearer ${token}`);
      assert.equal(res.status, 401);
    }
  });

  test('Luis ve su perfil de recolector', async () => {
    const { body } = await login('04140000002');
    const res = await request(app).get(`${API}/me`).set('Authorization', `Bearer ${body.token}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.rol, 'recolector');
  });
});

describe('roles y cuenta bloqueada', () => {
  // Mini app para probar los middlewares sin depender de endpoints de pasos futuros.
  const appPrueba = express();
  appPrueba.get('/solo-central', autenticar(), exigirRol('central'), (_req, res) => res.json({}));
  appPrueba.use(manejadorErrores);

  test('exigirRol deja pasar a la central y frena a un pasajero', async () => {
    const central = (await login('04140000003')).body.token;
    const ana = (await login('04140000001')).body.token;
    const ok = await request(appPrueba)
      .get('/solo-central')
      .set('Authorization', `Bearer ${central}`);
    const no = await request(appPrueba).get('/solo-central').set('Authorization', `Bearer ${ana}`);
    assert.equal(ok.status, 200);
    assert.equal(no.status, 403);
    assert.equal(no.body.error.codigo, 'ROL_INVALIDO');
  });

  test('bloquear aplica al instante: 403 en todo menos /me', async () => {
    const token = (await login('04140000004')).body.token;
    await pool.query(`UPDATE pasaje.usuarios SET bloqueado = true WHERE telefono = '04140000004'`);

    const bloqueado = await request(appPrueba)
      .get('/solo-central')
      .set('Authorization', `Bearer ${token}`);
    assert.equal(bloqueado.status, 403);
    assert.equal(bloqueado.body.error.codigo, 'CUENTA_BLOQUEADA');

    const perfil = await request(app).get(`${API}/me`).set('Authorization', `Bearer ${token}`);
    assert.equal(perfil.status, 200);
    assert.equal(perfil.body.bloqueado, true);
  });
});
