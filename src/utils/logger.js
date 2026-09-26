import pino from 'pino';
import { config } from '../config/index.js';

export const logger = pino({
  level: config.entorno === 'test' ? 'silent' : 'info',
  redact: ['req.headers.authorization', '*.clave', '*.token', '*.raw'],
});
