import winston from 'winston';

// ==========================================
// CONFIGURACIÓN DEL LOGGER
// ==========================================
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'elisa-ia' },
  transports: [
    // Errores van a archivo separado
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    // Todos los logs van a combined
    new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});

// En desarrollo, también mostrar en consola
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    ),
  }));
}
