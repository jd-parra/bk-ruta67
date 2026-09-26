// Cálculo de tarifas por gaceta (CONTRATO.md §7). JS puro: corre igual en el backend y en la app.
//
//   tarifaCompleta = tramo.tarifaManual
//                 ?? (linea.tipo == "urbana" ? tab.urbanoMinimo : rango de tab.suburbano para tramo.km)
//   recargo        = esDomingoOFeriado(ocurridoEn) ? tab.recargoDomingoFeriado : 0
//   monto          = redondear(tarifaCompleta × (1 + recargo) × (1 − tab.descuentos[categoria]))
//
// Todos los montos son enteros en céntimos. Este es el ÚNICO lugar del sistema que redondea.

/**
 * Venezuela usa UTC−4 fijo (sin horario de verano desde 2016).
 * Se usa un desfase fijo en vez de Intl porque Hermes (React Native) no siempre trae zonas horarias.
 */
export const DESFASE_VENEZUELA_MS = -4 * 60 * 60 * 1000;

/**
 * Fecha local de Venezuela (`YYYY-MM-DD`) y día de la semana (0 = domingo).
 * @param {Date | string} instante
 * @returns {{ fecha: string, diaSemana: number }}
 */
export function fechaVenezuela(instante) {
  const local = new Date(new Date(instante).getTime() + DESFASE_VENEZUELA_MS);
  if (Number.isNaN(local.getTime())) throw new Error(`fecha inválida: ${instante}`);
  return { fecha: local.toISOString().slice(0, 10), diaSemana: local.getUTCDay() };
}

/**
 * ¿Es domingo o feriado en Venezuela en ese instante?
 * @param {Date | string} instante
 * @param {string[]} feriados fechas `YYYY-MM-DD`
 * @returns {boolean}
 */
export function esDomingoOFeriado(instante, feriados = []) {
  const { fecha, diaSemana } = fechaVenezuela(instante);
  return diaSemana === 0 || feriados.includes(fecha);
}

/**
 * Tarifa completa (sin descuento ni recargo) de un tramo.
 * @param {{ tipo: 'urbana' | 'suburbana' }} linea
 * @param {{ km: number, tarifaManual?: number | null }} tramo
 * @param {{ urbanoMinimo: number, suburbano: { hastaKm: number, monto: number }[] }} tabulador
 * @returns {number} céntimos
 * @throws {Error} si el tramo supera la escala suburbana
 */
export function tarifaCompleta(linea, tramo, tabulador) {
  if (tramo.tarifaManual !== undefined && tramo.tarifaManual !== null) return tramo.tarifaManual;
  if (linea.tipo === 'urbana') return tabulador.urbanoMinimo;

  const escala = [...tabulador.suburbano].sort((a, b) => a.hastaKm - b.hastaKm);
  const rango = escala.find(({ hastaKm }) => tramo.km <= hastaKm);
  if (!rango) throw new Error(`el tramo de ${tramo.km} km supera la escala suburbana`);
  return rango.monto;
}

/**
 * Aplica recargo y descuento a una tarifa completa.
 * @param {number} completa céntimos
 * @param {number} recargo 0.2 = +20 %
 * @param {number} descuento 0.5 = −50 %
 * @returns {number} céntimos, entero
 */
export function aplicarAjustes(completa, recargo, descuento) {
  return Math.round(completa * (1 + recargo) * (1 - descuento));
}

/**
 * Monto a cobrar por un viaje.
 * @param {{
 *   linea: { tipo: 'urbana' | 'suburbana' },
 *   tramo: { km: number, tarifaManual?: number | null },
 *   tabulador: object,
 *   categoria: 'general' | 'estudiante' | 'exonerado',
 *   ocurridoEn: Date | string,
 *   feriados?: string[],
 * }} parametros
 * @returns {number} céntimos
 */
export function calcularMonto({ linea, tramo, tabulador, categoria, ocurridoEn, feriados = [] }) {
  const recargo = esDomingoOFeriado(ocurridoEn, feriados) ? tabulador.recargoDomingoFeriado : 0;
  const descuento = descuentoDe(tabulador, categoria);
  return aplicarAjustes(tarifaCompleta(linea, tramo, tabulador), recargo, descuento);
}

/**
 * La tarifa más cara de toda la red para una categoría, con recargo incluido (§8.2).
 * Es lo que reserva cada boleto, así cualquier tramo cabe.
 * @param {{ lineas: { tipo: string, tramos: object[] }[], tabulador: object, categoria: string }} parametros
 * @returns {number} céntimos
 */
export function tarifaMaximaRed({ lineas, tabulador, categoria }) {
  const descuento = descuentoDe(tabulador, categoria);
  let maxima = 0;
  for (const linea of lineas) {
    for (const tramo of linea.tramos) {
      const completa = tarifaCompleta(linea, tramo, tabulador);
      maxima = Math.max(
        maxima,
        aplicarAjustes(completa, tabulador.recargoDomingoFeriado, descuento),
      );
    }
  }
  return maxima;
}

/**
 * Tabulador vigente en un instante: el de `vigenteDesde` más reciente que no sea futuro.
 * @template {{ vigenteDesde: string }} T
 * @param {T[]} tabuladores
 * @param {Date | string} instante
 * @returns {T | null}
 */
export function tabuladorVigente(tabuladores, instante) {
  const momento = new Date(instante).getTime();
  let vigente = null;
  for (const tabulador of tabuladores) {
    const desde = new Date(tabulador.vigenteDesde).getTime();
    if (desde <= momento && (!vigente || desde > new Date(vigente.vigenteDesde).getTime())) {
      vigente = tabulador;
    }
  }
  return vigente;
}

function descuentoDe(tabulador, categoria) {
  const descuento = tabulador.descuentos[categoria];
  if (descuento === undefined) throw new Error(`categoría sin descuento definido: ${categoria}`);
  return descuento;
}
