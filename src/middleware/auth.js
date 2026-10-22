/**
 * CleanXhedule Manager — Middleware: Autenticação JWT + RBAC
 */
'use strict';

const jwt    = require('jsonwebtoken');
const config = require('../config');
const { AuthError, ForbiddenError } = require('./errorHandler');

/**
 * Middleware que valida o Bearer Token JWT no header Authorization.
 * Anexa o payload decodificado em `req.user`.
 *
 * @example
 *   Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 */
function verifyToken(req, res, next) {
  try {
    let token = null;
    const authHeader = req.headers['authorization'] || '';
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    } else if (req.query && req.query.token) {
      token = req.query.token;
    }

    if (!token) {
      throw new AuthError('Token de acesso não fornecido.');
    }

    const payload = jwt.verify(token, config.jwt.secret);

    // Payload esperado: { sub, id, name, email, role, iat, exp }
    if (payload && !payload.id && payload.sub) {
      payload.id = payload.sub;
    }
    req.user = payload;
    next();
  } catch (err) {
    // JWT errors serão capturados pelo errorHandler global
    next(err);
  }
}

/**
 * Fábrica de middleware RBAC.
 * Aceita um ou mais roles permitidos.
 *
 * @param {...string} roles - Ex: 'Admin', 'GestorComercial', 'Assistente', 'Tecnico'
 * @returns {Function} Middleware Express
 *
 * @example
 *   router.post('/', verifyToken, requireRole('Admin'), handler)
 *   router.get('/',  verifyToken, requireRole('Admin', 'GestorComercial'), handler)
 */
function requireRole(...roles) {
  return function (req, res, next) {
    if (!req.user) {
      return next(new AuthError('Utilizador não autenticado.'));
    }
    if (!roles.includes(req.user.role)) {
      return next(
        new ForbiddenError(
          `Acesso restrito. Perfis permitidos: ${roles.join(', ')}. O seu perfil é: ${req.user.role}.`
        )
      );
    }
    next();
  };
}

/**
 * Middleware que garante que o utilizador só pode aceder aos seus próprios recursos,
 * a menos que seja Admin ou GestorComercial.
 *
 * Usa-se em endpoints como GET /commissions/me onde o utilizador só vê os seus dados.
 * Admins e Gestores podem ver os de qualquer utilizador (via param :id).
 *
 * @param {Function} [getOwnerIdFn] - Função que extrai o owner_id da req (default: req.params.id)
 */
function requireOwnerOrRole(allowedRoles = ['Admin', 'GestorComercial'], getOwnerIdFn) {
  return function (req, res, next) {
    if (!req.user) return next(new AuthError());

    // Managers e admins passam sempre
    if (allowedRoles.includes(req.user.role)) return next();

    // Determina o ID do dono do recurso
    const ownerId = getOwnerIdFn ? getOwnerIdFn(req) : req.params.id;
    if (ownerId !== req.user.sub) {
      return next(new ForbiddenError('Não tem permissão para aceder a recursos de outros utilizadores.'));
    }
    next();
  };
}

module.exports = { verifyToken, requireRole, requireRoles: requireRole, requireOwnerOrRole };
