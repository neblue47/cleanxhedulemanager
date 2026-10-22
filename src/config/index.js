/**
 * CleanXhedule Manager — Configuração Central
 * Carrega .env e exporta todas as constantes com defaults seguros.
 */
'use strict';

require('dotenv').config();

const path = require('path');

const config = {
  // ── Servidor ──────────────────────────────────────────────────────────────
  port:    parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  isDev:   (process.env.NODE_ENV || 'development') === 'development',
  isTest:  process.env.NODE_ENV === 'test',

  // ── Banco de Dados ────────────────────────────────────────────────────────
  dbPath: process.env.DB_PATH
    ? path.resolve(process.env.DB_PATH)
    : path.join(__dirname, '..', '..', 'data', 'cleanxhedule.db'),

  // Em testes, sempre usa banco em memória
  get dbPathResolved() {
    return config.isTest ? ':memory:' : config.dbPath;
  },

  // ── JWT ───────────────────────────────────────────────────────────────────
  jwt: {
    secret:              process.env.JWT_SECRET        || 'dev_secret_change_in_prod',
    refreshSecret:       process.env.JWT_REFRESH_SECRET || 'dev_refresh_secret_change',
    expiresIn:           process.env.JWT_EXPIRES_IN     || '1h',
    refreshExpiresIn:    process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  // ── CORS ──────────────────────────────────────────────────────────────────
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',

  // ── Rate Limiting ─────────────────────────────────────────────────────────
  rateLimit: {
    // Janela de 15 minutos para autenticação (máx. 5 tentativas em prod, 200 em dev)
    auth: {
      windowMs: 15 * 60 * 1000,
      max: (process.env.NODE_ENV || 'development') === 'development' ? 200 : 5,
    },
    // Janela de 1 minuto para API geral
    api: {
      windowMs: 60 * 1000,
      max: 100,
    },
  },

  // ── bcrypt ────────────────────────────────────────────────────────────────
  bcryptRounds: 12,
};

// Aviso de segurança em produção com secrets padrão
if (!config.isDev && !config.isTest) {
  if (config.jwt.secret === 'dev_secret_change_in_prod') {
    throw new Error('[CONFIG] JWT_SECRET não configurado! Defina em .env antes de iniciar em produção.');
  }
}

module.exports = config;
