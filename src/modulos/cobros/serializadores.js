/** Fila de cobros/repositorio (detalle) → `Cobro` del contrato (§5). */
export function serializarCobro(fila) {
  return {
    id: fila.id,
    bid: fila.bid,
    pasajeroNombre: fila.pasajero_nombre,
    categoriaAplicada: fila.categoria_aplicada,
    lineaCodigo: fila.linea_codigo,
    tramoCodigo: fila.tramo_codigo,
    tramoNombre: fila.tramo_nombre,
    unidadCodigo: fila.unidad_codigo,
    monto: fila.monto,
    metodo: fila.metodo,
    ocurridoEn: fila.ocurrido_en.toISOString(),
    sincronizadoEn: fila.sincronizado_en.toISOString(),
    confirmadoPor: fila.confirmado_por,
    estado: fila.tiene_conflicto ? 'conflicto' : 'ok',
  };
}
