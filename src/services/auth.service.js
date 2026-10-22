/**
 * CleanXhedule Manager — Service: Autenticação
 *
 * Responsabilidades:
 *   - Hashing e verificação de passwords com bcryptjs
 *   - Geração e verificação de tokens JWT (access + refresh)
 *   - Lógica de login
 */
'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { AuthError } = require('../middleware/errorHandler');

// ── Helpers de Password ───────────────────────────────────────────────────────

/**
 * Cria o hash bcrypt de uma password em texto simples.
 * @param {string} plainPassword
 * @returns {string} Hash bcrypt
 */
function hashPassword(plainPassword) {
  return bcrypt.hashSync(plainPassword, config.bcryptRounds);
}

/**
 * Compara uma password em texto simples com um hash bcrypt.
 * @param {string} plainPassword
 * @param {string} hash
 * @returns {boolean}
 */
function verifyPassword(plainPassword, hash) {
  return bcrypt.compareSync(plainPassword, hash);
}

// ── Helpers de JWT ────────────────────────────────────────────────────────────

/**
 * Gera um par de tokens (access + refresh) para o utilizador.
 *
 * Payload do accessToken:
 *   sub   — UUID do utilizador
 *   name  — Nome completo
 *   email — Email
 *   role  — Perfil RBAC
 *
 * @param {object} user — Registo do utilizador da base de dados
 * @returns {{ accessToken: string, refreshToken: string, expiresIn: string }}
 */
function generateTokens(user) {
  const payload = {
    sub: user.id,
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };

  const accessToken = jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  });

  const refreshToken = jwt.sign(
    { sub: user.id },
    config.jwt.refreshSecret,
    { expiresIn: config.jwt.refreshExpiresIn }
  );

  return { accessToken, refreshToken, expiresIn: config.jwt.expiresIn };
}

/**
 * Verifica e decodifica um refreshToken.
 * Lança AuthError se inválido ou expirado.
 *
 * @param {string} token
 * @returns {{ sub: string }} Payload decodificado
 */
function verifyRefreshToken(token) {
  try {
    return jwt.verify(token, config.jwt.refreshSecret);
  } catch {
    throw new AuthError('Refresh token inválido ou expirado.');
  }
}

// ── Lógica de Login ───────────────────────────────────────────────────────────

/**
 * Autentica um utilizador por email + password.
 * Retorna os tokens JWT se as credenciais estiverem corretas.
 *
 * @param {object} db  — Instância better-sqlite3
 * @param {string} email
 * @param {string} password
 * @returns {{ accessToken, refreshToken, expiresIn, user }}
 * @throws {AuthError} Se as credenciais forem inválidas ou a conta estiver inativa
 */
function login(db, email, password) {
  // Normaliza o email para minúsculas
  const normalizedEmail = email.trim().toLowerCase();

  const user = db
    .prepare('SELECT * FROM users WHERE email = ? LIMIT 1')
    .get(normalizedEmail);

  // Mensagem genérica para não revelar se o email existe ou não
  const INVALID_MSG = 'Email ou password incorretos.';

  if (!user) throw new AuthError(INVALID_MSG);
  if (!user.active) throw new AuthError('A sua conta está desativada. Contacte o administrador.');
  if (!verifyPassword(password, user.password_hash)) throw new AuthError(INVALID_MSG);

  const tokens = generateTokens(user);

  // Devolve dados públicos do utilizador (sem password_hash)
  const { password_hash: _, ...publicUser } = user;

  return { ...tokens, user: publicUser };
}

module.exports = { hashPassword, verifyPassword, generateTokens, verifyRefreshToken, login };
