/** Fila de unidades/repositorio → `Unidad` del contrato (§5). */
export function serializarUnidad(fila) {
  return {
    id: fila.id,
    codigo: fila.codigo,
    placa: fila.placa,
    lineaId: fila.linea_id,
    recolectorId: fila.recolector_id,
  };
}

/** `Unidad` + datos para el panel de la central (línea y recolector legibles). */
export function serializarUnidadCentral(fila) {
  return {
    ...serializarUnidad(fila),
    lineaCodigo: fila.linea_codigo,
    lineaNombre: fila.linea_nombre,
    recolector: fila.recolector_id
      ? {
          id: fila.recolector_id,
          nombre: fila.recolector_nombre,
          telefono: fila.recolector_telefono,
        }
      : null,
  };
}
