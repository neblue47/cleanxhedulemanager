/**
 * CleanXhedule Manager — Rotas: Utilizadores (Funcionários)
 * Base: /api/v1/users
 *
 * RBAC:
 *   POST   /           → Admin only
 *   GET    /           → Admin, GestorComercial
 *   GET    /:id        → Admin, GestorComercial | próprio utilizador
 *   PUT    /:id        → Admin | próprio utilizador
 *   DELETE /:id        → Admin only (soft-delete)
 */
'use strict';

const express = require('express');
const router = express.Router();

const { getDb } = require('../../database/db');
const usersService = require('../services/users.service');
const { verifyToken, requireRole, requireOwnerOrRole } = require('../middleware/auth');
const { requireFields } = require('../middleware/validate');
const { ForbiddenError } = require('../middleware/errorHandler');

// Todas as rotas exigem autenticação
router.use(verifyToken);

// ── POST / — Criar utilizador ──────────────────────────────────────────────────
/**
 * @route   POST /api/v1/users
 * @desc    Cria um novo funcionário. Apenas Admins.
 * @access  Admin
 * @body    { name, email, password, role, phone? }
 */
router.post(
  '/',
  requireRole('Admin'),
  requireFields(['name', 'email', 'password', 'role']),
  (req, res, next) => {
    try {
      const db = getDb();
      const user = usersService.createUser(db, req.body);
      res.status(201).json({ success: true, data: user });
    } catch (err) {
      next(err);
    }
  }
);

// ── GET / — Listar utilizadores ───────────────────────────────────────────────
/**
 * @route   GET /api/v1/users
 * @desc    Lista todos os funcionários (com filtros opcionais)
 * @access  Admin, GestorComercial
 * @query   { role?, active?, limit?, offset? }
 */
router.get(
  '/',
  requireRole('Admin', 'GestorComercial'),
  (req, res, next) => {
    try {
      const db = getDb();
      const { role, active, limit, offset } = req.query;
      const result = usersService.listUsers(db, {
        role,
        active: active !== undefined ? active === 'true' : undefined,
        limit: limit ? parseInt(limit, 10) : 50,
        offset: offset ? parseInt(offset, 10) : 0,
      });
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /:id — Detalhe do utilizador ──────────────────────────────────────────
/**
 * @route   GET /api/v1/users/:id
 * @desc    Retorna detalhes de um utilizador
 * @access  Admin, GestorComercial | próprio utilizador
 */
router.get(
  '/:id',
  requireOwnerOrRole(['Admin', 'GestorComercial']),
  (req, res, next) => {
    try {
      const db = getDb();
      const user = usersService.getUserById(db, req.params.id);
      res.status(200).json({ success: true, data: user });
    } catch (err) {
      next(err);
    }
  }
);

// ── PUT /:id — Atualizar utilizador ───────────────────────────────────────────
/**
 * @route   PUT /api/v1/users/:id
 * @desc    Atualiza dados do utilizador. Admin pode alterar role/active; outros só name/phone.
 * @access  Admin | próprio utilizador
 */
router.put(
  '/:id',
  requireOwnerOrRole(['Admin']),
  (req, res, next) => {
    try {
      // Técnicos e Assistentes não podem alterar outros utilizadores
      const isSelf = req.params.id === req.user.sub;
      if (!isSelf && req.user.role !== 'Admin') {
        throw new ForbiddenError('Não tem permissão para alterar outros utilizadores.');
      }

      const db = getDb();
      const user = usersService.updateUser(db, req.params.id, req.body, req.user.role);
      res.status(200).json({ success: true, data: user });
    } catch (err) {
      next(err);
    }
  }
);

// ── DELETE /:id — Desativar utilizador (soft-delete) ─────────────────────────
/**
 * @route   DELETE /api/v1/users/:id
 * @desc    Desativa um utilizador (não remove da BD). Apenas Admins.
 * @access  Admin
 */
router.delete(
  '/:id',
  requireRole('Admin'),
  (req, res, next) => {
    try {
      // Admin não pode desativar a si próprio
      if (req.params.id === req.user.sub) {
        throw new ForbiddenError('Não pode desativar a sua própria conta.');
      }
      const db = getDb();
      const result = usersService.deactivateUser(db, req.params.id);
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
