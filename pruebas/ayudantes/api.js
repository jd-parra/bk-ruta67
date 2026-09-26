// Atajos para las pruebas de endpoints.
import assert from 'node:assert/strict';
import request from 'supertest';
import { crearApp } from '../../src/app.js';
import { pool } from '../../src/bd/pool.js';
import { configurarEmisor } from '../../src/tiempoReal/emisor.js';

export const app = crearApp();
export const API = '/api/v1';

export const TEL = {
  ANA: '04140000001',
  LUIS: '04140000002',
  CENTRAL: '04140000003',
  PEDRO: '04140000004',
  ROSA: '04140000005',
  MARTA: '04140000006',
};

const tokens = new Map();

/** Token de un usuario semilla (se cachea). */
export async function tokenDe(telefono) {
  if (!tokens.has(telefono)) {
    const res = await request(app).post(`${API}/auth/login`).send({ telefono, clave: '1234' });
    assert.equal(res.status, 200, `login ${telefono}`);
    tokens.set(telefono, res.body.token);
  }
  return tokens.get(telefono);
}

export function olvidarTokens() {
  tokens.clear();
}

/** Petición autenticada: `como(TEL.ANA).get('/billetera')`. */
export function como(telefono) {
  const conToken = (metodo) => async (ruta, cuerpo) => {
    const cliente = request(app);
    const peticion = cliente[metodo](`${API}${ruta}`).set(
      'Authorization',
      `Bearer ${await tokenDe(telefono)}`,
    );
    return cuerpo === undefined ? peticion : peticion.send(cuerpo);
  };
  return {
    get: conToken('get'),
    post: conToken('post'),
    put: conToken('put'),
    delete: conToken('delete'),
  };
}

/** Captura los eventos de tiempo real emitidos por los servicios. */
export function espiarEventos() {
  const eventos = [];
  configurarEmisor((sala, evento, datos) => eventos.push({ sala, evento, datos }));
  return eventos;
}

/**
 * Invariantes del dinero para todas las billeteras:
 *  - disponible = suma de los montos de sus movimientos
 *  - reservado  = suma de monto_reservado de sus boletos activos
 */
export async function verificarLibro() {
  const { rows } = await pool.query(`
    SELECT b.usuario_id, b.saldo_disponible, b.saldo_reservado,
      (SELECT coalesce(sum(m.monto), 0) FROM pasaje.movimientos m
       WHERE m.usuario_id = b.usuario_id)::bigint AS suma_movimientos,
      (SELECT coalesce(sum(x.monto_reservado), 0) FROM pasaje.boletos x
       WHERE x.usuario_id = b.usuario_id AND x.estado = 'activo')::bigint AS suma_reservas
    FROM pasaje.billeteras b`);
  for (const f of rows) {
    assert.equal(f.saldo_disponible, f.suma_movimientos, `disponible cuadra (${f.usuario_id})`);
    assert.equal(f.saldo_reservado, f.suma_reservas, `reservado cuadra (${f.usuario_id})`);
  }
}
