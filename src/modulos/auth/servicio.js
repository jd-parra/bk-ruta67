import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { CODIGOS_ERROR } from '../../../shared/codigos.js';
import { config } from '../../config/index.js';
import { conTransaccion, pool } from '../../bd/pool.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import * as usuarios from '../usuarios/repositorio.js';

const COSTO_BCRYPT = 10;
const VIOLACION_UNIQUE = '23505';

/**
 * Registra un pasajero. Si la categoría no es "general" queda pendiente de verificación.
 * @param {{ nombre: string, telefono: string, clave: string, categoria: string }} datos
 * @returns {Promise<{ token: string, usuario: object }>}
 * @throws {ErrorApp} CONFLICTO si el teléfono ya existe
 */
export async function registrar({ nombre, telefono, clave, categoria }) {
  const claveHash = await hashearClave(clave);
  try {
    const usuario = await conTransaccion((cliente) =>
      usuarios.crearPasajero(cliente, { nombre, telefono, claveHash, categoria }),
    );
    return { token: firmarToken(usuario), usuario };
  } catch (error) {
    if (error.code === VIOLACION_UNIQUE) {
      throw new ErrorApp(CODIGOS_ERROR.CONFLICTO, 'Ese teléfono ya está registrado');
    }
    throw error;
  }
}

/**
 * @param {{ telefono: string, clave: string }} credenciales
 * @returns {Promise<{ token: string, usuario: object }>}
 * @throws {ErrorApp} NO_AUTENTICADO si el teléfono o la clave no coinciden
 */
export async function iniciarSesion({ telefono, clave }) {
  const usuario = await usuarios.buscarPorTelefono(pool, telefono);
  const claveCorrecta = usuario && (await bcrypt.compare(clave, usuario.clave_hash));
  if (!claveCorrecta) {
    throw new ErrorApp(CODIGOS_ERROR.NO_AUTENTICADO, 'Teléfono o clave incorrectos');
  }
  return { token: firmarToken(usuario), usuario };
}

/**
 * Verifica un JWT y devuelve el id del usuario.
 * @param {string} token
 * @returns {string} id del usuario
 * @throws {ErrorApp} NO_AUTENTICADO si el token es inválido o venció
 */
export function verificarToken(token) {
  try {
    return jwt.verify(token, config.jwt.secreto, { algorithms: ['HS256'] }).sub;
  } catch {
    throw new ErrorApp(CODIGOS_ERROR.NO_AUTENTICADO, 'Tu sesión venció, vuelve a entrar');
  }
}

/** @param {string} clave @returns {Promise<string>} */
export function hashearClave(clave) {
  return bcrypt.hash(clave, COSTO_BCRYPT);
}

/** ¿El error es una violación de UNIQUE de Postgres? */
export function esViolacionUnique(error) {
  return error?.code === VIOLACION_UNIQUE;
}

function firmarToken(usuario) {
  return jwt.sign({ rol: usuario.rol }, config.jwt.secreto, {
    subject: usuario.id,
    expiresIn: config.jwt.expira,
    algorithm: 'HS256',
  });
}
