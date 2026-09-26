// Genera mocks/*.json con respuestas REALES de la API (BD de pruebas local), para el front.
//   npm run mocks
// Borra y vuelve a sembrar la BD de pruebas; nunca toca Supabase.
import { mkdirSync, writeFileSync } from 'node:fs';
import request from 'supertest';
import { crearApp } from '../src/app.js';
import { config } from '../src/config/index.js';
import { pool } from '../src/bd/pool.js';
import { migrar } from '../src/bd/migrar.js';
import { sembrar } from '../src/bd/semilla.js';

if (config.entorno !== 'test') {
  console.error('Corre con NODE_ENV=test (npm run mocks lo hace por ti)');
  process.exit(1);
}

const app = crearApp();
const CARPETA = new URL('../mocks/', import.meta.url);
const tokens = {};

const guardar = (nombre, datos) =>
  writeFileSync(new URL(`${nombre}.json`, CARPETA), `${JSON.stringify(datos, null, 2)}\n`);

async function llamar(metodo, ruta, { quien, cuerpo } = {}) {
  let peticion = request(app)[metodo](`/api/v1${ruta}`);
  if (quien) peticion = peticion.set('Authorization', `Bearer ${tokens[quien]}`);
  const res = await (cuerpo ? peticion.send(cuerpo) : peticion);
  return res.body;
}

async function main() {
  mkdirSync(CARPETA, { recursive: true });
  await migrar({ silencioso: true });
  await sembrar();

  for (const [quien, telefono] of Object.entries({
    ana: '04140000001',
    luis: '04140000002',
    central: '04140000003',
    marta: '04140000006',
  })) {
    const login = await llamar('post', '/auth/login', { cuerpo: { telefono, clave: '1234' } });
    tokens[quien] = login.token;
    if (quien === 'ana') guardar('auth-login', login);
  }

  guardar('me-recolector', await llamar('get', '/me', { quien: 'luis' }));
  guardar(
    'auth-registro',
    await llamar('post', '/auth/registro', {
      cuerpo: {
        nombre: 'Estudiante Nuevo',
        telefono: '04261112233',
        clave: 'abcd',
        categoria: 'estudiante',
      },
    }),
  );

  guardar('publico-tarifas', await llamar('get', '/publico/tarifas'));
  guardar('lineas', await llamar('get', '/lineas', { quien: 'ana' }));
  guardar(
    'recargas-post',
    await llamar('post', '/recargas', {
      quien: 'ana',
      cuerpo: { monto: 100000, metodo: 'simulada' },
    }),
  );
  const emision = await llamar('post', '/boletos', { quien: 'ana', cuerpo: { cantidad: 5 } });
  guardar('boletos-post', emision);
  guardar('boletos-get', await llamar('get', '/boletos', { quien: 'ana' }));
  guardar('recolector-paquete', await llamar('get', '/recolector/paquete', { quien: 'luis' }));

  const cobrar = (quien, boleto, tramoCodigo, ocurridoEn = new Date().toISOString()) =>
    llamar('post', '/sync/cobros', {
      quien,
      cuerpo: {
        cobros: [{ raw: boleto.raw, tramoCodigo, monto: 10000, metodo: 'nfc', ocurridoEn }],
      },
    });
  const [b1, b2] = emision.boletos;
  const ocurrido = new Date().toISOString();
  guardar('sync-cobros-ok', await cobrar('luis', b1, 1, ocurrido));
  guardar('sync-cobros-duplicado', await cobrar('luis', b1, 1, ocurrido));
  guardar('sync-cobros-rechazado', await cobrar('luis', b2, 99));
  await cobrar('luis', b2, 2);

  await llamar('post', '/ubicaciones', { quien: 'luis', cuerpo: { lat: 8.5897, lng: -71.1561 } });
  guardar('mapa-unidades', await llamar('get', '/mapa/unidades', { quien: 'ana' }));
  guardar('recolector-cobros', await llamar('get', '/recolector/cobros', { quien: 'luis' }));
  guardar('billetera', await llamar('get', '/billetera', { quien: 'ana' }));
  guardar('movimientos', await llamar('get', '/movimientos?limite=5', { quien: 'ana' }));

  guardar('sync-cobros-conflicto', await cobrar('marta', b1, 1));
  guardar('central-resumen', await llamar('get', '/central/resumen', { quien: 'central' }));
  guardar('central-conflictos', await llamar('get', '/central/conflictos', { quien: 'central' }));
  guardar('central-unidades', await llamar('get', '/central/unidades', { quien: 'central' }));
  guardar(
    'central-recolectores',
    await llamar('get', '/central/recolectores', { quien: 'central' }),
  );
  guardar('central-tabuladores', await llamar('get', '/central/tabuladores', { quien: 'central' }));
  guardar(
    'central-categorias-pendientes',
    await llamar('get', '/central/categorias/pendientes', { quien: 'central' }),
  );
  guardar('errores-ejemplo', {
    sinToken: await llamar('get', '/billetera'),
    rolInvalido: await llamar('get', '/billetera', { quien: 'luis' }),
    cuentaBloqueada: await llamar('get', '/billetera', { quien: 'ana' }),
    validacion: await llamar('post', '/auth/login', { cuerpo: { telefono: '123' } }),
  });

  console.log('mocks/ actualizados');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
