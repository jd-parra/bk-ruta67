import http from 'node:http';
import { crearApp } from './app.js';
import { config } from './config/index.js';
import { pool } from './bd/pool.js';
import { logger } from './utils/logger.js';

const servidor = http.createServer(crearApp());

servidor.listen(config.puerto, () => {
  logger.info(`Pasaje escuchando en http://0.0.0.0:${config.puerto}/api/v1`);
});

async function apagar(senal) {
  logger.info(`${senal} recibido, cerrando`);
  servidor.close();
  await pool.end();
  process.exit(0);
}

process.on('SIGINT', apagar);
process.on('SIGTERM', apagar);
