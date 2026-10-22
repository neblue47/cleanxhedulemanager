/**
 * CleanXhedule Manager — Rotas: Pagamentos
 * Base: /api/v1/payments
 */
'use strict';

const express = require('express');
const router = express.Router();

const { verifyToken, requireRoles } = require('../middleware/auth');
const { getDb } = require('../../database/db');
const {
  registerPayment,
  getPaymentsByBooking,
  confirmPayment,
  getPaymentReport,
} = require('../services/payments.service');

// Todos os endpoints de pagamentos requerem autenticação
router.use(verifyToken);

/* ─────────────────────────────────────────────────────────────────────────────
   POST /payments — Registar pagamento para um agendamento
   Perfis: Admin, GestorComercial, Assistente
───────────────────────────────────────────────────────────────────────────── */
router.post(
  '/',
  requireRoles('Admin', 'GestorComercial', 'Assistente'),
  (req, res, next) => {
    try {
      const db = getDb();
      const payment = registerPayment(db, req.body, req.user.id);
      return res.status(201).json({ success: true, data: payment });
    } catch (err) {
      next(err);
    }
  }
);

/* ─────────────────────────────────────────────────────────────────────────────
   GET /payments/report — Relatório consolidado de pagamentos
   Perfis: Admin, GestorComercial
───────────────────────────────────────────────────────────────────────────── */
router.get(
  '/report',
  requireRoles('Admin', 'GestorComercial'),
  (req, res, next) => {
    try {
      const db = getDb();
      const { startDate, endDate, method, deposited_to_bank } = req.query;

      const report = getPaymentReport(db, { startDate, endDate, method, deposited_to_bank });
      return res.json({ success: true, data: report });
    } catch (err) {
      next(err);
    }
  }
);

/* ─────────────────────────────────────────────────────────────────────────────
   GET /payments/booking/:id — Histórico de pagamentos de um agendamento
   Perfis: Admin, GestorComercial, Assistente, Tecnico
───────────────────────────────────────────────────────────────────────────── */
router.get('/booking/:id', (req, res, next) => {
  try {
    const db = getDb();
    const payments = getPaymentsByBooking(db, req.params.id);
    return res.json({ success: true, data: payments });
  } catch (err) {
    next(err);
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   PUT /payments/:id/confirm — Confirmar pagamento e depósito bancário
   Perfis: Admin, GestorComercial
───────────────────────────────────────────────────────────────────────────── */
router.put(
  '/:id/confirm',
  requireRoles('Admin', 'GestorComercial'),
  (req, res, next) => {
    try {
      const db = getDb();
      const payment = confirmPayment(db, req.params.id, req.user.id);
      return res.json({ success: true, data: payment });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
