/**
 * CleanXhedule Manager — Service: Pagamentos
 * -------------------------------------------
 * Registo, confirmação e relatórios de pagamentos de agendamentos.
 */
'use strict';

const { v4: uuidv4 } = require('uuid');
const { NotFoundError, ValidationError } = require('../middleware/errorHandler');

const PAYMENT_FIELDS = `
  p.id, p.booking_id, p.amount, p.method, p.reference, p.proof_url,
  p.confirmed_by, p.confirmed_at, p.deposited_to_bank, p.deposited_at
`;

/**
 * Registar um novo pagamento associado a um agendamento.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} data
 * @param {string} data.booking_id
 * @param {number} data.amount
 * @param {'Dinheiro'|'Transferencia'} data.method
 * @param {string} [data.reference]
 * @param {string} [data.proof_url]
 * @param {boolean|number} [data.deposited_to_bank=0]
 * @param {string} confirmedByUserId - ID do utilizador (gestor/admin) que confirma o registo
 * @returns {object} Pagamento criado
 */
function registerPayment(db, data, confirmedByUserId) {
  const {
    booking_id,
    amount,
    method,
    reference,
    proof_url,
    deposited_to_bank = 0,
  } = data;

  if (!booking_id || amount === undefined || !method) {
    throw new ValidationError('Os campos booking_id, amount e method são obrigatórios.');
  }

  const validMethods = ['Dinheiro', 'Transferencia'];
  if (!validMethods.includes(method)) {
    throw new ValidationError(`Método de pagamento inválido. Valores aceites: ${validMethods.join(', ')}.`);
  }

  if (Number(amount) <= 0) {
    throw new ValidationError('O valor do pagamento deve ser maior que zero.');
  }

  const transaction = db.transaction(() => {
    // 1. Verificar se o agendamento existe
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(booking_id);
    if (!booking) {
      throw new NotFoundError('Agendamento');
    }

    const id  = uuidv4();
    const now = new Date().toISOString();
    const depositedFlag = deposited_to_bank ? 1 : 0;
    const depositedAt   = depositedFlag ? now : null;

    db.prepare(`
      INSERT INTO payments (
        id, booking_id, amount, method, reference, proof_url,
        confirmed_by, confirmed_at, deposited_to_bank, deposited_at
      ) VALUES (
        @id, @booking_id, @amount, @method, @reference, @proof_url,
        @confirmed_by, @now, @depositedFlag, @depositedAt
      )
    `).run({
      id,
      booking_id,
      amount:        Number(amount),
      method,
      reference:     reference || null,
      proof_url:     proof_url || null,
      confirmed_by:  confirmedByUserId,
      now,
      depositedFlag,
      depositedAt,
    });

    // 2. Calcular total pago para o agendamento
    const sumRow = db.prepare('SELECT SUM(amount) AS total_paid FROM payments WHERE booking_id = ?').get(booking_id);
    const totalPaid = sumRow ? (sumRow.total_paid || 0) : 0;

    // 3. Atualizar payment_status no agendamento se for totalmente pago
    if (totalPaid >= (booking.final_amount || 0)) {
      db.prepare(`
        UPDATE bookings
        SET payment_status = 'Pago', payment_confirmed_by = ?, payment_confirmed_at = ?, updated_at = ?
        WHERE id = ?
      `).run(confirmedByUserId, now, now, booking_id);
    }

    return db.prepare(`SELECT ${PAYMENT_FIELDS} FROM payments p WHERE p.id = ?`).get(id);
  });

  return transaction();
}

/**
 * Obter histórico de pagamentos de um agendamento.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} bookingId
 * @returns {object[]}
 */
function getPaymentsByBooking(db, bookingId) {
  const booking = db.prepare('SELECT id FROM bookings WHERE id = ?').get(bookingId);
  if (!booking) throw new NotFoundError('Agendamento');

  return db.prepare(`
    SELECT
      ${PAYMENT_FIELDS},
      u.name AS confirmed_by_name
    FROM payments p
    LEFT JOIN users u ON p.confirmed_by = u.id
    WHERE p.booking_id = ?
    ORDER BY p.confirmed_at DESC
  `).all(bookingId);
}

/**
 * Confirmar/atualizar o depósito bancário de um pagamento.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} paymentId
 * @param {string} confirmedByUserId
 * @returns {object} Pagamento atualizado
 */
function confirmPayment(db, paymentId, confirmedByUserId) {
  const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
  if (!payment) throw new NotFoundError('Pagamento');

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE payments
    SET confirmed_by = ?, confirmed_at = ?, deposited_to_bank = 1, deposited_at = ?
    WHERE id = ?
  `).run(confirmedByUserId, now, now, paymentId);

  return db.prepare(`SELECT ${PAYMENT_FIELDS} FROM payments p WHERE p.id = ?`).get(paymentId);
}

/**
 * Obter relatório consolidado de pagamentos com filtros.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} [filters]
 * @param {string} [filters.startDate]
 * @param {string} [filters.endDate]
 * @param {string} [filters.method]
 * @param {number} [filters.deposited_to_bank]
 * @returns {object}
 */
function getPaymentReport(db, { startDate, endDate, method, deposited_to_bank } = {}) {
  const conditions = [];
  const params     = [];

  if (startDate) {
    conditions.push('p.confirmed_at >= ?');
    params.push(startDate);
  }
  if (endDate) {
    conditions.push('p.confirmed_at <= ?');
    params.push(endDate);
  }
  if (method) {
    conditions.push('p.method = ?');
    params.push(method);
  }
  if (deposited_to_bank !== undefined && deposited_to_bank !== null) {
    conditions.push('p.deposited_to_bank = ?');
    params.push(Number(deposited_to_bank) ? 1 : 0);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const summary = db.prepare(`
    SELECT
      COUNT(*) AS total_transactions,
      COALESCE(SUM(p.amount), 0) AS total_revenue,
      COALESCE(SUM(CASE WHEN p.method = 'Dinheiro' THEN p.amount ELSE 0 END), 0) AS total_cash,
      COALESCE(SUM(CASE WHEN p.method = 'Transferencia' THEN p.amount ELSE 0 END), 0) AS total_transfer,
      COALESCE(SUM(CASE WHEN p.deposited_to_bank = 1 THEN p.amount ELSE 0 END), 0) AS total_deposited
    FROM payments p
    ${where}
  `).get(...params);

  const transactions = db.prepare(`
    SELECT
      ${PAYMENT_FIELDS},
      b.scheduled_date,
      c.name AS client_name,
      u.name AS confirmed_by_name
    FROM payments p
    JOIN bookings b ON p.booking_id = b.id
    JOIN clients  c ON b.client_id  = c.id
    LEFT JOIN users u ON p.confirmed_by = u.id
    ${where}
    ORDER BY p.confirmed_at DESC
    LIMIT 100
  `).all(...params);

  return { summary, transactions };
}

module.exports = {
  registerPayment,
  getPaymentsByBooking,
  confirmPayment,
  getPaymentReport,
};
