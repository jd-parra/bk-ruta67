// Genera los secretos de producción y los imprime (no los guarda en ningún archivo).
//   npm run secretos
// Cópialos a las variables del servidor. Si se pierde LLAVE_FIRMA_BOLETOS, todos los boletos
// emitidos quedan inválidos: guárdala también en un gestor de contraseñas.
import { randomBytes } from 'node:crypto';
import nacl from 'tweetnacl';
import { aBase64url } from '../shared/bytes.js';

const BYTES_JWT = 48;

const { secretKey, publicKey } = nacl.sign.keyPair();

console.log(`JWT_SECRETO=${aBase64url(randomBytes(BYTES_JWT))}`);
console.log(`LLAVE_FIRMA_BOLETOS=${aBase64url(secretKey)}`);
console.log(
  `\n# Llave pública (la reciben los recolectores en el paquete): ${aBase64url(publicKey)}`,
);
