/**
 * CleanXhedule Manager — Rotas: Relatórios (BI)
 * Base: /api/v1/reports
 */
'use strict';

const express = require('express');
const router = express.Router();

const { verifyToken, requireRoles } = require('../middleware/auth');
const { getDb } = require('../../database/db');
const {
  getClientReport,
  getServiceReport,
  getRevenueReport,
  getTechnicianPerformanceReport,
  getChannelReport,
  getPendingPaymentsReport,
} = require('../services/reports.service');

// Todos os endpoints de relatórios requerem autenticação e perfil Admin ou GestorComercial
router.use(verifyToken);
router.use(requireRoles('Admin', 'GestorComercial'));

/* ─────────────────────────────────────────────────────────────────────────────
   GET /reports/clients — Relatório de clientes
───────────────────────────────────────────────────────────────────────────── */
router.get('/clients', (req, res, next) => {
  try {
    const db = getDb();
    const report = getClientReport(db);
    return res.json({ success: true, data: report });
  } catch (err) {
    next(err);
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   GET /reports/services — Relatório de serviços
───────────────────────────────────────────────────────────────────────────── */
router.get('/services', (req, res, next) => {
  try {
    const db = getDb();
    const report = getServiceReport(db);
    return res.json({ success: true, data: report });
  } catch (err) {
    next(err);
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   GET /reports/revenue — Relatório de faturação/receita
───────────────────────────────────────────────────────────────────────────── */
router.get('/revenue', (req, res, next) => {
  try {
    const db = getDb();
    const { startDate, endDate } = req.query;

    const report = getRevenueReport(db, { startDate, endDate });
    return res.json({ success: true, data: report });
  } catch (err) {
    next(err);
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   GET /reports/performance — Relatório de desempenho de técnicos
───────────────────────────────────────────────────────────────────────────── */
router.get('/performance', (req, res, next) => {
  try {
    const db = getDb();
    const report = getTechnicianPerformanceReport(db);
    return res.json({ success: true, data: report });
  } catch (err) {
    next(err);
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   GET /reports/channels — Análise de canais (Telefone vs WhatsApp)
───────────────────────────────────────────────────────────────────────────── */
router.get('/channels', (req, res, next) => {
  try {
    const db = getDb();
    const report = getChannelReport(db);
    return res.json({ success: true, data: report });
  } catch (err) {
    next(err);
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   GET /reports/payments — Relatório de pagamentos pendentes
───────────────────────────────────────────────────────────────────────────── */
router.get('/payments', (req, res, next) => {
  try {
    const db = getDb();
    const report = getPendingPaymentsReport(db);
    return res.json({ success: true, data: report });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
