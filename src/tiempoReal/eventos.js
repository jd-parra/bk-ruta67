// Eventos y salas de Socket.IO (CONTRATO.md §11).

export const EVENTOS = Object.freeze({
  COBRO_CONFIRMADO: 'cobro:confirmado',
  UNIDAD_UBICACION: 'unidad:ubicacion',
  TARIFA_AVISO: 'tarifa:aviso',
  PAQUETE_ACTUALIZADO: 'paquete:actualizado',
});

export const SALAS = Object.freeze({
  usuario: (id) => `usuario:${id}`,
  rol: (rol) => `rol:${rol}`,
  CENTRAL: 'central',
  TODOS: '*',
});
