import { z } from 'zod';
import { CATEGORIAS, ROLES } from '../../../shared/codigos.js';

// Celulares venezolanos: 0412, 0414, 0416, 0424, 0426…
const telefono = z
  .string({ error: 'El teléfono es obligatorio' })
  .trim()
  .regex(/^04\d{9}$/, 'El teléfono debe tener 11 dígitos y empezar por 04');

const clave = z
  .string({ error: 'La clave es obligatoria' })
  .min(4, 'La clave debe tener al menos 4 caracteres')
  .max(72, 'La clave no puede tener más de 72 caracteres');

export const esquemaRegistro = z.object({
  nombre: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(2, 'El nombre es muy corto')
    .max(80, 'El nombre es muy largo'),
  telefono,
  clave,
  // El registro público solo crea pasajeros; recolectores y central los crea la central.
  rol: z
    .literal(ROLES.PASAJERO, { error: 'Solo los pasajeros pueden registrarse desde la app' })
    .optional(),
  categoria: z
    .enum(Object.values(CATEGORIAS), { error: 'Categoría inválida' })
    .default(CATEGORIAS.GENERAL),
});

export const esquemaLogin = z.object({
  telefono,
  clave: z.string({ error: 'La clave es obligatoria' }).min(1, 'La clave es obligatoria'),
});
