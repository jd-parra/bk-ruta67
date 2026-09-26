// Constantes compartidas entre el backend y la app (CONTRATO.md §8, §9 y §12).
// JS puro: sin APIs de Node. Si cambias algo aquí, avisa en el grupo.

/** Códigos de error de la API y de la app del recolector (§12). */
export const CODIGOS_ERROR = Object.freeze({
  VALIDACION: 'VALIDACION',
  NO_AUTENTICADO: 'NO_AUTENTICADO',
  ROL_INVALIDO: 'ROL_INVALIDO',
  CUENTA_BLOQUEADA: 'CUENTA_BLOQUEADA',
  SALDO_INSUFICIENTE: 'SALDO_INSUFICIENTE',
  TRAMO_INVALIDO: 'TRAMO_INVALIDO',
  BOLETO_INVALIDO: 'BOLETO_INVALIDO',
  BOLETO_VENCIDO: 'BOLETO_VENCIDO',
  BOLETO_USADO: 'BOLETO_USADO',
  BOLETO_INSUFICIENTE: 'BOLETO_INSUFICIENTE',
  NO_ENCONTRADO: 'NO_ENCONTRADO',
  CONFLICTO: 'CONFLICTO',
  ERROR_INTERNO: 'ERROR_INTERNO',
});

export const ROLES = Object.freeze({
  PASAJERO: 'pasajero',
  RECOLECTOR: 'recolector',
  CENTRAL: 'central',
});

export const CATEGORIAS = Object.freeze({
  GENERAL: 'general',
  ESTUDIANTE: 'estudiante',
  EXONERADO: 'exonerado',
});

/** Byte de categoría dentro del boleto (§8.1). */
export const CATEGORIA_A_BYTE = Object.freeze({ general: 0, estudiante: 1, exonerado: 2 });
export const BYTE_A_CATEGORIA = Object.freeze(['general', 'estudiante', 'exonerado']);

/** Formato del boleto firmado (§8.1). */
export const BOLETO = Object.freeze({
  VERSION: 0x01,
  BYTES_FIRMADOS: 42,
  BYTES_FIRMA: 64,
  BYTES_TOTAL: 106,
  DIAS_VIGENCIA: 7,
  TOLERANCIA_RELOJ_SEG: 10 * 60,
});

/** Límites de negocio. */
export const LIMITES = Object.freeze({
  MAX_BOLETOS_ACTIVOS: 5,
  VENTANA_ANULAR_MS: 2 * 60 * 1000,
  CODIGO_MIN: 1,
  CODIGO_MAX: 65535,
});

/** Zona horaria para decidir domingo o feriado (§7). */
export const ZONA_HORARIA = 'America/Caracas';

/** Protocolo NFC (§9). */
export const NFC = Object.freeze({
  AID: 'F0504153450002',
  PREFIJO_QR: 'P2:',
});
