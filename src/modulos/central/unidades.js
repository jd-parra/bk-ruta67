// Unidades y sus recolectores. Los recolectores se crean aquí, al asignarlos a una unidad.
import { CODIGOS_ERROR } from '../../../shared/codigos.js';
import { conTransaccion, pool } from '../../bd/pool.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import { hashearClave } from '../auth/servicio.js';
import { avisarRecolectores } from '../boletos/servicio.js';
import * as lineas from '../lineas/repositorio.js';
import * as unidades from '../unidades/repositorio.js';
import { serializarUnidadCentral } from '../unidades/serializadores.js';
import * as usuarios from '../usuarios/repositorio.js';
import { serializarUsuario } from '../usuarios/serializadores.js';
import { guardarSinRepetir } from './tarifas.js';

export async function listarUnidades() {
  return (await unidades.listar(pool)).map(serializarUnidadCentral);
}

/** Recolectores con la unidad que tienen asignada (o null). */
export async function listarRecolectores() {
  const { rows } = await pool.query(
    `SELECT us.*, un.codigo AS unidad_codigo FROM pasaje.usuarios us
     LEFT JOIN pasaje.unidades un ON un.recolector_id = us.id
     WHERE us.rol = 'recolector' ORDER BY us.nombre`,
  );
  return rows.map((f) => ({ ...serializarUsuario(f), unidadCodigo: f.unidad_codigo }));
}

/**
 * Crea una unidad. El recolector puede ser uno existente (`recolectorId`) o uno nuevo (`recolector`).
 * @throws {ErrorApp} CONFLICTO si el código, la placa, el teléfono o el recolector ya están en uso
 */
export async function crearUnidad(datos) {
  const id = await conTransaccion(async (cliente) => {
    const lineaId = await idDeLinea(cliente, datos.lineaCodigo);
    const recolectorId = await resolverRecolector(cliente, datos);
    return guardarSinRepetir(
      () => unidades.crear(cliente, { ...datos, lineaId, recolectorId }),
      'código, placa o recolector',
    );
  });
  avisarRecolectores();
  return serializarUnidadCentral(await unidades.buscarPorId(pool, id));
}

/**
 * Cambia la línea y/o el recolector de una unidad.
 * @throws {ErrorApp} NO_ENCONTRADO; CONFLICTO si el recolector ya tiene otra unidad
 */
export async function actualizarUnidad(id, datos) {
  await conTransaccion(async (cliente) => {
    if (!(await unidades.buscarPorId(cliente, id))) {
      throw new ErrorApp(CODIGOS_ERROR.NO_ENCONTRADO, 'Esa unidad no existe');
    }
    const cambios = {};
    if (datos.lineaCodigo !== undefined) {
      cambios.lineaId = await idDeLinea(cliente, datos.lineaCodigo);
    }
    if (datos.recolector || datos.recolectorId !== undefined) {
      cambios.recolectorId = await resolverRecolector(cliente, datos);
    }
    await guardarSinRepetir(
      () => unidades.actualizar(cliente, id, cambios),
      'asignación de recolector',
    );
  });
  avisarRecolectores();
  return serializarUnidadCentral(await unidades.buscarPorId(pool, id));
}

async function idDeLinea(cliente, codigo) {
  const linea = await lineas.buscarPorCodigo(cliente, codigo);
  if (!linea) throw new ErrorApp(CODIGOS_ERROR.NO_ENCONTRADO, `No existe la línea ${codigo}`);
  return linea.id;
}

/** @returns {Promise<string | null>} id del recolector a asignar */
async function resolverRecolector(cliente, { recolector, recolectorId }) {
  if (recolector) {
    const claveHash = await hashearClave(recolector.clave);
    const nuevo = await guardarSinRepetir(
      () => usuarios.crearRecolector(cliente, { ...recolector, claveHash }),
      'teléfono',
    );
    return nuevo.id;
  }
  if (!recolectorId) return null;

  const existente = await usuarios.buscarPorId(cliente, recolectorId);
  if (existente?.rol !== 'recolector') {
    throw new ErrorApp(CODIGOS_ERROR.NO_ENCONTRADO, 'Ese recolector no existe');
  }
  return existente.id;
}
