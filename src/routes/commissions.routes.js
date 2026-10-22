/**
 * CleanXhedule Manager — Rotas: Comissões
 * Base: /api/v1/commissions
 */
'use strict';

const express = require('express');
const router = express.Router();

const { verifyToken, requireRoles } = require('../middleware/auth');
const { getDb } = require('../../database/db');
const {
  getCommissionsByUser,
  getCommissionsReport,
  payCommission,
} = require('../services/commissions.service');

// Todos os endpoints de comissões requerem autenticação
router.use(verifyToken);

/* ─────────────────────────────────────────────────────────────────────────────
   GET /commissions/me — Minhas comissões (Técnico / Gestor / Assistente)
───────────────────────────────────────────────────────────────────────────── */
router.get('/me', (req, res, next) => {
  try {
    const db = getDb();
    const { paid } = req.query;
    const userId = req.user.id || req.user.sub;

    const commissions = getCommissionsByUser(db, userId, { paid });
    return res.json({ success: true, data: commissions });
  } catch (err) {
    next(err);
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   GET /commissions/report — Relatório geral de comissões
   Perfis: Admin, GestorComercial
───────────────────────────────────────────────────────────────────────────── */
router.get(
  '/report',
  requireRoles('Admin', 'GestorComercial'),
  (req, res, next) => {
    try {
      const db = getDb();
      const { startDate, endDate, role, paid } = req.query;

      const report = getCommissionsReport(db, { startDate, endDate, role, paid });
      return res.json({ success: true, data: report });
    } catch (err) {
      next(err);
    }
  }
);

/* ─────────────────────────────────────────────────────────────────────────────
   GET /commissions/team — Comissões da equipa (GestorComercial)
───────────────────────────────────────────────────────────────────────────── */
router.get(
  '/team',
  requireRoles('Admin', 'GestorComercial'),
  (req, res, next) => {
    try {
      const db = getDb();
      const { paid } = req.query;

      const report = getCommissionsReport(db, { paid });
      return res.json({ success: true, data: report });
    } catch (err) {
      next(err);
    }
  }
);

/* ─────────────────────────────────────────────────────────────────────────────
   PUT /commissions/:id/pay — Marcar comissão como paga
   Perfis: Admin
───────────────────────────────────────────────────────────────────────────── */
router.put(
  '/:id/pay',
  requireRoles('Admin'),
  (req, res, next) => {
    try {
      const db = getDb();
      const commission = payCommission(db, req.params.id);
      return res.json({ success: true, data: commission });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
