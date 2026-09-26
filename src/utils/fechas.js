import { DESFASE_VENEZUELA_MS, fechaVenezuela } from '../../shared/tarifa.js';

/**
 * Inicio del día de hoy en Venezuela, como instante UTC.
 * @param {Date} [ahora]
 * @returns {Date}
 */
export function inicioDeHoyVenezuela(ahora = new Date()) {
  const { fecha } = fechaVenezuela(ahora);
  return new Date(Date.parse(`${fecha}T00:00:00Z`) - DESFASE_VENEZUELA_MS);
}

/**
 * Trunca un instante a segundos (los recibos NFC viajan en segundos).
 * @param {Date | string} instante
 * @returns {number} segundos Unix
 */
export function aSegundos(instante) {
  return Math.floor(new Date(instante).getTime() / 1000);
}
