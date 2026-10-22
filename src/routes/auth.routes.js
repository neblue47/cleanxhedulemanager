/**
 * CleanXhedule Manager — Rotas: Autenticação
 * Base: /api/v1/auth
 */
'use strict';

const express = require('express');
const router = express.Router();

const { getDb } = require('../../database/db');
const authService = require('../services/auth.service');
const { verifyToken } = require('../middleware/auth');
const { requireFields } = require('../middleware/validate');
const { authLimiter } = require('../middleware/rateLimiter');

// ── POST /auth/login ──────────────────────────────────────────────────────────
/**
 * @route   POST /api/v1/auth/login
 * @desc    Autentica um funcionário e devolve tokens JWT
 * @access  Público
 * @body    { email: string, password: string }
 */
router.post(
  '/login',
  authLimiter,
  requireFields(['email', 'password']),
  (req, res, next) => {
    try {
      const db = getDb();
      const { email, password } = req.body;
      const result = authService.login(db, email, password);
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /auth/logout ─────────────────────────────────────────────────────────
/**
 * @route   POST /api/v1/auth/logout
 * @desc    Logout — invalida o token no lado do cliente.
 *          Sem blacklist de tokens nesta fase; o cliente deve descartar o token.
 * @access  Autenticado
 */
router.post('/logout', verifyToken, (req, res) => {
  // O token continua tecnicamente válido até expirar (1h).
  // Em fases futuras: adicionar o token a uma blacklist Redis.
  res.status(200).json({
    success: true,
    data: { message: 'Sessão encerrada. Descarte o token no cliente.' },
  });
});

// ── POST /auth/refresh ────────────────────────────────────────────────────────
/**
 * @route   POST /api/v1/auth/refresh
 * @desc    Gera um novo accessToken a partir de um refreshToken válido
 * @access  Público
 * @body    { refreshToken: string }
 */
router.post(
  '/refresh',
  requireFields(['refreshToken']),
  (req, res, next) => {
    try {
      const { refreshToken } = req.body;
      const payload = authService.verifyRefreshToken(refreshToken);

      const db = getDb();
      const user = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(payload.sub);

      if (!user) {
        return res.status(401).json({
          success: false,
          error: 'Utilizador não encontrado ou desativado.',
          code: 'UNAUTHORIZED',
        });
      }

      const tokens = authService.generateTokens(user);
      res.status(200).json({ success: true, data: tokens });
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /auth/forgot-password ────────────────────────────────────────────────
/**
 * @route   POST /api/v1/auth/forgot-password
 * @desc    Inicia o fluxo de recuperação de password.
 *          STUB: Nesta fase retorna sempre sucesso (sem envio de email implementado).
 *          Integrar com serviço de email (SendGrid, Mailgun) em fase futura.
 * @access  Público
 * @body    { email: string }
 */
router.post(
  '/forgot-password',
  authLimiter,
  requireFields(['email']),
  (req, res) => {
    // Resposta genérica — não revela se o email existe ou não
    res.status(200).json({
      success: true,
      data: {
        message:
          'Se o email existir no sistema, receberá instruções de recuperação em breve.',
      },
    });
  }
);

module.exports = router;
