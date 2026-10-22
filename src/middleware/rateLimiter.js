/**
 * CleanXhedule Manager — Middleware: Rate Limiting
 *
 * authLimiter : 5 tentativas / 15 min (protege POST /auth/login)
 * apiLimiter  : 100 req / min para a API geral autenticada
 */
'use strict';

const rateLimit = require('express-rate-limit');
const config    = require('../config');

/** Mensagem padrão devolvida quando o limite é atingido */
const rateLimitHandler = (req, res) => {
  res.status(429).json({
    success: false,
    error: 'Demasiadas requisições. Por favor aguarde e tente novamente.',
    code:  'RATE_LIMIT_EXCEEDED',
  });
};

/**
 * Limiter restrito para endpoints de autenticação.
 * Previne ataques de força bruta a passwords.
 */
const authLimiter = rateLimit({
  windowMs:         config.rateLimit.auth.windowMs,
  max:              config.rateLimit.auth.max,
  standardHeaders:  true,
  legacyHeaders:    false,
  skipSuccessfulRequests: false,
  handler:          rateLimitHandler,
  // Em testes, desativa o limiter para não interferir
  skip: () => config.isTest,
});

/**
 * Limiter geral para todas as rotas da API autenticada.
 */
const apiLimiter = rateLimit({
  windowMs:        config.rateLimit.api.windowMs,
  max:             config.rateLimit.api.max,
  standardHeaders: true,
  legacyHeaders:   false,
  handler:         rateLimitHandler,
  skip: () => config.isTest,
});

module.exports = { authLimiter, apiLimiter };
