// Los servicios emiten por aquí sin conocer Socket.IO. servidor.js conecta el emisor real;
// en las pruebas se reemplaza por un espía.
import { SALAS } from './eventos.js';

let emitirReal = () => {};

/**
 * Conecta el emisor a una instancia de Socket.IO (o a un espía en pruebas).
 * @param {(sala: string, evento: string, datos: unknown) => void} fn
 */
export function configurarEmisor(fn) {
  emitirReal = fn;
}

/**
 * Emite un evento a una sala. Nunca lanza: un fallo de tiempo real no debe tumbar un cobro.
 * @param {string} sala usar SALAS
 * @param {string} evento usar EVENTOS
 * @param {unknown} datos
 */
export function emitir(sala, evento, datos) {
  try {
    emitirReal(sala, evento, datos);
  } catch {
    // Se ignora a propósito: el dato ya está en la BD y el cliente lo verá al refrescar.
  }
}

/** Atajo: emitir a todos los conectados. */
export function emitirATodos(evento, datos) {
  emitir(SALAS.TODOS, evento, datos);
}
