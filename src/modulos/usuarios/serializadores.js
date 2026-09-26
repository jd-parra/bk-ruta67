/**
 * Fila de `pasaje.usuarios` → `Usuario` del contrato (§5). Nunca incluye la clave.
 * @param {object} fila
 */
export function serializarUsuario(fila) {
  return {
    id: fila.id,
    nombre: fila.nombre,
    telefono: fila.telefono,
    rol: fila.rol,
    categoria: fila.categoria,
    categoriaVerificada: fila.categoria_verificada,
    bloqueado: fila.bloqueado,
    creadoEn: fila.creado_en.toISOString(),
  };
}
