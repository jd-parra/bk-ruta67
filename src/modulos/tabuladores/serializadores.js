/**
 * Fila de `pasaje.tabuladores` → `Tabulador` del contrato (§5).
 * @param {object} fila
 */
export function serializarTabulador(fila) {
  return {
    id: fila.id,
    fuente: fila.fuente,
    vigenteDesde: fila.vigente_desde.toISOString(),
    descuentos: fila.descuentos,
    recargoDomingoFeriado: fila.recargo_domingo_feriado,
    urbanoMinimo: fila.urbano_minimo,
    suburbano: fila.suburbano,
  };
}
