// Llaves Ed25519 para firmar boletos.
// Desarrollo/pruebas: shared/dev-keys.json. Producción: LLAVE_FIRMA_BOLETOS (obligatoria, ver config).
import { readFileSync } from 'node:fs';
import nacl from 'tweetnacl';
import { aBase64url, desdeBase64url } from '../../shared/bytes.js';
import { config } from '../config/index.js';

const RUTA_LLAVES_DEV = new URL('../../shared/dev-keys.json', import.meta.url);
const BYTES_LLAVE_SECRETA = 64;

let llavesEnMemoria = null;

/**
 * Par de llaves del servidor (se lee una sola vez).
 * @returns {{ secreta: Uint8Array, publica: Uint8Array, publicaBase64url: string }}
 * @throws {Error} si la llave configurada no es Ed25519 de 64 bytes
 */
export function obtenerLlaves() {
  if (!llavesEnMemoria) llavesEnMemoria = cargarLlaves(leerLlaveSecreta());
  return llavesEnMemoria;
}

function leerLlaveSecreta() {
  if (config.llaveFirmaBoletos) return config.llaveFirmaBoletos;
  const { secreta } = JSON.parse(readFileSync(RUTA_LLAVES_DEV, 'utf8'));
  return secreta;
}

function cargarLlaves(secretaBase64url) {
  const secreta = desdeBase64url(secretaBase64url);
  if (secreta.length !== BYTES_LLAVE_SECRETA) {
    throw new Error(`La llave de firma debe tener ${BYTES_LLAVE_SECRETA} bytes`);
  }
  const { publicKey } = nacl.sign.keyPair.fromSecretKey(secreta);
  return Object.freeze({ secreta, publica: publicKey, publicaBase64url: aBase64url(publicKey) });
}
