/**
 * CleanXhedule Manager — Rotas: Execução Técnica no Local (Work Logs & Fotos)
 * Base: /api/v1/worklogs
 */
'use strict';

const express = require('express');
const router = express.Router();

const { verifyToken, requireRoles } = require('../middleware/auth');
const { getDb } = require('../../database/db');
const {
  checkIn,
  checkOut,
  uploadPhoto,
  getWorkLogByBooking,
} = require('../services/worklogs.service');

// Todos os endpoints de worklogs requerem autenticação
router.use(verifyToken);

/* ─────────────────────────────────────────────────────────────────────────────
   POST /worklogs/check-in — Registar entrada no local (GPS)
   Perfis: Tecnico, Admin, GestorComercial
───────────────────────────────────────────────────────────────────────────── */
router.post(
  '/check-in',
  requireRoles('Tecnico', 'Admin', 'GestorComercial'),
  (req, res, next) => {
    try {
      const db = getDb();
      const techId = req.body.technician_id || req.user.id || req.user.sub;
      const workLog = checkIn(db, { ...req.body, technician_id: techId });
      return res.status(201).json({ success: true, data: workLog });
    } catch (err) {
      next(err);
    }
  }
);

/* ─────────────────────────────────────────────────────────────────────────────
   POST /worklogs/check-out — Registar saída e conclusão do serviço
   Perfis: Tecnico, Admin, GestorComercial
───────────────────────────────────────────────────────────────────────────── */
router.post(
  '/check-out',
  requireRoles('Tecnico', 'Admin', 'GestorComercial'),
  (req, res, next) => {
    try {
      const db = getDb();
      const techId = req.body.technician_id || req.user.id || req.user.sub;
      const workLog = checkOut(db, { ...req.body, technician_id: techId });
      return res.json({ success: true, data: workLog });
    } catch (err) {
      next(err);
    }
  }
);

/* ─────────────────────────────────────────────────────────────────────────────
   POST /worklogs/photos — Registar foto Antes/Depois
   Perfis: Tecnico, Admin, GestorComercial
───────────────────────────────────────────────────────────────────────────── */
router.post(
  '/photos',
  requireRoles('Tecnico', 'Admin', 'GestorComercial'),
  (req, res, next) => {
    try {
      const db = getDb();
      const techId = req.body.technician_id || req.user.id || req.user.sub;
      const photo = uploadPhoto(db, { ...req.body, technician_id: techId });
      return res.status(201).json({ success: true, data: photo });
    } catch (err) {
      next(err);
    }
  }
);

/* ─────────────────────────────────────────────────────────────────────────────
   GET /worklogs/booking/:id — Obter registo de execução e fotos
───────────────────────────────────────────────────────────────────────────── */
router.get('/booking/:id', (req, res, next) => {
  try {
    const db = getDb();
    const data = getWorkLogByBooking(db, req.params.id);
    return res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
