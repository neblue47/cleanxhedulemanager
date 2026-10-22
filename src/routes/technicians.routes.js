/**
 * CleanXhedule Manager — Rotas: Técnicos
 * Base: /api/v1/technicians
 *
 * Endpoints implementados:
 *   GET /technicians                    — Lista todos os técnicos ativos
 *   GET /technicians/available          — Técnicos disponíveis para data/turno (Módulo 3)
 *   GET /technicians/:id/availability   — Disponibilidade de um técnico por mês
 *   PUT /technicians/:id/availability   — Registar/atualizar disponibilidade
 */
'use strict';

const express = require('express');
const router = express.Router();

const { verifyToken, requireRoles } = require('../middleware/auth');
const { getDb } = require('../../database/db');
const { 
  getAvailableTechnicians, 
  listTechnicians, 
  getTechnicianById, 
  createTechnician, 
  updateTechnician, 
  deleteTechnician,
  getTechnicianBookings,
  getTechnicianStats,
} = require('../services/technicians.service');
const { ValidationError } = require('../middleware/errorHandler');

router.use(verifyToken);

/* ─────────────────────────────────────────────────────────────────────────────
   GET /technicians — Lista todos os técnicos (opcional ?activeOnly=true)
   Perfis: Admin, GestorComercial, Assistente
───────────────────────────────────────────────────────────────────────────── */
router.get(
  '/',
  requireRoles('Admin', 'GestorComercial', 'Assistente'),
  (req, res, next) => {
    try {
      const db = getDb();
      const activeOnly = req.query.activeOnly === 'true';
      const rows = listTechnicians(db, { activeOnly });
      return res.json({ success: true, data: rows });
    } catch (err) {
      next(err);
    }
  }
);

/* ─────────────────────────────────────────────────────────────────────────────
   GET /technicians/available — Técnicos disponíveis por data e turno
   Query params (obrigatórios): date (YYYY-MM-DD), shift (Manhã|Tarde|Noite)
   Perfis: Admin, GestorComercial, Assistente
───────────────────────────────────────────────────────────────────────────── */
router.get(
  '/available',
  requireRoles('Admin', 'GestorComercial', 'Assistente'),
  (req, res, next) => {
    try {
      const { date, shift } = req.query;
      const db = getDb();
      const available = getAvailableTechnicians(db, { date, shift });
      return res.json({ success: true, data: available, count: available.length });
    } catch (err) {
      next(err);
    }
  }
);

/* ─────────────────────────────────────────────────────────────────────────────
   GET /technicians/:id — Detalhes de um técnico
   Perfis: Admin, GestorComercial, Assistente
───────────────────────────────────────────────────────────────────────────── */
router.get(
  '/:id',
  requireRoles('Admin', 'GestorComercial', 'Assistente'),
  (req, res, next) => {
    try {
      const db = getDb();
      const technician = getTechnicianById(db, req.params.id);
      return res.json({ success: true, data: technician });
    } catch (err) {
      next(err);
    }
  }
);

/* ─────────────────────────────────────────────────────────────────────────────
   POST /technicians — Criar novo técnico
   Perfis: Admin, GestorComercial
───────────────────────────────────────────────────────────────────────────── */
router.post(
  '/',
  requireRoles('Admin', 'GestorComercial'),
  (req, res, next) => {
    try {
      const db = getDb();
      const technician = createTechnician(db, req.body);
      return res.status(201).json({ success: true, data: technician });
    } catch (err) {
      next(err);
    }
  }
);

/* ─────────────────────────────────────────────────────────────────────────────
   PUT /technicians/:id — Atualizar dados de um técnico
   Perfis: Admin, GestorComercial
───────────────────────────────────────────────────────────────────────────── */
router.put(
  '/:id',
  requireRoles('Admin', 'GestorComercial'),
  (req, res, next) => {
    try {
      const db = getDb();
      const technician = updateTechnician(db, req.params.id, req.body);
      return res.json({ success: true, data: technician });
    } catch (err) {
      next(err);
    }
  }
);

/* ─────────────────────────────────────────────────────────────────────────────
   DELETE /technicians/:id — Desativar técnico
   Perfis: Admin, GestorComercial
───────────────────────────────────────────────────────────────────────────── */
router.delete(
  '/:id',
  requireRoles('Admin', 'GestorComercial'),
  (req, res, next) => {
    try {
      const db = getDb();
      const result = deleteTechnician(db, req.params.id);
      return res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

/* ─────────────────────────────────────────────────────────────────────────────
   GET /technicians/:id/availability — Disponibilidade de um técnico num mês
   Query params: year (YYYY), month (1-12)
───────────────────────────────────────────────────────────────────────────── */
router.get('/:id/availability', (req, res, next) => {
  try {
    const db = getDb();
    const { year, month } = req.query;

    let sql = `SELECT date, shift, is_available FROM technician_availability WHERE technician_id = ?`;
    const params = [req.params.id];

    if (year && month) {
      // Filter by year-month prefix  e.g. '2026-07'
      const prefix = `${String(year)}-${String(month).padStart(2, '0')}`;
      sql += ` AND date LIKE ?`;
      params.push(`${prefix}%`);
    }

    sql += ` ORDER BY date ASC, CASE shift WHEN 'Manhã' THEN 1 WHEN 'Tarde' THEN 2 ELSE 3 END`;

    const rows = db.prepare(sql).all(...params);
    return res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   PUT /technicians/:id/availability — Registar/atualizar disponibilidade
   Perfis: Admin, GestorComercial (gestor regista horário do técnico)
   Body: { entries: [{ date: 'YYYY-MM-DD', shift: 'Manhã'|'Tarde'|'Noite', is_available: 0|1 }] }
───────────────────────────────────────────────────────────────────────────── */
router.put(
  '/:id/availability',
  requireRoles('Admin', 'GestorComercial'),
  (req, res, next) => {
    try {
      const { entries } = req.body;
      if (!Array.isArray(entries) || entries.length === 0) {
        throw new ValidationError('O campo "entries" deve ser um array não vazio.');
      }

      const validShifts = ['Manhã', 'Tarde', 'Noite'];
      const db = getDb();

      const { v4: uuidv4 } = require('uuid');
      const upsert = db.prepare(`
        INSERT INTO technician_availability (id, technician_id, date, shift, is_available)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(technician_id, date, shift) DO UPDATE SET is_available = excluded.is_available
      `);

      const insertMany = db.transaction((rows) => {
        for (const entry of rows) {
          const { date, shift, is_available } = entry;
          if (!date || !shift || !validShifts.includes(shift)) {
            throw new ValidationError(`Entrada inválida: ${JSON.stringify(entry)}. Shift deve ser Manhã, Tarde ou Noite.`);
          }
          upsert.run(uuidv4(), req.params.id, date, shift, is_available ? 1 : 0);
        }
      });

      insertMany(entries);
      return res.json({ success: true, message: `${entries.length} entradas de disponibilidade atualizadas.` });
    } catch (err) {
      next(err);
    }
  }
);

/* ─────────────────────────────────────────────────────────────────────────────
   GET /technicians/:id/bookings — Agendamentos atribuídos a este técnico
   Perfis: Admin, GestorComercial, Assistente, ou o próprio Técnico
───────────────────────────────────────────────────────────────────────────── */
router.get('/:id/bookings', (req, res, next) => {
  try {
    const user = req.user;
    if (user.role === 'Tecnico' && user.id !== req.params.id && user.sub !== req.params.id) {
      return res.status(403).json({
        success: false,
        error: 'Acesso negado. Não pode consultar agendamentos de outros técnicos.',
        code: 'FORBIDDEN'
      });
    }

    const db = getDb();
    const { status, limit } = req.query;
    const bookings = getTechnicianBookings(db, req.params.id, { 
      status, 
      limit: limit ? parseInt(limit, 10) : 50 
    });

    return res.json({ success: true, data: bookings, count: bookings.length });
  } catch (err) {
    next(err);
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   GET /technicians/:id/stats — Estatísticas operacionais do técnico
   Perfis: Admin, GestorComercial, Assistente, ou o próprio Técnico
───────────────────────────────────────────────────────────────────────────── */
router.get('/:id/stats', (req, res, next) => {
  try {
    const user = req.user;
    if (user.role === 'Tecnico' && user.id !== req.params.id && user.sub !== req.params.id) {
      return res.status(403).json({
        success: false,
        error: 'Acesso negado. Não pode consultar estatísticas de outros técnicos.',
        code: 'FORBIDDEN'
      });
    }

    const db = getDb();
    const stats = getTechnicianStats(db, req.params.id);
    return res.json({ success: true, data: stats });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

