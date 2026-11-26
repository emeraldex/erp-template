/**
 * Environment for the integration tests. Loaded before any app module, because
 * auth settings are read once at import time.
 *
 * Point TEST_DATABASE_URL at a disposable database: global-setup DROPS and
 * recreates its public schema on every run.
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://erp@localhost:5433/erp_test';
process.env.AUTH_SECRET = 'e2e-secret-0123456789abcdef0123456789abcdef';
process.env.WEB_ORIGIN = 'http://localhost:3000';
process.env.LOGIN_MAX_ATTEMPTS = '3';
process.env.LOGIN_RATE_LIMIT = '1000';
process.env.API_RATE_LIMIT = '100000';
process.env.PORTAL_RATE_LIMIT = '100000';
process.env.PORTAL_HOURLY_LIMIT = '100000';
process.env.SEED_PASSWORD = '';
process.env.SEED_FORCE_PASSWORD_CHANGE = '0';
process.env.STORAGE_DRIVER = 'local';
process.env.ATTACHMENTS_DIR = require('path').join(require('os').tmpdir(), `erp-e2e-attachments-${process.pid}`);
process.env.ATTACHMENT_MAX_MB = '1';
process.env.SCHEDULER_ENABLED = 'false';
process.env.MAIL_TRANSPORT = 'memory';
