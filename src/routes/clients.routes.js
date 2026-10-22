/**
 * CleanXhedule Manager — Rotas: Clientes
 * Base: /api/v1/clients
 *
 * IMPORTANTE: A rota GET /search DEVE ser declarada ANTES de GET /:id,
 * caso contrário o Express interpretaria "search" como um :id.
 *
 * RBAC:
 *   GET  /search       → Todos os perfis autenticados
 *   GET  /             → Admin, GestorComercial, Assistente
 *   GET  /:id          → Admin, GestorComercial, Assistente
 *   POST /             → Admin, GestorComercial, Assistente
 *   PUT  /:id          → Admin, GestorComercial, Assistente
 */
'use strict';

const express = require('express');
const router = express.Router();

const { getDb } = require('../../database/db');
const clientsService = require('../services/clients.service');
const { verifyToken, requireRole } = require('../middleware/auth');
const { requireFields } = require('../middleware/validate');

// Todos os endpoints exigem autenticação
router.use(verifyToken);

// Perfis com acesso à gestão de clientes
const CLIENT_ROLES = ['Admin', 'GestorComercial', 'Assistente'];

// ── GET /search?phone=xxx ─────────────────────────────────────────────────────
/**
 * @route   GET /api/v1/clients/search?phone=xxx
 * @desc    Busca rápida de cliente por telefone (suporte a pesquisa parcial).
 *          Retorna campos parciais (id, name, phone, email, type, address) para
 *          identificação instantânea pelo assistente de atendimento.
 * @access  Todos os perfis autenticados
 * @query   { phone: string (mín. 3 chars), limit?: number }
 */
router.get('/search', (req, res, next) => {
  try {
    const db = getDb();
    const { phone, limit } = req.query;

    if (!phone) {
      return res.status(400).json({
        success: false,
        error: "Parâmetro 'phone' é obrigatório.",
        code: 'VALIDATION_ERROR',
      });
    }

    const results = clientsService.searchByPhone(db, phone, limit ? parseInt(limit, 10) : 10);
    res.status(200).json({ success: true, data: results });
  } catch (err) {
    next(err);
  }
});

// ── GET / — Listar clientes ───────────────────────────────────────────────────
/**
 * @route   GET /api/v1/clients
 * @desc    Lista clientes com paginação e filtros
 * @access  Admin, GestorComercial, Assistente
 * @query   { type?, search?, limit?, offset? }
 */
router.get(
  '/',
  requireRole(...CLIENT_ROLES),
  (req, res, next) => {
    try {
      const db = getDb();
      const { type, search, limit, offset } = req.query;
      const result = clientsService.listClients(db, {
        type,
        search,
        limit: limit ? parseInt(limit, 10) : 50,
        offset: offset ? parseInt(offset, 10) : 0,
      });
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /:id — Detalhe do cliente ─────────────────────────────────────────────
/**
 * @route   GET /api/v1/clients/:id
 * @desc    Retorna todos os detalhes de um cliente
 * @access  Admin, GestorComercial, Assistente
 */
router.get(
  '/:id',
  requireRole(...CLIENT_ROLES),
  (req, res, next) => {
    try {
      const db = getDb();
      const client = clientsService.getClientById(db, req.params.id);
      res.status(200).json({ success: true, data: client });
    } catch (err) {
      next(err);
    }
  }
);

// ── POST / — Criar cliente ────────────────────────────────────────────────────
/**
 * @route   POST /api/v1/clients
 * @desc    Regista um novo cliente
 * @access  Admin, GestorComercial, Assistente
 * @body    { name, phone, address, email?, tax_id?, type?, notes? }
 */
router.post(
  '/',
  requireRole(...CLIENT_ROLES),
  requireFields(['name', 'phone', 'address']),
  (req, res, next) => {
    try {
      const db = getDb();
      const client = clientsService.createClient(db, req.body, req.user.sub);
      res.status(201).json({ success: true, data: client });
    } catch (err) {
      next(err);
    }
  }
);

// ── PUT /:id — Atualizar cliente ──────────────────────────────────────────────
/**
 * @route   PUT /api/v1/clients/:id
 * @desc    Atualiza dados de um cliente existente
 * @access  Admin, GestorComercial, Assistente
 * @body    Qualquer subconjunto de { name, phone, email, address, tax_id, type, notes }
 */
router.put(
  '/:id',
  requireRole(...CLIENT_ROLES),
  (req, res, next) => {
    try {
      const db = getDb();
      const client = clientsService.updateClient(db, req.params.id, req.body);
      res.status(200).json({ success: true, data: client });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
