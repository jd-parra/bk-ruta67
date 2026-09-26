// Tabuladores y líneas: lo que define cuánto cuesta cada tramo.
import { CODIGOS_ERROR, ROLES, ZONA_HORARIA } from '../../../shared/codigos.js';
import { tarifaCompleta } from '../../../shared/tarifa.js';
import { conTransaccion, pool } from '../../bd/pool.js';
import { EVENTOS, SALAS } from '../../tiempoReal/eventos.js';
import { emitir } from '../../tiempoReal/emisor.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import { formatearBs } from '../../utils/dinero.js';
import { crearAviso } from '../billetera/repositorio.js';
import { serializarAviso } from '../billetera/serializadores.js';
import { avisarRecolectores } from '../boletos/servicio.js';
import * as lineas from '../lineas/repositorio.js';
import { listarLineas } from '../lineas/servicio.js';
import { esViolacionUnique } from '../auth/servicio.js';
import * as tabuladores from '../tabuladores/repositorio.js';
import { serializarTabulador } from '../tabuladores/serializadores.js';
import { vigenteYProximo } from '../tabuladores/servicio.js';

export async function listarTabuladores() {
  return (await tabuladores.listar(pool)).map(serializarTabulador);
}

/**
 * Carga un tabulador nuevo (gaceta). Avisa a pasajeros y recolectores.
 * @param {object} datos Tabulador sin id
 * @throws {ErrorApp} CONFLICTO si ya hay uno con la misma fecha; TRAMO_INVALIDO si deja tramos sin tarifa
 */
export async function crearTabulador(datos) {
  const tabulador = await conTransaccion(async (cliente) => {
    validarCubreTramos(await lineas.listarConTramos(cliente), datos);
    const fila = await guardarSinRepetir(
      () => tabuladores.crear(cliente, datos),
      'fecha de vigencia',
    );
    const aviso = await crearAviso(cliente, {
      tipo: 'CAMBIO_TARIFA',
      mensaje: `Nuevo pasaje desde el ${formatearFecha(datos.vigenteDesde)}: urbano ${formatearBs(datos.urbanoMinimo)}`,
      vigenteDesde: datos.vigenteDesde,
    });
    return { fila, aviso };
  });
  emitir(SALAS.rol(ROLES.PASAJERO), EVENTOS.TARIFA_AVISO, serializarAviso(tabulador.aviso));
  avisarRecolectores();
  return serializarTabulador(tabulador.fila);
}

/** Líneas con tramos y tarifas (incluye tarifaManual). */
export function listarLineasCentral() {
  return listarLineas();
}

/**
 * Crea una línea con sus tramos.
 * @throws {ErrorApp} CONFLICTO si el código ya existe; TRAMO_INVALIDO si un tramo no tiene tarifa
 */
export async function crearLinea({ codigo, nombre, tipo, tramos }) {
  const lineaId = await conTransaccion(async (cliente) => {
    const id = await guardarSinRepetir(
      () => lineas.crearLinea(cliente, { codigo, nombre, tipo }),
      'código de línea',
    );
    for (const tramo of tramos) await lineas.guardarTramo(cliente, id, tramo);
    await validarLineaConTabuladores(cliente, id);
    return id;
  });
  avisarRecolectores();
  return buscarLineaSerializada(lineaId);
}

/**
 * Cambia nombre/tipo y crea o actualiza tramos por código (no borra tramos: pueden tener cobros).
 * @throws {ErrorApp} NO_ENCONTRADO; TRAMO_INVALIDO si un tramo queda sin tarifa
 */
export async function actualizarLinea(lineaId, { nombre, tipo, tramos = [] }) {
  await conTransaccion(async (cliente) => {
    const existe = await lineas.actualizarLinea(cliente, lineaId, { nombre, tipo });
    if (!existe) throw new ErrorApp(CODIGOS_ERROR.NO_ENCONTRADO, 'Esa línea no existe');
    for (const tramo of tramos) await lineas.guardarTramo(cliente, lineaId, tramo);
    await validarLineaConTabuladores(cliente, lineaId);
  });
  avisarRecolectores();
  return buscarLineaSerializada(lineaId);
}

async function buscarLineaSerializada(lineaId) {
  return (await listarLineas()).find((l) => l.id === lineaId);
}

/** Cada tramo debe tener tarifa con el tabulador vigente y con el próximo. */
async function validarLineaConTabuladores(cliente, lineaId) {
  const { tabulador, proximo } = await vigenteYProximo(cliente);
  const linea = await lineas.buscarConTramos(cliente, lineaId);
  for (const t of [tabulador, proximo].filter(Boolean)) validarCubreTramos([linea], t);
}

function validarCubreTramos(listaLineas, tabulador) {
  for (const linea of listaLineas) {
    for (const tramo of linea.tramos) {
      try {
        tarifaCompleta(linea, tramo, tabulador);
      } catch {
        throw new ErrorApp(
          CODIGOS_ERROR.TRAMO_INVALIDO,
          `El tramo "${tramo.nombre}" (${tramo.km} km) queda fuera de la escala suburbana`,
        );
      }
    }
  }
}

/** Traduce una violación de UNIQUE en 409 CONFLICTO. */
export async function guardarSinRepetir(guardar, queSeRepite) {
  try {
    return await guardar();
  } catch (error) {
    if (!esViolacionUnique(error)) throw error;
    throw new ErrorApp(CODIGOS_ERROR.CONFLICTO, `Ya existe otro registro con esa ${queSeRepite}`);
  }
}

function formatearFecha(iso) {
  return new Date(iso).toLocaleDateString('es-VE', { timeZone: ZONA_HORARIA });
}
