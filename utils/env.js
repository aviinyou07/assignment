require('dotenv').config();
const logger = require('./logger');

function validateEnv() {
  const required = [
    'JWT_SECRET',
    // Add DB vars here if you want strict DB start checks
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN'
  ];

  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    logger.error(`Missing required environment variables: ${missing.join(', ')}`);
    // Fail-fast in non-production environments only if critical
    if ((process.env.NODE_ENV || 'development') !== 'development') {
      process.exit(1);
    }
  } else {
    logger.info('Environment validation passed');
  }
}

module.exports = { validateEnv };
