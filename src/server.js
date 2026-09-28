/**
 * Server Entry Point
 */
// Setup console override for log viewer BEFORE importing logger
const { setupConsoleOverride } = require('./routes/logRoutes');
setupConsoleOverride();

const app = require('./app');
const config = require('./config');
const logger = require('./utils/logger');

const server = app.listen(config.port, () => {
  logger.success(`Server running on http://localhost:${config.port}`);
  logger.info(`Environment: ${config.env}`);
  logger.info(`Mail mode: ${config.mail.mode}`);
  logger.info(`UI test page: http://localhost:${config.port}/`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down...');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down...');
  server.close(() => process.exit(0));
});
