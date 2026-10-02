/** Fila de `pasaje.avisos` → `Aviso` del contrato. */
export function serializarAviso(fila) {
  const aviso = { id: fila.id, tipo: fila.tipo, mensaje: fila.mensaje };
  if (fila.vigente_desde) aviso.vigenteDesde = fila.vigente_desde.toISOString();
  return aviso;
}

/**
 * Fila de `pasaje.movimientos` → `Movimiento` del contrato.
 * Los movimientos de un cobro traen `viaje`: lo que costó de verdad y dónde (§5).
 */
export function serializarMovimiento(fila) {
  const movimiento = {
    id: fila.id,
    tipo: fila.tipo,
    monto: fila.monto,
    saldoDisponibleDespues: fila.saldo_disponible_despues,
    creadoEn: fila.creado_en.toISOString(),
  };
  if (fila.cobro_id) movimiento.cobroId = fila.cobro_id;
  if (fila.viaje_monto !== null && fila.viaje_monto !== undefined) {
    movimiento.viaje = {
      monto: fila.viaje_monto,
      lineaNombre: fila.viaje_linea,
      tramoNombre: fila.viaje_tramo,
      unidadCodigo: fila.viaje_unidad,
    };
  }
  return movimiento;
}

/**
 * Arma la `Billetera` del contrato.
 * `viajesEstimados` es null cuando el pasaje es gratis (descuento del 100 %): viajes ilimitados.
 */
export function serializarBilletera({ saldos, boletosActivos, tarifaReferencia, tarifaFuente, avisos }) {
  const total = saldos.saldo_disponible + saldos.saldo_reservado;
  return {
    saldoDisponible: saldos.saldo_disponible,
    saldoReservado: saldos.saldo_reservado,
    boletosActivos,
    tarifaReferencia,
    tarifaFuente,
    viajesEstimados: tarifaReferencia > 0 ? Math.floor(total / tarifaReferencia) : null,
    avisos: avisos.map(serializarAviso),
  };
}
