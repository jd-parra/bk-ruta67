import { CODIGOS_ERROR } from '../../shared/codigos.js';

/** Estado HTTP por defecto de cada código (CONTRATO.md §12). */
const ESTADO_POR_CODIGO = {
  [CODIGOS_ERROR.VALIDACION]: 400,
  [CODIGOS_ERROR.NO_AUTENTICADO]: 401,
  [CODIGOS_ERROR.ROL_INVALIDO]: 403,
  [CODIGOS_ERROR.CUENTA_BLOQUEADA]: 403,
  [CODIGOS_ERROR.NO_ENCONTRADO]: 404,
  [CODIGOS_ERROR.CONFLICTO]: 409,
  [CODIGOS_ERROR.SALDO_INSUFICIENTE]: 422,
  [CODIGOS_ERROR.TRAMO_INVALIDO]: 422,
  [CODIGOS_ERROR.ERROR_INTERNO]: 500,
};

/**
 * Error de negocio que el manejadorErrores convierte en
 * `{ error: { codigo, mensaje, detalle? } }`.
 */
export class ErrorApp extends Error {
  /**
   * @param {string} codigo uno de CODIGOS_ERROR
   * @param {string} mensaje texto apto para mostrar al usuario
   * @param {{ estado?: number, detalle?: unknown }} [opciones]
   */
  constructor(codigo, mensaje, { estado, detalle } = {}) {
    super(mensaje);
    this.name = 'ErrorApp';
    this.codigo = codigo;
    this.estado = estado ?? ESTADO_POR_CODIGO[codigo] ?? 400;
    this.detalle = detalle;
  }
}
