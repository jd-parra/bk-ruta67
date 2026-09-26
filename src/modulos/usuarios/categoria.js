import { CATEGORIAS } from '../../../shared/codigos.js';

/**
 * Categoría con la que se cobra: si no está verificada, se cobra como general (§5).
 * @param {{ categoria: string, categoria_verificada: boolean }} usuario fila de BD
 * @returns {string}
 */
export function categoriaEfectiva(usuario) {
  return usuario.categoria_verificada ? usuario.categoria : CATEGORIAS.GENERAL;
}
