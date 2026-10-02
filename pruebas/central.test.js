import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { pool } from '../src/bd/pool.js';
import { prepararBd } from './ayudantes/bd.js';
import { API, app, como, espiarEventos, TEL, verificarLibro } from './ayudantes/api.js';

const eventos = espiarEventos();

before(prepararBd);
after(() => pool.end());

const central = () => como(TEL.CENTRAL);
const idDe = async (telefono) =>
  (await pool.query('SELECT id FROM pasaje.usuarios WHERE telefono = $1', [telefono])).rows[0].id;

describe('acceso', () => {
  test('solo la central entra a /central', async () => {
    assert.equal((await como(TEL.ANA).get('/central/resumen')).status, 403);
    assert.equal((await como(TEL.LUIS).get('/central/unidades')).status, 403);
    assert.equal((await request(app).get(`${API}/central/resumen`)).status, 401);
  });
});

describe('resumen', () => {
  test('arranca en cero con 3 líneas', async () => {
    const res = await central().get('/central/resumen');
    assert.equal(res.status, 200);
    assert.equal(res.body.cobros, 0);
    assert.equal(res.body.recaudado, 0);
    assert.equal(res.body.porLinea.length, 3);
    assert.deepEqual(res.body.porCategoria.estudiante, { cobros: 0, recaudado: 0 });
  });

  test('refleja recargas y cobros', async () => {
    await como(TEL.PEDRO).post('/recargas', { monto: 50000, metodo: 'simulada' });
    const [boleto] = (await como(TEL.PEDRO).post('/boletos', { cantidad: 1 })).body.boletos;
    await como(TEL.LUIS).post('/sync/cobros', {
      cobros: [
        {
          raw: boleto.raw,
          tramoCodigo: 1,
          monto: 20000,
          metodo: 'nfc',
          ocurridoEn: new Date().toISOString(),
        },
      ],
    });
    const res = await central().get('/central/resumen');
    assert.equal(res.body.recargado, 50000);
    assert.equal(res.body.cobros, 1);
    assert.equal(res.body.recaudado, 20000);
    assert.equal(res.body.pasajeros, 1);
    assert.deepEqual(res.body.porLinea[0], {
      lineaCodigo: 1,
      lineaNombre: 'Chorros de Milla',
      cobros: 1,
      recaudado: 20000,
    });
    assert.equal(res.body.porCategoria.general.recaudado, 20000);
  });
});

describe('tabuladores', () => {
  const nuevo = {
    fuente: 'Gaceta Oficial N° 43.999',
    vigenteDesde: '2099-01-01T04:00:00Z',
    descuentos: { general: 0, estudiante: 0.5, exonerado: 1 },
    recargoDomingoFeriado: 0.2,
    urbanoMinimo: 25000,
    suburbano: [
      { hastaKm: 10, monto: 35000 },
      { hastaKm: 9999, monto: 120000 },
    ],
  };

  test('crear uno futuro: queda como próximo y avisa a pasajeros y recolectores', async () => {
    eventos.length = 0;
    const res = await central().post('/central/tabuladores', nuevo);
    assert.equal(res.status, 201);
    assert.equal(res.body.urbanoMinimo, 25000);

    const publico = await request(app).get(`${API}/publico/tarifas`);
    assert.equal(publico.body.tabulador.urbanoMinimo, 20000);
    assert.equal(publico.body.proximo.urbanoMinimo, 25000);

    const aviso = eventos.find((e) => e.evento === 'tarifa:aviso');
    assert.equal(aviso.sala, 'rol:pasajero');
    assert.equal(aviso.datos.tipo, 'CAMBIO_TARIFA');
    assert.match(aviso.datos.mensaje, /250,00 Bs/);
    assert.ok(eventos.some((e) => e.evento === 'paquete:actualizado'));

    const billetera = await como(TEL.ROSA).get('/billetera');
    assert.equal(billetera.body.avisos[0].tipo, 'CAMBIO_TARIFA');
  });

  test('la misma fecha dos veces → 409', async () => {
    const res = await central().post('/central/tabuladores', nuevo);
    assert.equal(res.status, 409);
  });

  test('una escala que deja tramos sin tarifa → 422 TRAMO_INVALIDO', async () => {
    const res = await central().post('/central/tabuladores', {
      ...nuevo,
      vigenteDesde: '2099-02-01T04:00:00Z',
      suburbano: [{ hastaKm: 5, monto: 30000 }],
    });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.codigo, 'TRAMO_INVALIDO');
  });

  test('rangos desordenados → 400', async () => {
    const res = await central().post('/central/tabuladores', {
      ...nuevo,
      vigenteDesde: '2099-03-01T04:00:00Z',
      suburbano: [
        { hastaKm: 20, monto: 1 },
        { hastaKm: 10, monto: 2 },
      ],
    });
    assert.equal(res.status, 400);
  });

  test('GET lista del más nuevo al más viejo', async () => {
    const res = await central().get('/central/tabuladores');
    assert.deepEqual(
      res.body.map((t) => t.urbanoMinimo),
      [25000, 20000],
    );
  });
});

describe('líneas y tramos', () => {
  let lineaId;

  test('crear una línea suburbana con tramo de tarifa manual', async () => {
    const res = await central().post('/central/lineas', {
      codigo: 4,
      nombre: 'Mérida – Lagunillas',
      tipo: 'suburbana',
      tramos: [
        { codigo: 1, nombre: 'Centro – Lagunillas', km: 25 },
        { codigo: 2, nombre: 'Centro – Jají', km: 30, tarifaManual: 80000 },
      ],
    });
    assert.equal(res.status, 201);
    lineaId = res.body.id;
    assert.equal(res.body.tramos[0].tarifaCompleta, 99000);
    assert.equal(res.body.tramos[1].tarifaCompleta, 80000);
    assert.equal(res.body.tramos[1].tarifaManual, 80000);
  });

  test('código de línea repetido → 409', async () => {
    const res = await central().post('/central/lineas', {
      codigo: 4,
      nombre: 'Otra',
      tipo: 'urbana',
      tramos: [{ codigo: 1, nombre: 'X – Y', km: 2 }],
    });
    assert.equal(res.status, 409);
  });

  test('PUT agrega un tramo y quita la tarifa manual del otro', async () => {
    const res = await central().put(`/central/lineas/${lineaId}`, {
      nombre: 'Mérida – Lagunillas (directo)',
      tramos: [
        { codigo: 2, nombre: 'Centro – Jají', km: 30, tarifaManual: null },
        { codigo: 3, nombre: 'Centro – San Juan', km: 20 },
      ],
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.nombre, 'Mérida – Lagunillas (directo)');
    assert.equal(res.body.tramos.length, 3);
    assert.equal(res.body.tramos[1].tarifaCompleta, 99000);
    assert.equal('tarifaManual' in res.body.tramos[1], false);
  });

  test('PUT guarda el trazo de un tramo y lo conserva si no se envía', async () => {
    const trazo = [
      [8.5897, -71.1561],
      [8.6, -71.17],
      [8.61, -71.2],
    ];
    const guardado = await central().put(`/central/lineas/${lineaId}`, {
      tramos: [{ codigo: 3, nombre: 'Centro – San Juan', km: 20, trazo }],
    });
    assert.equal(guardado.status, 200);
    assert.deepEqual(guardado.body.tramos[2].trazo, trazo);
    assert.equal('trazo' in guardado.body.tramos[0], false);

    const sinTrazo = await central().put(`/central/lineas/${lineaId}`, {
      tramos: [{ codigo: 3, nombre: 'Centro – San Juan', km: 21 }],
    });
    assert.deepEqual(sinTrazo.body.tramos[2].trazo, trazo);

    const borrado = await central().put(`/central/lineas/${lineaId}`, {
      tramos: [{ codigo: 3, nombre: 'Centro – San Juan', km: 21, trazo: null }],
    });
    assert.equal('trazo' in borrado.body.tramos[2], false);
  });

  test('PUT guarda las paradas aparte del trazo y las conserva si no se envían', async () => {
    const paradas = [
      { nombre: 'Plaza Bolívar', lat: 8.5897, lng: -71.1561 },
      { nombre: 'Terminal', lat: 8.6, lng: -71.18 },
    ];
    const guardado = await central().put(`/central/lineas/${lineaId}`, {
      tramos: [{ codigo: 3, nombre: 'Centro – San Juan', km: 21, paradas }],
    });
    assert.equal(guardado.status, 200);
    assert.deepEqual(guardado.body.tramos[2].paradas, paradas);

    const sinParadas = await central().put(`/central/lineas/${lineaId}`, {
      tramos: [{ codigo: 3, nombre: 'Centro – San Juan', km: 21 }],
    });
    assert.deepEqual(sinParadas.body.tramos[2].paradas, paradas);

    const vacias = await central().put(`/central/lineas/${lineaId}`, {
      tramos: [{ codigo: 3, nombre: 'Centro – San Juan', km: 21, paradas: [] }],
    });
    assert.equal('paradas' in vacias.body.tramos[2], false);
  });

  test('parada sin nombre o fuera del mapa → 400', async () => {
    for (const parada of [
      { nombre: ' ', lat: 8.5, lng: -71.1 },
      { nombre: 'X', lat: 91, lng: -71.1 },
    ]) {
      const res = await central().put(`/central/lineas/${lineaId}`, {
        tramos: [{ codigo: 3, nombre: 'Centro – San Juan', km: 21, paradas: [parada] }],
      });
      assert.equal(res.status, 400, JSON.stringify(parada));
    }
  });

  test('trazo inválido → 400', async () => {
    for (const trazo of [[[8.5, -71.1]], [[95, 0], [8, -71]], [['a', 'b'], [1, 2]]]) {
      const res = await central().put(`/central/lineas/${lineaId}`, {
        tramos: [{ codigo: 3, nombre: 'Centro – San Juan', km: 21, trazo }],
      });
      assert.equal(res.status, 400, JSON.stringify(trazo));
    }
  });

  test('la nueva línea sube la reserva de los boletos (tarifa máxima de la red)', async () => {
    const res = await como(TEL.ANA).post('/recargas', { monto: 60000, metodo: 'simulada' });
    assert.equal(res.status, 201);
    const boletos = await como(TEL.ANA).post('/boletos', { cantidad: 1 });
    assert.equal(boletos.body.boletos[0].montoReservado, 49500); // 99.000 × 0,5
  });

  test('PUT a una línea que no existe → 404', async () => {
    const res = await central().put('/central/lineas/00000000-0000-4000-8000-00000000abcd', {
      nombre: 'Nada',
    });
    assert.equal(res.status, 404);
  });
});

describe('categorías', () => {
  test('aprobar y rechazar pendientes', async () => {
    const registrar = (telefono, categoria) =>
      request(app)
        .post(`${API}/auth/registro`)
        .send({ nombre: `Pendiente ${telefono}`, telefono, clave: 'abcd', categoria });
    const a = (await registrar('04241000001', 'estudiante')).body.usuario;
    const b = (await registrar('04241000002', 'exonerado')).body.usuario;

    const pendientes = await central().get('/central/categorias/pendientes');
    assert.deepEqual(pendientes.body.map((u) => u.id).sort(), [a.id, b.id].sort());

    const aprobado = await central().put(`/central/usuarios/${a.id}/categoria`, {
      verificada: true,
    });
    assert.equal(aprobado.body.categoria, 'estudiante');
    assert.equal(aprobado.body.categoriaVerificada, true);

    const rechazado = await central().put(`/central/usuarios/${b.id}/categoria`, {
      verificada: false,
    });
    assert.equal(rechazado.body.categoria, 'general');

    assert.deepEqual((await central().get('/central/categorias/pendientes')).body, []);
    const otraVez = await central().put(`/central/usuarios/${a.id}/categoria`, {
      verificada: true,
    });
    assert.equal(otraVez.status, 404);
  });
});

describe('unidades y recolectores', () => {
  let unidadNueva;

  test('crear unidad con un recolector nuevo que ya puede entrar', async () => {
    const res = await central().post('/central/unidades', {
      codigo: 201,
      placa: 'ad789gh',
      lineaCodigo: 2,
      recolector: { nombre: 'Carlos Recolector', telefono: '04147770001', clave: '1234' },
    });
    assert.equal(res.status, 201);
    unidadNueva = res.body;
    assert.equal(res.body.placa, 'AD789GH');
    assert.equal(res.body.lineaCodigo, 2);
    assert.equal(res.body.recolector.nombre, 'Carlos Recolector');

    const login = await request(app)
      .post(`${API}/auth/login`)
      .send({ telefono: '04147770001', clave: '1234' });
    assert.equal(login.body.usuario.rol, 'recolector');
  });

  test('un recolector no puede tener dos unidades → 409', async () => {
    const res = await central().post('/central/unidades', {
      codigo: 202,
      placa: 'ZZ000ZZ',
      lineaCodigo: 1,
      recolectorId: await idDe(TEL.LUIS),
    });
    assert.equal(res.status, 409);
  });

  test('reasignar: quitar el recolector y cambiar de línea', async () => {
    const res = await central().put(`/central/unidades/${unidadNueva.id}`, {
      lineaCodigo: 1,
      recolectorId: null,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.lineaCodigo, 1);
    assert.equal(res.body.recolector, null);
  });

  test('un recolector sin unidad no puede pedir paquete', async () => {
    const res = await como('04147770001').get('/recolector/paquete');
    assert.equal(res.status, 404);
  });

  test('listas de unidades y recolectores', async () => {
    const unidades = await central().get('/central/unidades');
    assert.deepEqual(
      unidades.body.map((u) => u.codigo),
      [101, 102, 201],
    );
    const recolectores = await central().get('/central/recolectores');
    const carlos = recolectores.body.find((r) => r.telefono === '04147770001');
    assert.equal(carlos.unidadCodigo, null);
  });
});

describe('ubicaciones y mapa', () => {
  test('el recolector manda su ubicación y aparece en el mapa', async () => {
    eventos.length = 0;
    const res = await como(TEL.LUIS).post('/ubicaciones', { lat: 8.5897, lng: -71.1561 });
    assert.equal(res.status, 204);
    assert.deepEqual(eventos[0], {
      sala: '*',
      evento: 'unidad:ubicacion',
      datos: { unidadCodigo: 101, lat: 8.5897, lng: -71.1561 },
    });

    const mapa = await como(TEL.ANA).get('/mapa/unidades');
    assert.equal(mapa.body.length, 1);
    assert.equal(mapa.body[0].placa, 'AB123CD');
    assert.equal(mapa.body[0].lineaNombre, 'Chorros de Milla');
  });

  test('latitud fuera de rango → 400', async () => {
    const res = await como(TEL.LUIS).post('/ubicaciones', { lat: 200, lng: 0 });
    assert.equal(res.status, 400);
  });

  test('ubicaciones viejas no salen en el mapa', async () => {
    await pool.query(
      `UPDATE pasaje.ubicaciones_unidad SET actualizado_en = now() - interval '10 minutes'`,
    );
    const mapa = await como(TEL.ANA).get('/mapa/unidades');
    assert.deepEqual(mapa.body, []);
  });
});

describe('bloqueo manual y conflictos', () => {
  test('bloquear revoca boletos; desbloquear resuelve conflictos', async () => {
    const pedroId = await idDe(TEL.PEDRO);
    await como(TEL.PEDRO).post('/boletos', { cantidad: 1 });

    const bloqueado = await central().put(`/central/usuarios/${pedroId}/bloqueo`, {
      bloqueado: true,
    });
    assert.equal(bloqueado.body.bloqueado, true);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM pasaje.boletos WHERE usuario_id = $1 AND estado = 'activo'`,
      [pedroId],
    );
    assert.equal(rows[0].n, 0);

    const desbloqueado = await central().put(`/central/usuarios/${pedroId}/bloqueo`, {
      bloqueado: false,
    });
    assert.equal(desbloqueado.body.bloqueado, false);
  });

  test('la central no se puede bloquear a sí misma', async () => {
    const res = await central().put(`/central/usuarios/${await idDe(TEL.CENTRAL)}/bloqueo`, {
      bloqueado: true,
    });
    assert.equal(res.status, 404);
  });

  test('un doble gasto aparece en /central/conflictos', async () => {
    // La línea 4 subió la reserva general a 99.000: Pedro necesita saldo.
    await como(TEL.PEDRO).post('/recargas', { monto: 100000, metodo: 'simulada' });
    const [boleto] = (await como(TEL.PEDRO).post('/boletos', { cantidad: 1 })).body.boletos;
    const cobro = (tramoCodigo, ocurridoEn) => ({
      cobros: [{ raw: boleto.raw, tramoCodigo, monto: 0, metodo: 'nfc', ocurridoEn }],
    });
    await como(TEL.LUIS).post('/sync/cobros', cobro(1, '2026-09-26T12:00:00Z'));
    await como(TEL.MARTA).post('/sync/cobros', cobro(1, '2026-09-26T12:05:00Z'));

    const res = await central().get('/central/conflictos');
    assert.equal(res.body.length, 1);
    const [conflicto] = res.body;
    assert.equal(conflicto.bid, boleto.bid);
    assert.equal(conflicto.pasajero.nombre, 'Pedro General');
    assert.equal(conflicto.pasajero.bloqueado, true);
    assert.equal(conflicto.cobroOriginal.unidadCodigo, 101);
    assert.equal(conflicto.segundoUso.unidadCodigo, 102);
    assert.equal(conflicto.resuelto, false);

    await central().put(`/central/usuarios/${conflicto.pasajero.id}/bloqueo`, { bloqueado: false });
    assert.deepEqual((await central().get('/central/conflictos')).body, []);
    assert.equal((await central().get('/central/conflictos?todos=true')).body.length, 1);
  });

  test('el libro cuadra', verificarLibro);
});
