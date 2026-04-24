/**
 * 🪵 LOGGER — Winston Estructurado
 * 
 * CORRECCIÓN: Reemplaza los 344 console.log dispersos por un logger
 * centralizado con niveles, timestamps, y JSON estructurado.
 * 
 * Niveles: error > warn > info > debug
 * En producción: solo info + error (no debug/verbose)
 * En desarrollo: todos los niveles en consola con colores
 */

import { createLogger, format, transports } from 'winston';
import path from 'path';
import fs from 'fs';

const IS_PROD = process.env.NODE_ENV === 'production';
const LOG_LEVEL = process.env.LOG_LEVEL || (IS_PROD ? 'info' : 'debug');
const LOGS_DIR = process.env.LOGS_DIR || path.join(process.cwd(), 'logs');

// Crear directorio de logs si no existe
try {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
} catch {
  // En algunos entornos no se puede crear (Railway, etc.) — no falla
}

// Formato para archivos (JSON estructurado para parseo)
const fileFormat = format.combine(
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  format.errors({ stack: true }),
  format.splat(),
  format.json()
);

// Formato para consola (legible por humanos)
const consoleFormat = format.combine(
  format.colorize(),
  format.timestamp({ format: 'HH:mm:ss' }),
  format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    return `${timestamp} [${level}] ${message}${metaStr}`;
  })
);

const loggerTransports: any[] = [];

// Consola siempre (Railway y Docker capturan stdout)
loggerTransports.push(new transports.Console({
  format: IS_PROD ? fileFormat : consoleFormat,
  level: LOG_LEVEL,
}));

// Archivos solo si el directorio existe y es escribible
try {
  if (fs.existsSync(LOGS_DIR)) {
    loggerTransports.push(
      new transports.File({
        filename: path.join(LOGS_DIR, 'error.log'),
        level: 'error',
        maxsize: 10 * 1024 * 1024, // 10MB
        maxFiles: 10,
      }),
      new transports.File({
        filename: path.join(LOGS_DIR, 'combined.log'),
        maxsize: 20 * 1024 * 1024, // 20MB
        maxFiles: 5,
      })
    );
  }
} catch {
  // Silenciar error de filesystem
}

export const logger = createLogger({
  level: LOG_LEVEL,
  format: fileFormat,
  defaultMeta: { service: 'bizonne-api' },
  transports: loggerTransports,
  exitOnError: false,
});

// ========================
// HELPERS TIPADOS
// ========================

export const log = {
  info:  (msg: string, meta?: object) => logger.info(msg, meta),
  warn:  (msg: string, meta?: object) => logger.warn(msg, meta),
  error: (msg: string, meta?: object) => logger.error(msg, meta),
  debug: (msg: string, meta?: object) => logger.debug(msg, meta),
  /** Solo se imprime si NO está en producción */
  dev:   (msg: string, meta?: object) => { if (!IS_PROD) logger.debug(msg, meta); },
};

export default logger;
