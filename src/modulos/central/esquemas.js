import { z } from 'zod';
import { LIMITES } from '../../../shared/codigos.js';
import { esquemaRegistro } from '../auth/esquemas.js';

const codigoCorto = z.number().int().min(LIMITES.CODIGO_MIN).max(LIMITES.CODIGO_MAX);
const centimos = z.number().int('Los montos van en céntimos, sin decimales').min(0);
const fraccion = z.number().min(0).max(1);
const punto = z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]);

export const esquemaDesde = z.object({ desde: z.iso.datetime({ offset: true }).optional() });
export const esquemaId = z.object({ id: z.uuid('id inválido') });

export const esquemaTabulador = z.object({
  fuente: z.string().trim().min(3, 'Indica la fuente (gaceta o acuerdo)'),
  vigenteDesde: z.iso.datetime({ offset: true, error: 'vigenteDesde debe ser ISO 8601' }),
  descuentos: z.object({ general: fraccion, estudiante: fraccion, exonerado: fraccion }),
  recargoDomingoFeriado: fraccion,
  urbanoMinimo: centimos,
  suburbano: z
    .array(z.object({ hastaKm: z.number().positive(), monto: centimos }))
    .min(1, 'La escala suburbana necesita al menos un rango')
    .refine(
      (escala) => escala.every((r, i) => i === 0 || r.hastaKm > escala[i - 1].hastaKm),
      'Los rangos suburbanos deben ir de menor a mayor hastaKm',
    ),
});

const esquemaTramo = z.object({
  codigo: codigoCorto,
  nombre: z.string().trim().min(2),
  km: z.number().positive(),
  tarifaManual: centimos.nullable().optional(),
  // Recorrido en el mapa: [lat, lng] en orden. null lo borra; sin enviar deja el que tenía.
  trazo: z.array(punto).min(2, 'El trazo necesita al menos dos puntos').max(500).nullable().optional(),
  // Paradas, en orden de recorrido. Son aparte del trazo: los puntos del trazo solo dan la forma.
  paradas: z
    .array(
      z.object({
        nombre: z.string().trim().min(1, 'Cada parada necesita un nombre').max(60),
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
      }),
    )
    .max(100)
    .nullable()
    .optional(),
});

const tramosSinRepetir = (tramos) => new Set(tramos.map((t) => t.codigo)).size === tramos.length;

export const esquemaLinea = z.object({
  codigo: codigoCorto,
  nombre: z.string().trim().min(2),
  tipo: z.enum(['urbana', 'suburbana']),
  tramos: z.array(esquemaTramo).min(1).refine(tramosSinRepetir, 'Hay códigos de tramo repetidos'),
});

export const esquemaLineaCambios = z.object({
  nombre: z.string().trim().min(2).optional(),
  tipo: z.enum(['urbana', 'suburbana']).optional(),
  tramos: z
    .array(esquemaTramo)
    .refine(tramosSinRepetir, 'Hay códigos de tramo repetidos')
    .optional(),
});

export const esquemaCategoria = z.object({ verificada: z.boolean() });
export const esquemaBloqueo = z.object({ bloqueado: z.boolean() });
export const esquemaConflictos = z.object({ todos: z.enum(['true', 'false']).optional() });

// Un recolector nuevo se crea con los mismos datos que un registro (sin categoría).
const esquemaRecolectorNuevo = esquemaRegistro.pick({ nombre: true, telefono: true, clave: true });

export const esquemaUnidad = z.object({
  codigo: codigoCorto,
  placa: z.string().trim().toUpperCase().min(5).max(10),
  lineaCodigo: codigoCorto,
  recolectorId: z.uuid().nullable().optional(),
  recolector: esquemaRecolectorNuevo.optional(),
});

export const esquemaUnidadCambios = z.object({
  lineaCodigo: codigoCorto.optional(),
  recolectorId: z.uuid().nullable().optional(),
  recolector: esquemaRecolectorNuevo.optional(),
});
