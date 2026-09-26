import http from 'node:http';
import { crearApp } from './app.js';
import { config } from './config/index.js';
import { calentarPool, pool } from './bd/pool.js';
import { iniciarTiempoReal } from './tiempoReal/socket.js';
import { programarVencimientos } from './trabajos/vencerBoletos.js';
import { logger } from './utils/logger.js';

const servidor = http.createServer(crearApp());
const io = iniciarTiempoReal(servidor);
const tareaVencimientos = programarVencimientos();

servidor.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    logger.error(
      `El puerto ${config.puerto} está ocupado: ¿ya tienes el backend corriendo en otra terminal?`,
    );
    process.exit(1);
  }
  throw error;
});

servidor.listen(config.puerto, () => {
  logger.info(`Pasaje escuchando en http://0.0.0.0:${config.puerto}/api/v1`);
  calentarPool().catch((error) => logger.warn({ err: error }, 'no se pudo calentar la BD'));
  if (config.secretoJwtDeEjemplo) {
    logger.warn('JWT_SECRETO es el de ejemplo: cámbialo antes de usar esto con gente real');
  }
});

async function apagar(senal) {
  logger.info(`${senal} recibido, cerrando`);
  // Cierra también las conexiones keep-alive: así el puerto se libera al instante
  // y nodemon puede levantar el proceso nuevo sin chocar.
  tareaVencimientos.stop();
  io.close();
  servidor.close();
  servidor.closeAllConnections();
  await pool.end();
  process.exit(0);
}

process.on('SIGINT', apagar);
process.on('SIGTERM', apagar);
