/**
 * CleanXhedule Manager — Rotas: Comunicação WhatsApp/SMS
 * Base: /api/v1/communication
 */
'use strict';

const express = require('express');
const router = express.Router();

const { verifyToken, requireRoles } = require('../middleware/auth');
const { getDb } = require('../../database/db');
const {
  sendWhatsAppMessage,
  sendSMSMessage,
  getCommunicationLogsByBooking,
  handleWhatsAppWebhook,
} = require('../services/communication.service');

/* ─────────────────────────────────────────────────────────────────────────────
   POST /communication/webhook/whatsapp — Webhook público para receção de WhatsApp
───────────────────────────────────────────────────────────────────────────── */
router.post('/webhook/whatsapp', (req, res, next) => {
  try {
    const db = getDb();
    const result = handleWhatsAppWebhook(db, req.body);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// As restantes rotas de comunicação requerem autenticação
router.use(verifyToken);

/* ─────────────────────────────────────────────────────────────────────────────
   POST /communication/send-whatsapp — Enviar mensagem WhatsApp
   Perfis: Admin, GestorComercial, Assistente
───────────────────────────────────────────────────────────────────────────── */
router.post(
  '/send-whatsapp',
  requireRoles('Admin', 'GestorComercial', 'Assistente'),
  (req, res, next) => {
    try {
      const db = getDb();
      const log = sendWhatsAppMessage(db, req.body, req.user.id || req.user.sub);
      return res.status(201).json({ success: true, data: log });
    } catch (err) {
      next(err);
    }
  }
);

/* ─────────────────────────────────────────────────────────────────────────────
   POST /communication/send-sms — Enviar SMS
   Perfis: Admin, GestorComercial, Assistente
───────────────────────────────────────────────────────────────────────────── */
router.post(
  '/send-sms',
  requireRoles('Admin', 'GestorComercial', 'Assistente'),
  (req, res, next) => {
    try {
      const db = getDb();
      const log = sendSMSMessage(db, req.body, req.user.id || req.user.sub);
      return res.status(201).json({ success: true, data: log });
    } catch (err) {
      next(err);
    }
  }
);

/* ─────────────────────────────────────────────────────────────────────────────
   GET /communication/booking/:id — Histórico de comunicações do agendamento
───────────────────────────────────────────────────────────────────────────── */
router.get('/booking/:id', (req, res, next) => {
  try {
    const db = getDb();
    const logs = getCommunicationLogsByBooking(db, req.params.id);
    return res.json({ success: true, data: logs });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
