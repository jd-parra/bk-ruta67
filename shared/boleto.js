// Boletos firmados (CONTRATO.md §8). JS puro: corre igual en el backend y en la app.
//
// Formato (106 bytes):
//   [0]      version          0x01
//   [1..16]  bid              UUID del boleto
//   [17..32] uid              UUID del pasajero
//   [33]     categoria        0 general · 1 estudiante · 2 exonerado
//   [34..37] montoReservado   uint32 big-endian, céntimos
//   [38..41] expira           uint32 big-endian, segundos Unix
//   [42..105] firma           Ed25519 sobre los bytes 0..41
import nacl from 'tweetnacl';
import { aBase64url, bytesAUuid, desdeBase64url, uuidABytes } from './bytes.js';
import { BOLETO, BYTE_A_CATEGORIA, CATEGORIA_A_BYTE, CODIGOS_ERROR } from './codigos.js';

const MAX_UINT32 = 0xffffffff;

/**
 * Arma los 42 bytes que se firman.
 * @param {{ bid: string, uid: string, categoria: string, montoReservado: number, expira: number }} datos
 *   `expira` en segundos Unix.
 * @returns {Uint8Array}
 * @throws {Error} si algún campo está fuera de rango
 */
export function construirCuerpo({ bid, uid, categoria, montoReservado, expira }) {
  validarEnteroUint32(montoReservado, 'montoReservado');
  validarEnteroUint32(expira, 'expira');
  const byteCategoria = CATEGORIA_A_BYTE[categoria];
  if (byteCategoria === undefined) throw new Error(`categoría inválida: ${categoria}`);

  const cuerpo = new Uint8Array(BOLETO.BYTES_FIRMADOS);
  const vista = new DataView(cuerpo.buffer);
  cuerpo[0] = BOLETO.VERSION;
  cuerpo.set(uuidABytes(bid), 1);
  cuerpo.set(uuidABytes(uid), 17);
  cuerpo[33] = byteCategoria;
  vista.setUint32(34, montoReservado, false);
  vista.setUint32(38, expira, false);
  return cuerpo;
}

/**
 * Firma un boleto con la llave secreta del servidor.
 * @param {Parameters<typeof construirCuerpo>[0]} datos
 * @param {Uint8Array} llaveSecreta Ed25519 de 64 bytes
 * @returns {Uint8Array} los 106 bytes del boleto
 */
export function firmarBoleto(datos, llaveSecreta) {
  const cuerpo = construirCuerpo(datos);
  const firma = nacl.sign.detached(cuerpo, llaveSecreta);
  const boleto = new Uint8Array(BOLETO.BYTES_TOTAL);
  boleto.set(cuerpo, 0);
  boleto.set(firma, BOLETO.BYTES_FIRMADOS);
  return boleto;
}

/**
 * Lee los campos de un boleto sin verificar la firma.
 * @param {Uint8Array} boleto
 * @returns {{ version: number, bid: string, uid: string, categoria: string,
 *   montoReservado: number, expira: number, cuerpo: Uint8Array, firma: Uint8Array }}
 * @throws {Error} si el largo, la versión o la categoría no son válidos
 */
export function decodificarBoleto(boleto) {
  if (!(boleto instanceof Uint8Array) || boleto.length !== BOLETO.BYTES_TOTAL) {
    throw new Error(`el boleto debe tener ${BOLETO.BYTES_TOTAL} bytes`);
  }
  if (boleto[0] !== BOLETO.VERSION) throw new Error(`versión de boleto desconocida: ${boleto[0]}`);
  const categoria = BYTE_A_CATEGORIA[boleto[33]];
  if (!categoria) throw new Error(`categoría de boleto desconocida: ${boleto[33]}`);

  const vista = new DataView(boleto.buffer, boleto.byteOffset, boleto.byteLength);
  return {
    version: boleto[0],
    bid: bytesAUuid(boleto.subarray(1, 17)),
    uid: bytesAUuid(boleto.subarray(17, 33)),
    categoria,
    montoReservado: vista.getUint32(34, false),
    expira: vista.getUint32(38, false),
    cuerpo: boleto.subarray(0, BOLETO.BYTES_FIRMADOS),
    firma: boleto.subarray(BOLETO.BYTES_FIRMADOS),
  };
}

/**
 * ¿La firma del boleto es del servidor?
 * @param {Uint8Array} boleto
 * @param {Uint8Array} llavePublica Ed25519 de 32 bytes
 * @returns {boolean} false también si el boleto está mal formado
 */
export function verificarFirma(boleto, llavePublica) {
  try {
    const { cuerpo, firma } = decodificarBoleto(boleto);
    return nacl.sign.detached.verify(cuerpo, firma, llavePublica);
  } catch {
    return false;
  }
}

/** @param {Uint8Array} boleto @returns {string} base64url (como viaja en la API y el QR) */
export function boletoARaw(boleto) {
  return aBase64url(boleto);
}

/**
 * @param {string} raw base64url
 * @returns {Uint8Array}
 * @throws {Error} si no es base64url válido
 */
export function rawABoleto(raw) {
  return desdeBase64url(raw);
}

/**
 * Reglas del §8.3, en orden: la primera que falla define el error.
 * La usan la app del recolector (sin internet) y el backend al sincronizar.
 *
 * @param {Uint8Array | string} boletoORaw bytes o base64url
 * @param {{
 *   llavePublica: Uint8Array,
 *   ahoraSeg: number,                 // segundos Unix del momento del cobro
 *   monto: number,                    // lo que se va a cobrar, en céntimos
 *   yaUsado?: (bid: string) => boolean // revocados o ya cobrados
 * }} contexto
 * @returns {{ ok: true, boleto: ReturnType<typeof decodificarBoleto> } | { ok: false, codigo: string }}
 */
export function validarBoletoParaCobro(boletoORaw, { llavePublica, ahoraSeg, monto, yaUsado }) {
  const bytes = aBytesSeguro(boletoORaw);
  if (!bytes || !verificarFirma(bytes, llavePublica)) {
    return { ok: false, codigo: CODIGOS_ERROR.BOLETO_INVALIDO };
  }

  const boleto = decodificarBoleto(bytes);
  if (boleto.expira <= ahoraSeg - BOLETO.TOLERANCIA_RELOJ_SEG) {
    return { ok: false, codigo: CODIGOS_ERROR.BOLETO_VENCIDO };
  }
  if (yaUsado?.(boleto.bid)) return { ok: false, codigo: CODIGOS_ERROR.BOLETO_USADO };
  if (monto > boleto.montoReservado) {
    return { ok: false, codigo: CODIGOS_ERROR.BOLETO_INSUFICIENTE };
  }
  return { ok: true, boleto };
}

/**
 * Segundos Unix de vencimiento para un boleto emitido en `emitidoEn`.
 * @param {Date} emitidoEn
 * @returns {number}
 */
export function calcularExpira(emitidoEn) {
  return Math.floor(emitidoEn.getTime() / 1000) + BOLETO.DIAS_VIGENCIA * 24 * 60 * 60;
}

function aBytesSeguro(boletoORaw) {
  if (boletoORaw instanceof Uint8Array) return boletoORaw;
  try {
    return rawABoleto(String(boletoORaw));
  } catch {
    return null;
  }
}

function validarEnteroUint32(valor, nombre) {
  if (!Number.isInteger(valor) || valor < 0 || valor > MAX_UINT32) {
    throw new Error(`${nombre} debe ser un entero entre 0 y ${MAX_UINT32}`);
  }
}
