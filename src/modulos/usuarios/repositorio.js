const COLUMNAS = `id, nombre, telefono, clave_hash, rol, categoria, categoria_verificada,
  bloqueado, creado_en`;

/**
 * @param {import('pg').Pool | import('pg').PoolClient} bd
 * @param {string} id
 */
export async function buscarPorId(bd, id) {
  const { rows } = await bd.query(`SELECT ${COLUMNAS} FROM pasaje.usuarios WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

/**
 * @param {import('pg').Pool | import('pg').PoolClient} bd
 * @param {string} telefono
 */
export async function buscarPorTelefono(bd, telefono) {
  const { rows } = await bd.query(`SELECT ${COLUMNAS} FROM pasaje.usuarios WHERE telefono = $1`, [
    telefono,
  ]);
  return rows[0] ?? null;
}

/**
 * Inserta un recolector (lo crea la central al asignarlo a una unidad).
 * @param {import('pg').PoolClient} cliente
 * @param {{ nombre: string, telefono: string, claveHash: string }} datos
 */
export async function crearRecolector(cliente, { nombre, telefono, claveHash }) {
  const { rows } = await cliente.query(
    `INSERT INTO pasaje.usuarios (nombre, telefono, clave_hash, rol)
     VALUES ($1, $2, $3, 'recolector')
     RETURNING ${COLUMNAS}`,
    [nombre, telefono, claveHash],
  );
  return rows[0];
}

/**
 * Inserta un pasajero con su billetera vacía.
 * @param {import('pg').PoolClient} cliente dentro de una transacción
 * @param {{ nombre: string, telefono: string, claveHash: string, categoria: string }} datos
 */
export async function crearPasajero(cliente, { nombre, telefono, claveHash, categoria }) {
  const { rows } = await cliente.query(
    `INSERT INTO pasaje.usuarios (nombre, telefono, clave_hash, rol, categoria, categoria_verificada)
     VALUES ($1, $2, $3, 'pasajero', $4, $5)
     RETURNING ${COLUMNAS}`,
    [nombre, telefono, claveHash, categoria, categoria === 'general'],
  );
  await cliente.query('INSERT INTO pasaje.billeteras (usuario_id) VALUES ($1)', [rows[0].id]);
  return rows[0];
}
