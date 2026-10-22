/**
 * CleanXhedule Manager — Middleware: Handler Global de Erros
 *
 * Mapeia erros conhecidos para respostas HTTP semânticas:
 *   SQLITE_CONSTRAINT_UNIQUE     → 409 Conflict
 *   SQLITE_CONSTRAINT_FOREIGNKEY → 422 Unprocessable Entity
 *   ValidationError (custom)     → 400 Bad Request
 *   AuthError (custom)           → 401 Unauthorized
 *   ForbiddenError (custom)      → 403 Forbidden
 *   NotFoundError (custom)       → 404 Not Found
 *   Outros                       → 500 Internal Server Error
 */
'use strict';

const config = require('../config');

// ── Classes de Erro Personalizadas ────────────────────────────────────────────

class AppError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.name       = this.constructor.name;
    this.statusCode = statusCode;
    this.code       = code;
    this.isOperational = true;
  }
}

class ValidationError extends AppError {
  constructor(message, details) {
    super(message, 400, 'VALIDATION_ERROR');
    this.details = details;
  }
}

class AuthError extends AppError {
  constructor(message = 'Não autenticado') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Acesso negado para este perfil') {
    super(message, 403, 'FORBIDDEN');
  }
}

class NotFoundError extends AppError {
  constructor(resource = 'Recurso') {
    super(`${resource} não encontrado`, 404, 'NOT_FOUND');
  }
}

class ConflictError extends AppError {
  constructor(message = 'Registo já existe') {
    super(message, 409, 'UNIQUE_VIOLATION');
  }
}

// ── Tradutor de Erros SQLite ──────────────────────────────────────────────────

/**
 * Converte erros nativos do SQLite (better-sqlite3) em AppErrors.
 * @param {Error} err
 * @returns {AppError|null}
 */
function mapSqliteError(err) {
  if (!err || !err.message) return null;

  const msg  = err.message;
  const code = err.code || '';

  if (
    code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
    msg.includes('UNIQUE constraint failed')
  ) {
    const match = msg.match(/UNIQUE constraint failed: [\w.]+\.(\w+)/) || msg.match(/UNIQUE constraint failed: (\w+)/);
    const field = match ? match[1] : 'campo';
    return new ConflictError(`Já existe um registo com este ${field}.`);
  }

  if (
    code === 'SQLITE_CONSTRAINT_FOREIGNKEY' ||
    msg.includes('FOREIGN KEY constraint failed')
  ) {
    return new AppError(
      'Referência inválida: o registo relacionado não existe.',
      422,
      'FOREIGN_KEY_VIOLATION'
    );
  }

  if (
    code === 'SQLITE_CONSTRAINT_NOTNULL' ||
    msg.includes('NOT NULL constraint failed')
  ) {
    const match = msg.match(/NOT NULL constraint failed: [\w.]+\.(\w+)/) || msg.match(/NOT NULL constraint failed: (\w+)/);
    const field = match ? match[1] : 'campo obrigatório';
    return new ValidationError(`O campo '${field}' é obrigatório.`);
  }

  if (
    code === 'SQLITE_CONSTRAINT_CHECK' ||
    msg.includes('CHECK constraint failed')
  ) {
    return new ValidationError('Valor inválido para o campo (restrição de domínio).');
  }

  return null;
}

// ── Handler Express ───────────────────────────────────────────────────────────

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Tenta mapear erros SQLite primeiro
  const sqliteErr = mapSqliteError(err);
  if (sqliteErr) {
    return res.status(sqliteErr.statusCode).json({
      success: false,
      error:   sqliteErr.message,
      code:    sqliteErr.code,
    });
  }

  // Erros operacionais conhecidos (AppError e subclasses)
  if (err.isOperational) {
    const body = {
      success: false,
      error:   err.message,
      code:    err.code,
    };
    if (err.details) body.details = err.details;
    return res.status(err.statusCode).json(body);
  }

  // Erros de JWT (jsonwebtoken)
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ success: false, error: 'Token inválido.', code: 'INVALID_TOKEN' });
  }
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ success: false, error: 'Token expirado.', code: 'TOKEN_EXPIRED' });
  }

  // Erros inesperados — nunca expor detalhes em produção
  if (!config.isDev) {
    console.error('[ERROR]', err);
    return res.status(500).json({ success: false, error: 'Erro interno do servidor.', code: 'INTERNAL_ERROR' });
  }

  // Em desenvolvimento, devolve stack trace para facilitar debug
  console.error('[ERROR]', err);
  return res.status(500).json({
    success: false,
    error:   err.message,
    code:    'INTERNAL_ERROR',
    stack:   err.stack,
  });
}

module.exports = {
  errorHandler,
  AppError,
  ValidationError,
  AuthError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  mapSqliteError,
};
