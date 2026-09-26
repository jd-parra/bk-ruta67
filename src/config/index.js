// Único lugar que lee process.env. Si falta algo obligatorio, el proceso no arranca.
import { z } from 'zod';

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
});

/**
 * Valida el entorno y arma la configuración.
 * @param {Record<string, string | undefined>} entorno
 * @returns {object} configuración congelada
 * @throws {Error} si falta una variable obligatoria
 */
export function leerConfig(entorno) {
  const resultado = esquemaEntorno.safeParse(entorno);
  if (!resultado.success) {
    const faltantes = resultado.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Configuración inválida: ${faltantes}`);
  }

  const env = resultado.data;
  const esDesarrollo = env.NODE_ENV !== 'production';
  if (!esDesarrollo && !env.LLAVE_FIRMA_BOLETOS) {
    throw new Error('Configuración inválida: LLAVE_FIRMA_BOLETOS es obligatoria en producción');
  }

  return Object.freeze({
    entorno: env.NODE_ENV,
    esDesarrollo,
    puerto: env.PORT,
    bd: {
      url:
        env.NODE_ENV === 'test' && env.DATABASE_URL_PRUEBAS
          ? env.DATABASE_URL_PRUEBAS
          : env.DATABASE_URL,
      ssl: env.PGSSL,
    },
    jwt: { secreto: env.JWT_SECRETO, expira: env.JWT_EXPIRA },
    llaveFirmaBoletos: env.LLAVE_FIRMA_BOLETOS || null,
  });
}

export const config = leerConfig(process.env);
