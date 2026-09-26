import pino from 'pino';
import { config } from '../config/index.js';

const NIVEL = config.entorno === 'test' ? 'silent' : 'info';

// En desarrollo, logs legibles; en producción, JSON para poder procesarlos.
const transporte =
  config.entorno === 'development'
    ? {
        target: 'pino-pretty',
        options: {
          translateTime: 'SYS:HH:MM:ss',
          ignore: 'pid,hostname,req,res,responseTime,reqId',
        },
      }
    : undefined;

export const logger = pino({
  level: NIVEL,
  transport: transporte,
  redact: ['req.headers.authorization', '*.clave', '*.token', '*.raw'],
});
