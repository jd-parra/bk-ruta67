/** Fila de `pasaje.avisos` → `Aviso` del contrato. */
export function serializarAviso(fila) {
  const aviso = { id: fila.id, tipo: fila.tipo, mensaje: fila.mensaje };
  if (fila.vigente_desde) aviso.vigenteDesde = fila.vigente_desde.toISOString();
  return aviso;
}

/** Fila de `pasaje.movimientos` → `Movimiento` del contrato. */
export function serializarMovimiento(fila) {
  const movimiento = {
    id: fila.id,
    tipo: fila.tipo,
    monto: fila.monto,
    saldoDisponibleDespues: fila.saldo_disponible_despues,
    creadoEn: fila.creado_en.toISOString(),
  };
  if (fila.cobro_id) movimiento.cobroId = fila.cobro_id;
  return movimiento;
}

/**
 * Arma la `Billetera` del contrato.
 * `viajesEstimados` es null cuando el pasaje es gratis (exonerados): viajes ilimitados.
 */
export function serializarBilletera({ saldos, boletosActivos, tarifaReferencia, avisos }) {
  const total = saldos.saldo_disponible + saldos.saldo_reservado;
  return {
    saldoDisponible: saldos.saldo_disponible,
    saldoReservado: saldos.saldo_reservado,
    boletosActivos,
    tarifaReferencia,
    viajesEstimados: tarifaReferencia > 0 ? Math.floor(total / tarifaReferencia) : null,
    avisos: avisos.map(serializarAviso),
  };
}
