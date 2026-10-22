/**
 * CleanXhedule Manager — Middleware: Validação de Body
 *
 * Helpers leves para validar campos obrigatórios sem dependências externas.
 */
'use strict';

const { ValidationError } = require('./errorHandler');

/**
 * Middleware que verifica se todos os campos obrigatórios estão presentes e não vazios.
 *
 * @param {string[]} fields - Lista de nomes de campos obrigatórios
 * @returns {Function} Middleware Express
 *
 * @example
 *   router.post('/login', requireFields(['email', 'password']), handler)
 */
function requireFields(fields) {
  return function (req, res, next) {
    const missing = fields.filter(
      (field) => req.body[field] === undefined || req.body[field] === null || req.body[field] === ''
    );

    if (missing.length > 0) {
      return next(
        new ValidationError(
          `Campos obrigatórios em falta: ${missing.join(', ')}.`,
          missing.map((f) => ({ field: f, message: 'Campo obrigatório.' }))
        )
      );
    }
    next();
  };
}

/**
 * Valida o formato de um email (validação básica no servidor).
 * Para validação completa, use a camada de aplicação/frontend.
 * @param {string} email
 * @returns {boolean}
 */
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Valida um número de telefone angolano (formato básico).
 * Aceita formatos: +244 9XX XXX XXX, 9XX XXX XXX, 9XXXXXXXX
 * @param {string} phone
 * @returns {boolean}
 */
function isValidAngolanPhone(phone) {
  // Remove espaços e hifens para normalizar
  const cleaned = phone.replace(/[\s\-()]/g, '');
  // Aceita +244XXXXXXXXX (12 dígitos com +244) ou 9XXXXXXXX (9 dígitos)
  return /^(\+244)?[9][1-9]\d{7}$/.test(cleaned);
}

/**
 * Middleware que valida o email no body (se presente).
 */
function validateEmail(req, res, next) {
  const { email } = req.body;
  if (email && !isValidEmail(email)) {
    return next(new ValidationError('Formato de email inválido.'));
  }
  next();
}

/**
 * Middleware que valida o telefone no body (se presente).
 * Para Angola, o telefone é o identificador principal — validação mais rigorosa.
 */
function validatePhone(field = 'phone', required = false) {
  return function (req, res, next) {
    const phone = req.body[field];
    if (!phone && required) {
      return next(new ValidationError(`O campo '${field}' é obrigatório.`));
    }
    if (phone && !isValidAngolanPhone(phone)) {
      return next(
        new ValidationError(
          `Formato de telefone inválido para '${field}'. Use o formato angolano: +244 9XX XXX XXX ou 9XXXXXXXX.`
        )
      );
    }
    next();
  };
}

module.exports = { requireFields, validateEmail, validatePhone, isValidEmail, isValidAngolanPhone };
