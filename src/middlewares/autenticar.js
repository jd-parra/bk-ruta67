import { CODIGOS_ERROR } from '../../shared/codigos.js';
import { pool } from '../bd/pool.js';
import { verificarToken } from '../modulos/auth/servicio.js';
import { buscarPorId } from '../modulos/usuarios/repositorio.js';
import { ErrorApp } from '../utils/ErrorApp.js';

const PREFIJO_BEARER = 'Bearer ';

/**
 * Exige `Authorization: Bearer <jwt>` y deja el usuario en `req.usuario`.
 * El usuario se lee de la BD en cada petición: así un bloqueo aplica al instante.
 * @param {{ permitirBloqueado?: boolean }} [opciones] true solo para GET /me
 */
export function autenticar({ permitirBloqueado = false } = {}) {
  return async (req, _res, next) => {
    const cabecera = req.get('authorization') ?? '';
    if (!cabecera.startsWith(PREFIJO_BEARER)) {
      throw new ErrorApp(CODIGOS_ERROR.NO_AUTENTICADO, 'Debes iniciar sesión');
    }

    const usuario = await buscarPorId(pool, verificarToken(cabecera.slice(PREFIJO_BEARER.length)));
    if (!usuario) throw new ErrorApp(CODIGOS_ERROR.NO_AUTENTICADO, 'Debes iniciar sesión');
    if (usuario.bloqueado && !permitirBloqueado) {
      throw new ErrorApp(
        CODIGOS_ERROR.CUENTA_BLOQUEADA,
        'Tu cuenta está bloqueada. Comunícate con la central',
      );
    }

    req.usuario = usuario;
    next();
  };
}

/**
 * Deja pasar solo a los roles indicados (usar después de `autenticar`).
 * @param {...string} roles
 */
export function exigirRol(...roles) {
  return (req, _res, next) => {
    if (!roles.includes(req.usuario.rol)) {
      throw new ErrorApp(CODIGOS_ERROR.ROL_INVALIDO, 'No tienes permiso para hacer esto');
    }
    next();
  };
}
