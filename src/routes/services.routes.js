/**
 * CleanXhedule Manager — Rotas: Catálogo de Serviços
 * Base: /api/v1/services
 */
'use strict';

const express = require('express');
const router = express.Router();

const { verifyToken, requireRoles } = require('../middleware/auth');
const { getDb } = require('../../database/db');
const {
  listServices,
  getServiceById,
  createService,
  updateService,
  deleteService,
} = require('../services/services.service');

// Todos os endpoints requerem autenticação
router.use(verifyToken);

/* ─────────────────────────────────────────────────────────────────────────────
   GET /services — Listar catálogo de serviços
   Qualquer utilizador autenticado pode listar serviços ativos.
   Query params: is_active (0 ou 1), limit, offset
───────────────────────────────────────────────────────────────────────────── */
router.get('/', (req, res, next) => {
  try {
    const db = getDb();
    const { is_active, limit = 50, offset = 0 } = req.query;

    const result = listServices(db, { is_active, limit, offset });
    return res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   GET /services/:id — Detalhes de um serviço do catálogo
───────────────────────────────────────────────────────────────────────────── */
router.get('/:id', (req, res, next) => {
  try {
    const db = getDb();
    const service = getServiceById(db, req.params.id);
    return res.json({ success: true, data: service });
  } catch (err) {
    next(err);
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   POST /services — Criar novo serviço no catálogo
   Perfis: Admin, GestorComercial
───────────────────────────────────────────────────────────────────────────── */
router.post(
  '/',
  requireRoles('Admin', 'GestorComercial'),
  (req, res, next) => {
    try {
      const db = getDb();
      const service = createService(db, req.body);
      return res.status(201).json({ success: true, data: service });
    } catch (err) {
      next(err);
    }
  }
);

/* ─────────────────────────────────────────────────────────────────────────────
   PUT /services/:id — Atualizar serviço no catálogo
   Perfis: Admin, GestorComercial
───────────────────────────────────────────────────────────────────────────── */
router.put(
  '/:id',
  requireRoles('Admin', 'GestorComercial'),
  (req, res, next) => {
    try {
      const db = getDb();
      const service = updateService(db, req.params.id, req.body);
      return res.json({ success: true, data: service });
    } catch (err) {
      next(err);
    }
  }
);

/* ─────────────────────────────────────────────────────────────────────────────
   DELETE /services/:id — Desativar/Remover serviço
   Perfis: Admin, GestorComercial
───────────────────────────────────────────────────────────────────────────── */
router.delete(
  '/:id',
  requireRoles('Admin', 'GestorComercial'),
  (req, res, next) => {
    try {
      const db = getDb();
      const result = deleteService(db, req.params.id);
      return res.json({ success: true, message: result.message });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
