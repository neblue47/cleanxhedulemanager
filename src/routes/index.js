/**
 * CleanXhedule Manager — Agregador de Rotas
 * Monta todos os routers em /api/v1
 */
'use strict';

const express = require('express');
const router  = express.Router();

// ── Rotas Implementadas ───────────────────────────────────────────────────────
router.use('/auth',          require('./auth.routes'));
router.use('/users',         require('./users.routes'));
router.use('/clients',       require('./clients.routes'));
router.use('/company',       require('./company.routes'));

// ── Rotas Stub (prontas para implementação incremental) ───────────────────────
router.use('/bookings',      require('./bookings.routes'));
router.use('/services',      require('./services.routes'));
router.use('/technicians',   require('./technicians.routes'));
router.use('/documents',     require('./documents.routes'));
router.use('/payments',      require('./payments.routes'));
router.use('/commissions',   require('./commissions.routes'));
router.use('/reports',       require('./reports.routes'));
router.use('/communication', require('./communication.routes'));
router.use('/worklogs',      require('./worklogs.routes'));

// ── Health Check ──────────────────────────────────────────────────────────────
/**
 * @route   GET /api/v1/health
 * @desc    Verificação de saúde da API
 * @access  Público
 */
router.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    data: {
      status:    'ok',
      service:   'CleanXhedule Manager API',
      version:   '1.0.0',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
    },
  });
});

module.exports = router;
