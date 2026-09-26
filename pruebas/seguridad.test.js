import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { pool } from '../src/bd/pool.js';
import { config, leerConfig } from '../src/config/index.js';
import { prepararBd } from './ayudantes/bd.js';
import { API, app } from './ayudantes/api.js';

before(prepararBd);
after(() => pool.end());

const login = (telefono, clave) => request(app).post(`${API}/auth/login`).send({ telefono, clave });

describe('límite de intentos de login', () => {
  test(`tras ${config.limites.login} claves malas el mismo teléfono queda frenado 15 min`, async () => {
    for (let i = 0; i < config.limites.login; i++) {
      assert.equal((await login('04140000005', '0000')).status, 401);
    }
    const frenado = await login('04140000005', '1234');
    assert.equal(frenado.status, 429);
    assert.equal(frenado.body.error.codigo, 'DEMASIADOS_INTENTOS');
  });

  test('otro teléfono desde la misma red sigue entrando', async () => {
    assert.equal((await login('04140000004', '1234')).status, 200);
  });

  test('los logins correctos no cuentan', async () => {
    for (let i = 0; i < config.limites.login + 2; i++) {
      assert.equal((await login('04140000001', '1234')).status, 200);
    }
  });
});

describe('cabeceras y CORS', () => {
  test('helmet agrega cabeceras de seguridad', async () => {
    const res = await request(app).get(`${API}/salud`);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-powered-by'], undefined);
  });

  test('en desarrollo acepta cualquier origen', async () => {
    const res = await request(app).get(`${API}/salud`).set('Origin', 'http://localhost:5173');
    assert.ok(res.headers['access-control-allow-origin']);
  });
});

describe('configuración de producción', () => {
  const base = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://x',
    JWT_SECRETO: 'a'.repeat(40),
    LLAVE_FIRMA_BOLETOS: 'llave',
    CORS_ORIGENES: 'https://panel.pasaje.app, http://192.168.1.50:5173',
  };

  test('con todo en regla arranca y parsea la lista de orígenes', () => {
    const conf = leerConfig(base);
    assert.deepEqual(conf.corsOrigenes, ['https://panel.pasaje.app', 'http://192.168.1.50:5173']);
  });

  test('se niega a arrancar con secretos de ejemplo, sin llave o con CORS abierto', () => {
    const casos = [
      { JWT_SECRETO: 'cambia-esto-por-una-cadena-larga-y-aleatoria' },
      { JWT_SECRETO: 'corto-pero-de-16+' },
      { LLAVE_FIRMA_BOLETOS: undefined },
      { CORS_ORIGENES: '*' },
      { CORS_ORIGENES: undefined },
    ];
    for (const cambio of casos) {
      assert.throws(() => leerConfig({ ...base, ...cambio }), /insegura/, JSON.stringify(cambio));
    }
  });
});
