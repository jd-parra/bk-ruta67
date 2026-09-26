import { tarifaCompleta } from '../../../shared/tarifa.js';

/**
 * Línea con tramos → `Linea` del contrato (§5). `tarifaCompleta` se calcula con el tabulador dado.
 * @param {object} fila de lineas/repositorio.listarConTramos
 * @param {object} tabulador en forma de contrato
 * @param {{ porFrecuencia?: boolean }} [opciones] ordenar tramos por frecuencia (paquete del recolector)
 */
export function serializarLinea(fila, tabulador, { porFrecuencia = false } = {}) {
  const tramos = fila.tramos.map((tramo) => serializarTramo(fila, tramo, tabulador));
  if (porFrecuencia) tramos.sort((a, b) => b.frecuencia - a.frecuencia || a.codigo - b.codigo);
  return { id: fila.id, codigo: fila.codigo, nombre: fila.nombre, tipo: fila.tipo, tramos };
}

function serializarTramo(linea, tramo, tabulador) {
  const serializado = {
    id: tramo.id,
    codigo: tramo.codigo,
    nombre: tramo.nombre,
    km: Number(tramo.km),
    tarifaCompleta: tarifaCompleta(linea, tramo, tabulador),
    frecuencia: tramo.frecuencia,
  };
  if (tramo.tarifaManual !== null && tramo.tarifaManual !== undefined) {
    serializado.tarifaManual = tramo.tarifaManual;
  }
  return serializado;
}
