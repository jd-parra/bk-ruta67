import { aplicarAjustes } from '../../../shared/tarifa.js';
import { pool } from '../../bd/pool.js';
import { vigenteYProximo } from '../tabuladores/servicio.js';
import { categoriaEfectiva } from '../usuarios/categoria.js';
import * as repositorio from './repositorio.js';
import { serializarBilletera, serializarMovimiento } from './serializadores.js';

/**
 * Billetera del pasajero en forma de contrato.
 * `tarifaReferencia` = urbano mínimo con el descuento de su categoría (sin recargo).
 * @param {object} usuario fila de BD
 * @param {import('pg').Pool | import('pg').PoolClient} [bd]
 */
export async function obtenerBilletera(usuario, bd = pool) {
  const [saldos, boletosActivos, avisos, { tabulador }] = await Promise.all([
    repositorio.leerSaldos(bd, usuario.id),
    repositorio.contarBoletosActivos(bd, usuario.id),
    repositorio.listarAvisos(bd, usuario.id),
    vigenteYProximo(bd),
  ]);
  const descuento = tabulador.descuentos[categoriaEfectiva(usuario)];
  const tarifaReferencia = aplicarAjustes(tabulador.urbanoMinimo, 0, descuento);
  return serializarBilletera({ saldos, boletosActivos, tarifaReferencia, avisos });
}

/**
 * Billetera por id de usuario (para eventos y respuestas después de una transacción).
 * @param {string} usuarioId
 */
export async function obtenerBilleteraPorId(usuarioId) {
  const { rows } = await pool.query(
    'SELECT id, categoria, categoria_verificada FROM pasaje.usuarios WHERE id = $1',
    [usuarioId],
  );
  return obtenerBilletera(rows[0]);
}

/**
 * Últimos movimientos del pasajero.
 * @param {string} usuarioId
 * @param {number} limite
 */
export async function listarMovimientos(usuarioId, limite) {
  const filas = await repositorio.listarMovimientos(pool, usuarioId, limite);
  return filas.map(serializarMovimiento);
}
