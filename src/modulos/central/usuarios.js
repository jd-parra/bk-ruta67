// Verificación de categorías, conflictos (doble gasto) y bloqueo de cuentas.
import { CATEGORIAS, CODIGOS_ERROR } from '../../../shared/codigos.js';
import { conTransaccion, pool } from '../../bd/pool.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import { crearAviso } from '../billetera/repositorio.js';
import { avisarRecolectores, revocarTodos } from '../boletos/servicio.js';
import { buscarPorId } from '../usuarios/repositorio.js';
import { serializarUsuario } from '../usuarios/serializadores.js';

/** Pasajeros que pidieron estudiante/exonerado y esperan verificación. */
export async function listarCategoriasPendientes() {
  const { rows } = await pool.query(
    `SELECT * FROM pasaje.usuarios
     WHERE rol = 'pasajero' AND categoria <> 'general' AND NOT categoria_verificada
     ORDER BY creado_en`,
  );
  return rows.map(serializarUsuario);
}

/**
 * Aprueba o rechaza la categoría pedida. Rechazar la deja en "general".
 * @param {string} usuarioId
 * @param {boolean} verificada
 * @throws {ErrorApp} NO_ENCONTRADO si no es un pasajero con categoría pendiente
 */
export async function resolverCategoria(usuarioId, verificada) {
  const usuario = await conTransaccion(async (cliente) => {
    const { rows } = await cliente.query(
      `UPDATE pasaje.usuarios
       SET categoria = CASE WHEN $2 THEN categoria ELSE $3 END, categoria_verificada = true
       WHERE id = $1 AND rol = 'pasajero' AND categoria <> 'general' AND NOT categoria_verificada
       RETURNING *`,
      [usuarioId, verificada, CATEGORIAS.GENERAL],
    );
    if (!rows[0]) {
      throw new ErrorApp(
        CODIGOS_ERROR.NO_ENCONTRADO,
        'No hay una categoría pendiente para ese usuario',
      );
    }
    await crearAviso(cliente, {
      usuarioId,
      tipo: verificada ? 'CATEGORIA_APROBADA' : 'CATEGORIA_RECHAZADA',
      mensaje: verificada
        ? `Tu categoría ${rows[0].categoria} fue aprobada. Tus próximos boletos ya tienen el descuento`
        : 'No pudimos verificar tu categoría. Por ahora pagas pasaje general',
    });
    return rows[0];
  });
  return serializarUsuario(usuario);
}

/**
 * Conflictos de doble gasto con el cobro original y el segundo uso.
 * @param {boolean} incluirResueltos
 */
export async function listarConflictos(incluirResueltos) {
  const { rows } = await pool.query(
    `SELECT cf.id, cf.bid, cf.monto, cf.ocurrido_en, cf.creado_en, cf.resuelto_en,
       p.id AS pasajero_id, p.nombre AS pasajero_nombre, p.telefono AS pasajero_telefono,
       p.bloqueado AS pasajero_bloqueado,
       r2.nombre AS recolector_nombre, u2.codigo AS unidad_codigo,
       c.id AS original_id, c.monto AS original_monto, c.ocurrido_en AS original_ocurrido_en,
       c.unidad_codigo AS original_unidad_codigo, r1.nombre AS original_recolector_nombre
     FROM pasaje.conflictos cf
     JOIN pasaje.usuarios p ON p.id = cf.pasajero_id
     JOIN pasaje.usuarios r2 ON r2.id = cf.recolector_id
     JOIN pasaje.unidades u2 ON u2.id = cf.unidad_id
     JOIN pasaje.cobros c ON c.id = cf.cobro_original_id
     JOIN pasaje.usuarios r1 ON r1.id = c.recolector_id
     WHERE $1 OR cf.resuelto_en IS NULL
     ORDER BY cf.creado_en DESC`,
    [incluirResueltos],
  );
  return rows.map(serializarConflicto);
}

function serializarConflicto(f) {
  return {
    id: f.id,
    bid: f.bid,
    pasajero: {
      id: f.pasajero_id,
      nombre: f.pasajero_nombre,
      telefono: f.pasajero_telefono,
      bloqueado: f.pasajero_bloqueado,
    },
    cobroOriginal: {
      id: f.original_id,
      unidadCodigo: f.original_unidad_codigo,
      recolectorNombre: f.original_recolector_nombre,
      monto: f.original_monto,
      ocurridoEn: f.original_ocurrido_en.toISOString(),
    },
    segundoUso: {
      unidadCodigo: f.unidad_codigo,
      recolectorNombre: f.recolector_nombre,
      monto: f.monto,
      ocurridoEn: f.ocurrido_en.toISOString(),
    },
    creadoEn: f.creado_en.toISOString(),
    resuelto: f.resuelto_en !== null,
  };
}

/**
 * Bloquea (revoca sus boletos) o desbloquea (marca sus conflictos como resueltos) una cuenta.
 * @param {string} usuarioId
 * @param {boolean} bloqueado
 * @throws {ErrorApp} NO_ENCONTRADO
 */
export async function cambiarBloqueo(usuarioId, bloqueado) {
  const revocados = await conTransaccion(async (cliente) => {
    const { rowCount } = await cliente.query(
      `UPDATE pasaje.usuarios SET bloqueado = $2 WHERE id = $1 AND rol <> 'central'`,
      [usuarioId, bloqueado],
    );
    if (rowCount === 0) throw new ErrorApp(CODIGOS_ERROR.NO_ENCONTRADO, 'Ese usuario no existe');
    return bloqueado ? bloquear(cliente, usuarioId) : desbloquear(cliente, usuarioId);
  });
  if (revocados > 0) avisarRecolectores();
  return serializarUsuario(await buscarPorId(pool, usuarioId));
}

async function bloquear(cliente, usuarioId) {
  await crearAviso(cliente, {
    usuarioId,
    tipo: 'CUENTA_BLOQUEADA',
    mensaje: 'Tu cuenta fue bloqueada por la central. Comunícate con ellos',
  });
  return revocarTodos(cliente, usuarioId);
}

async function desbloquear(cliente, usuarioId) {
  await cliente.query(
    `UPDATE pasaje.conflictos SET resuelto_en = now()
     WHERE pasajero_id = $1 AND resuelto_en IS NULL`,
    [usuarioId],
  );
  return 0;
}
