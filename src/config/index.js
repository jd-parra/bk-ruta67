// Único lugar que lee process.env. Si falta algo obligatorio, el proceso no arranca.
import { z } from 'zod';

const SECRETO_DE_EJEMPLO = 'cambia-esto-por-una-cadena-larga-y-aleatoria';
const LARGO_MINIMO_SECRETO_PRODUCCION = 32;

const esquemaEntorno = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  DATABASE_URL_PRUEBAS: z.string().optional(),
  PGSSL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((valor) => valor === 'true'),
  JWT_SECRETO: z.string().min(16),
  JWT_EXPIRA: z.string().default('7d'),
  LLAVE_FIRMA_BOLETOS: z.string().optional(),
  // Orígenes permitidos para el navegador (panel web), separados por coma. "*" = cualquiera.
  CORS_ORIGENES: z.string().optional(),
  // Intentos fallidos de login por teléfono e IP cada 15 minutos.
  LIMITE_LOGIN: z.coerce.number().int().positive().default(10),
  // Registros por IP cada hora.
  LIMITE_REGISTRO: z.coerce.number().int().positive().default(20),
});

/**
 * Valida el entorno y arma la configuración.
 * @param {Record<string, string | undefined>} entorno
 * @returns {object} configuración congelada
 * @throws {Error} si falta una variable obligatoria o, en producción, si algo es inseguro
 */
export function leerConfig(entorno) {
  const resultado = esquemaEntorno.safeParse(entorno);
  if (!resultado.success) {
    const faltantes = resultado.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Configuración inválida: ${faltantes}`);
  }

  const env = resultado.data;
  const esDesarrollo = env.NODE_ENV !== 'production';
  if (!esDesarrollo) validarProduccion(env);

  return Object.freeze({
    entorno: env.NODE_ENV,
    esDesarrollo,
    puerto: env.PORT,
    bd: {
      url:
        env.NODE_ENV === 'test' && env.DATABASE_URL_PRUEBAS
          ? env.DATABASE_URL_PRUEBAS
          : env.DATABASE_URL,
      // Las pruebas siempre usan el Postgres local (sin SSL), aunque .env apunte a Supabase.
      ssl: env.NODE_ENV === 'test' ? false : env.PGSSL,
    },
    jwt: { secreto: env.JWT_SECRETO, expira: env.JWT_EXPIRA },
    secretoJwtDeEjemplo: env.JWT_SECRETO === SECRETO_DE_EJEMPLO,
    llaveFirmaBoletos: env.LLAVE_FIRMA_BOLETOS || null,
    corsOrigenes: leerOrigenes(env.CORS_ORIGENES),
    limites: { login: env.LIMITE_LOGIN, registro: env.LIMITE_REGISTRO },
  });
}

function validarProduccion(env) {
  const problemas = [];
  if (!env.LLAVE_FIRMA_BOLETOS) problemas.push('LLAVE_FIRMA_BOLETOS es obligatoria');
  if (
    env.JWT_SECRETO === SECRETO_DE_EJEMPLO ||
    env.JWT_SECRETO.length < LARGO_MINIMO_SECRETO_PRODUCCION
  ) {
    problemas.push(
      `JWT_SECRETO debe ser aleatorio y de ${LARGO_MINIMO_SECRETO_PRODUCCION}+ caracteres`,
    );
  }
  if (!env.CORS_ORIGENES || env.CORS_ORIGENES.trim() === '*') {
    problemas.push('CORS_ORIGENES debe listar los orígenes del panel (no "*")');
  }
  if (problemas.length > 0) {
    throw new Error(`Configuración insegura para producción: ${problemas.join('; ')}`);
  }
}

/** "*" o vacío → cualquiera (true); si no, la lista. */
function leerOrigenes(valor) {
  if (!valor || valor.trim() === '*') return true;
  return valor
    .split(',')
    .map((origen) => origen.trim())
    .filter(Boolean);
}

export const config = leerConfig(process.env);
