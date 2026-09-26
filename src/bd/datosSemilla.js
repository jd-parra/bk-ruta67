// Datos semilla (CONTRATO.md §13). Los usuarios tienen UUID fijo para que los boletos de prueba
// y los mocks coincidan con la base de datos después de cada reinicio.

export const USUARIOS_SEMILLA = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    telefono: '04140000001',
    clave: '1234',
    nombre: 'Ana Pasajera',
    rol: 'pasajero',
    categoria: 'estudiante',
    categoriaVerificada: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000004',
    telefono: '04140000004',
    clave: '1234',
    nombre: 'Pedro General',
    rol: 'pasajero',
    categoria: 'general',
    categoriaVerificada: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000005',
    telefono: '04140000005',
    clave: '1234',
    nombre: 'Rosa Mayor',
    rol: 'pasajero',
    categoria: 'exonerado',
    categoriaVerificada: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    telefono: '04140000002',
    clave: '1234',
    nombre: 'Luis Recolector',
    rol: 'recolector',
  },
  {
    id: '00000000-0000-4000-8000-000000000003',
    telefono: '04140000003',
    clave: '1234',
    nombre: 'Central Mérida',
    rol: 'central',
  },
  {
    id: '00000000-0000-4000-8000-000000000006',
    telefono: '04140000006',
    clave: '1234',
    nombre: 'Marta Recolectora',
    rol: 'recolector',
  },
];

export const TABULADOR_SEMILLA = {
  fuente: 'Tabulador septiembre 2026 (valores de prueba)',
  vigenteDesde: '2026-09-01T04:00:00Z',
  descuentos: { general: 0, estudiante: 0.5, exonerado: 1 },
  recargoDomingoFeriado: 0,
  urbanoMinimo: 20000,
  suburbano: [
    { hastaKm: 10, monto: 28000 },
    { hastaKm: 9999, monto: 99000 },
  ],
};

export const LINEAS_SEMILLA = [
  {
    codigo: 1,
    nombre: 'Chorros de Milla',
    tipo: 'urbana',
    tramos: [
      { codigo: 1, nombre: 'Centro – Chorros de Milla', km: 5 },
      { codigo: 2, nombre: 'Centro – Milla', km: 3 },
    ],
  },
  {
    codigo: 2,
    nombre: 'San Benito',
    tipo: 'urbana',
    tramos: [{ codigo: 1, nombre: 'Centro – San Benito', km: 4 }],
  },
  {
    codigo: 3,
    nombre: 'Mérida – Ejido',
    tipo: 'suburbana',
    tramos: [
      { codigo: 1, nombre: 'Centro – Ejido', km: 9 },
      { codigo: 2, nombre: 'Centro – La Parroquia', km: 6 },
    ],
  },
];

export const UNIDADES_SEMILLA = [
  { codigo: 101, placa: 'AB123CD', linea: 1, recolector: '04140000002' },
  { codigo: 102, placa: 'AC456EF', linea: 3, recolector: '04140000006' },
];
