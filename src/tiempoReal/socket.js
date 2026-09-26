// Socket.IO (CONTRATO.md §11): io(base, { auth: { token } }).
import { Server } from 'socket.io';
import { ROLES } from '../../shared/codigos.js';
import { pool } from '../bd/pool.js';
import { config } from '../config/index.js';
import { verificarToken } from '../modulos/auth/servicio.js';
import { buscarPorId } from '../modulos/usuarios/repositorio.js';
import { logger } from '../utils/logger.js';
import { configurarEmisor } from './emisor.js';
import { SALAS } from './eventos.js';

/**
 * Levanta Socket.IO sobre el servidor HTTP y conecta el emisor.
 * @param {import('node:http').Server} servidorHttp
 * @returns {Server}
 */
export function iniciarTiempoReal(servidorHttp) {
  const io = new Server(servidorHttp, { cors: { origin: config.corsOrigenes } });

  io.use(async (socket, next) => {
    try {
      const usuario = await buscarPorId(pool, verificarToken(socket.handshake.auth?.token ?? ''));
      if (!usuario) throw new Error('usuario inexistente');
      socket.data.usuario = usuario;
      next();
    } catch {
      next(new Error('NO_AUTENTICADO'));
    }
  });

  io.on('connection', (socket) => {
    const { id, rol } = socket.data.usuario;
    socket.join(SALAS.usuario(id));
    socket.join(SALAS.rol(rol));
    if (rol === ROLES.CENTRAL) socket.join(SALAS.CENTRAL);
    logger.info(`socket conectado: ${rol} ${id}`);
  });

  configurarEmisor((sala, evento, datos) => {
    if (sala === SALAS.TODOS) io.emit(evento, datos);
    else io.to(sala).emit(evento, datos);
  });
  return io;
}
