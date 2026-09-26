// Utilidades de bytes en JS puro (sirven igual en Node y en React Native).
// Sin Buffer: solo Uint8Array y DataView.

const ALFABETO_B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const VALOR_B64URL = Object.fromEntries([...ALFABETO_B64URL].map((letra, i) => [letra, i]));
const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Codifica bytes en base64url sin relleno (`=`).
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function aBase64url(bytes) {
  let salida = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const trio = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const letras = Math.min(4, Math.ceil(((bytes.length - i) * 8) / 6));
    for (let j = 0; j < letras; j++) {
      salida += ALFABETO_B64URL[(trio >> (18 - 6 * j)) & 63];
    }
  }
  return salida;
}

/**
 * Decodifica base64url (acepta también `+`, `/` y relleno `=`).
 * @param {string} texto
 * @returns {Uint8Array}
 * @throws {Error} si hay caracteres inválidos
 */
export function desdeBase64url(texto) {
  const limpio = texto.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  if (limpio.length % 4 === 1) throw new Error('base64url con largo inválido');

  const bytes = new Uint8Array(Math.floor((limpio.length * 6) / 8));
  let acumulado = 0;
  let bits = 0;
  let posicion = 0;
  for (const letra of limpio) {
    const valor = VALOR_B64URL[letra];
    if (valor === undefined) throw new Error(`base64url con carácter inválido: ${letra}`);
    acumulado = (acumulado << 6) | valor;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[posicion++] = (acumulado >> bits) & 0xff;
    }
  }
  return bytes;
}

/** @param {Uint8Array} bytes @returns {string} hex en minúsculas */
export function aHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * @param {string} hex
 * @returns {Uint8Array}
 */
export function desdeHex(hex) {
  const limpio = hex.replace(/[\s-]/g, '');
  if (limpio.length % 2 !== 0 || /[^0-9a-f]/i.test(limpio)) throw new Error('hex inválido');
  const bytes = new Uint8Array(limpio.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(limpio.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/**
 * UUID en texto → 16 bytes.
 * @param {string} uuid
 * @returns {Uint8Array}
 * @throws {Error} si no es un UUID
 */
export function uuidABytes(uuid) {
  if (!PATRON_UUID.test(uuid)) throw new Error(`UUID inválido: ${uuid}`);
  return desdeHex(uuid);
}

/**
 * 16 bytes → UUID en texto (minúsculas).
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function bytesAUuid(bytes) {
  const hex = aHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
