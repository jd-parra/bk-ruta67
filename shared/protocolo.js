// Protocolo NFC y QR del CONTRATO.md §9. JS puro: lo usan los dos modos de la app.
//
//   #  Recolector envía                                     Pasajero responde
//   1  SELECT        00 A4 04 00 07 F0 50 41 53 45 00 02 00   90 00
//   2  PEDIR_BOLETO  80 10 00 00 04 [linea:2][unidad:2]       [boleto:106][tramoSugerido:2] 90 00 · sin boletos: 6A 82
//   3  RECIBO        80 20 00 00 1A [bid:16][tramo:2][monto:4][ocurrido:4]   90 00
//   AID o comando desconocido → 6D 00
import { aBase64url, aHex, bytesAUuid, desdeBase64url, desdeHex, uuidABytes } from './bytes.js';
import { BOLETO, NFC } from './codigos.js';

export const SW = Object.freeze({
  OK: Uint8Array.of(0x90, 0x00),
  SIN_BOLETOS: Uint8Array.of(0x6a, 0x82),
  DESCONOCIDO: Uint8Array.of(0x6d, 0x00),
});

const CLA_PROPIETARIO = 0x80;
const INS = Object.freeze({ SELECT: 0xa4, PEDIR_BOLETO: 0x10, RECIBO: 0x20 });
const AID = desdeHex(NFC.AID);
const LARGO_RECIBO = 26; // 16 + 2 + 4 + 4
const BYTES_TRAMO = 2;

// ---------------------------------------------------------------------------
// Modo recolector (lector): arma comandos y lee respuestas
// ---------------------------------------------------------------------------

/** Paso 1: SELECT del AID de Pasaje. */
export function comandoSelect() {
  return concatenar(
    Uint8Array.of(0x00, INS.SELECT, 0x04, 0x00, AID.length),
    AID,
    Uint8Array.of(0x00),
  );
}

/**
 * Paso 2: pide un boleto indicando línea y unidad (el pasajero sugiere su tramo en esa línea).
 * @param {{ lineaCodigo: number, unidadCodigo: number }} datos
 */
export function comandoPedirBoleto({ lineaCodigo, unidadCodigo }) {
  const datos = new Uint8Array(4);
  const vista = new DataView(datos.buffer);
  vista.setUint16(0, lineaCodigo, false);
  vista.setUint16(2, unidadCodigo, false);
  return concatenar(Uint8Array.of(CLA_PROPIETARIO, INS.PEDIR_BOLETO, 0x00, 0x00, 4), datos);
}

/**
 * Lee la respuesta al PEDIR_BOLETO.
 * @param {Uint8Array} respuesta
 * @returns {{ ok: true, boleto: Uint8Array, raw: string, tramoSugerido: number }
 *   | { ok: false, motivo: 'SIN_BOLETOS' | 'RESPUESTA_INVALIDA' }}
 *   `tramoSugerido` 0 = el pasajero no tiene tramo frecuente en esta línea.
 */
export function leerRespuestaPedirBoleto(respuesta) {
  if (terminaEn(respuesta, SW.SIN_BOLETOS)) return { ok: false, motivo: 'SIN_BOLETOS' };
  const largoEsperado = BOLETO.BYTES_TOTAL + BYTES_TRAMO + SW.OK.length;
  if (respuesta.length !== largoEsperado || !terminaEn(respuesta, SW.OK)) {
    return { ok: false, motivo: 'RESPUESTA_INVALIDA' };
  }
  const boleto = respuesta.slice(0, BOLETO.BYTES_TOTAL);
  const tramoSugerido = new DataView(respuesta.buffer, respuesta.byteOffset).getUint16(
    BOLETO.BYTES_TOTAL,
    false,
  );
  return { ok: true, boleto, raw: aBase64url(boleto), tramoSugerido };
}

/**
 * Paso 3: el recibo que se queda en el teléfono del pasajero.
 * @param {{ bid: string, tramoCodigo: number, monto: number, ocurridoEn: Date | string }} datos
 */
export function comandoRecibo({ bid, tramoCodigo, monto, ocurridoEn }) {
  const datos = new Uint8Array(LARGO_RECIBO);
  const vista = new DataView(datos.buffer);
  datos.set(uuidABytes(bid), 0);
  vista.setUint16(16, tramoCodigo, false);
  vista.setUint32(18, monto, false);
  vista.setUint32(22, Math.floor(new Date(ocurridoEn).getTime() / 1000), false);
  return concatenar(Uint8Array.of(CLA_PROPIETARIO, INS.RECIBO, 0x00, 0x00, LARGO_RECIBO), datos);
}

/** ¿La respuesta termina en 90 00? */
export function esOk(respuesta) {
  return terminaEn(respuesta, SW.OK);
}

// ---------------------------------------------------------------------------
// Modo pasajero (tarjeta emulada, HCE)
// ---------------------------------------------------------------------------

/**
 * Crea la "tarjeta" del pasajero. Conecta `procesar` al callback de APDU de react-native-hce.
 *
 * @param {{
 *   pagarAbierta: () => boolean,
 *   // Síncrono (el HCE no espera promesas): carga los boletos en memoria al abrir "Pagar".
 *   siguienteBoleto: (lineaCodigo: number, unidadCodigo: number) =>
 *     { raw: string, tramoSugerido: number } | null,
 *   // Recibe un ReciboLocal (§6.4) listo para guardar en SQLite y subir con /sync/recibos.
 *   alRecibo: (recibo: { bid: string, lineaCodigo: number, unidadCodigo: number,
 *     tramoCodigo: number, monto: number, ocurridoEn: string }) => void,
 * }} dependencias
 * @returns {{ procesar: (apdu: Uint8Array) => Uint8Array | null, reiniciar: () => void }}
 *   `procesar` devuelve null cuando la pantalla "Pagar" está cerrada: no se responde nada.
 */
export function crearTarjetaHCE({ pagarAbierta, siguienteBoleto, alRecibo }) {
  let seleccionada = false;
  let peticion = null; // { lineaCodigo, unidadCodigo } del último PEDIR_BOLETO

  function procesar(apdu) {
    if (!pagarAbierta()) return null;
    if (esSelectNuestro(apdu)) {
      seleccionada = true;
      return SW.OK;
    }
    if (!seleccionada || apdu[0] !== CLA_PROPIETARIO) return SW.DESCONOCIDO;
    if (apdu[1] === INS.PEDIR_BOLETO) return responderPedirBoleto(apdu);
    if (apdu[1] === INS.RECIBO) return responderRecibo(apdu);
    return SW.DESCONOCIDO;
  }

  function responderPedirBoleto(apdu) {
    if (apdu.length < 9 || apdu[4] !== 4) return SW.DESCONOCIDO;
    const vista = new DataView(apdu.buffer, apdu.byteOffset);
    peticion = { lineaCodigo: vista.getUint16(5, false), unidadCodigo: vista.getUint16(7, false) };
    const elegido = siguienteBoleto(peticion.lineaCodigo, peticion.unidadCodigo);
    if (!elegido) return SW.SIN_BOLETOS;

    const tramo = new Uint8Array(BYTES_TRAMO);
    new DataView(tramo.buffer).setUint16(0, elegido.tramoSugerido ?? 0, false);
    return concatenar(desdeBase64url(elegido.raw), tramo, SW.OK);
  }

  function responderRecibo(apdu) {
    if (apdu.length < 5 + LARGO_RECIBO || apdu[4] !== LARGO_RECIBO || !peticion) {
      return SW.DESCONOCIDO;
    }
    const datos = apdu.subarray(5, 5 + LARGO_RECIBO);
    const vista = new DataView(datos.buffer, datos.byteOffset);
    alRecibo({
      bid: bytesAUuid(datos.subarray(0, 16)),
      lineaCodigo: peticion.lineaCodigo,
      unidadCodigo: peticion.unidadCodigo,
      tramoCodigo: vista.getUint16(16, false),
      monto: vista.getUint32(18, false),
      ocurridoEn: new Date(vista.getUint32(22, false) * 1000).toISOString(),
    });
    return SW.OK;
  }

  return {
    procesar,
    reiniciar() {
      seleccionada = false;
      peticion = null;
    },
  };
}

function esSelectNuestro(apdu) {
  if (apdu.length < 5 + AID.length || apdu[1] !== INS.SELECT || apdu[4] !== AID.length)
    return false;
  return aHex(apdu.subarray(5, 5 + AID.length)) === aHex(AID);
}

// ---------------------------------------------------------------------------
// QR (fase 2): "P2:" + base64url(boleto) + "." + tramoSugerido
// ---------------------------------------------------------------------------

/**
 * @param {{ raw: string, tramoSugerido?: number }} datos
 * @returns {string}
 */
export function codificarQR({ raw, tramoSugerido = 0 }) {
  return `${NFC.PREFIJO_QR}${raw}.${tramoSugerido}`;
}

/**
 * @param {string} texto lo que leyó la cámara
 * @returns {{ raw: string, tramoSugerido: number } | null} null si no es un QR de Pasaje
 */
export function decodificarQR(texto) {
  if (typeof texto !== 'string' || !texto.startsWith(NFC.PREFIJO_QR)) return null;
  const [raw, tramo] = texto.slice(NFC.PREFIJO_QR.length).split('.');
  const tramoSugerido = Number(tramo);
  if (!raw || !Number.isInteger(tramoSugerido) || tramoSugerido < 0 || tramoSugerido > 0xffff) {
    return null;
  }
  return { raw, tramoSugerido };
}

// ---------------------------------------------------------------------------

function concatenar(...partes) {
  const total = new Uint8Array(partes.reduce((suma, p) => suma + p.length, 0));
  let posicion = 0;
  for (const parte of partes) {
    total.set(parte, posicion);
    posicion += parte.length;
  }
  return total;
}

function terminaEn(bytes, final) {
  return (
    bytes.length >= final.length &&
    bytes[bytes.length - 2] === final[0] &&
    bytes[bytes.length - 1] === final[1]
  );
}
