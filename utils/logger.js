/**
 * utils/logger.js
 *
 * Structured logger using Winston + Morgan HTTP request logging.
 *
 * Usage:
 *   const logger = require('./utils/logger');
 *   logger.info('Server started', { port: 5000 });
 *   logger.error('Something failed', { err: error.message, stack: error.stack });
 *
 * In server.js add:
 *   const { morganMiddleware } = require('./utils/logger');
 *   app.use(morganMiddleware);  // ← before routes
 *
 * Log levels (lowest → highest):
 *   error > warn > info > http > debug
 *
 * In production (NODE_ENV=production):
 *   - Console transport uses JSON format
 *   - File transports write to logs/error.log and logs/combined.log
 *   - Daily rotation keeps 30 days of logs, max 20MB per file
 *
 * In development:
 *   - Console transport uses colourised simple format
 *   - No file output (keeps dev workflow clean)
 */

const winston = require('winston');
const morgan  = require('morgan');

const { combine, timestamp, errors, json, colorize, printf } = winston.format;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const isProd = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

// Human-readable format for development
const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} [${level}]: ${stack || message}${metaStr}`;
  })
);

// Structured JSON for production / log aggregators (ELK, Datadog, CloudWatch)
const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json()
);

// ─── Transports ───────────────────────────────────────────────────────────────

const transports = [
  new winston.transports.Console({
    silent: isTest,          // suppress all output during Jest runs
    format: isProd ? prodFormat : devFormat,
  }),
];

if (isProd) {
  // Requires: npm i winston-daily-rotate-file
  try {
    const DailyRotateFile = require('winston-daily-rotate-file');

    transports.push(
      new DailyRotateFile({
        filename:      'logs/error-%DATE%.log',
        datePattern:   'YYYY-MM-DD',
        level:         'error',
        maxFiles:      '30d',
        maxSize:       '20m',
        zippedArchive: true,
        format:        prodFormat,
      }),
      new DailyRotateFile({
        filename:      'logs/combined-%DATE%.log',
        datePattern:   'YYYY-MM-DD',
        maxFiles:      '30d',
        maxSize:       '20m',
        zippedArchive: true,
        format:        prodFormat,
      })
    );
  } catch (_) {
    // winston-daily-rotate-file not installed — fall back to static files
    transports.push(
      new winston.transports.File({ filename: 'logs/error.log',    level: 'error', format: prodFormat }),
      new winston.transports.File({ filename: 'logs/combined.log',               format: prodFormat })
    );
  }
}

// ─── Logger instance ─────────────────────────────────────────────────────────

const logger = winston.createLogger({
  level: isProd ? 'info' : 'debug',
  transports,
  // Don't crash the process on uncaught logger errors
  exitOnError: false,
});

// ─── Morgan HTTP middleware ───────────────────────────────────────────────────

// Pipe Morgan output into Winston so all logs go through one system
const morganStream = {
  write: (message) => logger.http(message.trim()),
};

const morganMiddleware = morgan(
  isProd
    ? ':remote-addr :method :url :status :res[content-length] - :response-time ms'
    : 'dev',
  { stream: morganStream, skip: () => isTest }
);

module.exports = logger;
module.exports.morganMiddleware = morganMiddleware;
