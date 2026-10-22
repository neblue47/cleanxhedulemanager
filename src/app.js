/**
 * CleanXhedule Manager — Express App Factory
 *
 * Cria e configura a aplicação Express com:
 *   - Segurança (helmet, cors)
 *   - Parsing JSON
 *   - Rate limiting global
 *   - Montagem das rotas em /api/v1
 *   - Handler 404
 *   - Handler global de erros
 */
'use strict';

const path        = require('path');
const express     = require('express');
const helmet      = require('helmet');
const cors        = require('cors');
const config      = require('./config');
const routes      = require('./routes');
const { errorHandler } = require('./middleware/errorHandler');
const { apiLimiter }   = require('./middleware/rateLimiter');

function createApp() {
  const app = express();

  // ── Segurança ────────────────────────────────────────────────────────────
  app.use(helmet({
    contentSecurityPolicy: false,
  }));

  app.use(cors({
    origin:      config.corsOrigin,
    methods:     ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  }));

  // ── Servir Frontend Estático ──────────────────────────────────────────────
  const frontendPath = path.join(__dirname, '../frontend');
  app.use(express.static(frontendPath));

  // ── Parsing ───────────────────────────────────────────────────────────────
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));

  // ── Rate Limiting global ──────────────────────────────────────────────────
  app.use('/api/v1', apiLimiter);

  // ── Rotas da API REST ─────────────────────────────────────────────────────
  app.use('/api/v1', routes);

  // ── Fallback SPA para a raiz e páginas não-API ────────────────────────────
  app.get('*', (req, res, next) => {
    if (req.originalUrl.startsWith('/api/')) {
      return next();
    }
    res.sendFile(path.join(frontendPath, 'index.html'));
  });

  // ── 404 ───────────────────────────────────────────────────────────────────
  app.use((req, res) => {
    res.status(404).json({
      success: false,
      error:   `Rota não encontrada: ${req.method} ${req.originalUrl}`,
      code:    'NOT_FOUND',
    });
  });

  // ── Handler Global de Erros ───────────────────────────────────────────────
  // Deve ser o ÚLTIMO middleware registado
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
