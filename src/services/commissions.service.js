/**
 * CleanXhedule Manager — Service: Comissões
 * ------------------------------------------
 * Gestão e cálculo de comissões de serviços para Técnicos, Gestores Comerciais e Assistentes.
 */
'use strict';

const { v4: uuidv4 } = require('uuid');
const { NotFoundError, ValidationError } = require('../middleware/errorHandler');

const COMMISSION_FIELDS = `
  c.id, c.booking_id, c.user_id, c.role, c.percentage,
  c.base_amount, c.commission_amount, c.paid, c.paid_at, c.created_at
`;

const DEFAULT_PERCENTAGES = {
  Tecnico: 10.0,         // 10%
  GestorComercial: 5.0,  // 5%
  Assistente: 2.0,       // 2%
};

/**
 * Calcula e gera o registo de comissão para um utilizador relativo a um agendamento.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} bookingId
 * @param {string} userId
 * @param {string} role - 'Tecnico' | 'GestorComercial' | 'Assistente'
 * @param {number} [customPercentage]
 * @returns {object} Comissão criada
 */
function createCommission(db, bookingId, userId, role, customPercentage) {
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
  if (!booking) throw new NotFoundError('Agendamento');

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) throw new NotFoundError('Utilizador');

  const percentage = customPercentage !== undefined ? Number(customPercentage) : (DEFAULT_PERCENTAGES[role] || 0.0);
  const base_amount = Number(booking.final_amount || 0);
  const commission_amount = (base_amount * percentage) / 100.0;

  const id  = uuidv4();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO commissions (
      id, booking_id, user_id, role, percentage, base_amount, commission_amount, paid, created_at
    ) VALUES (
      @id, @bookingId, @userId, @role, @percentage, @base_amount, @commission_amount, 0, @now
    )
  `).run({
    id,
    bookingId,
    userId,
    role,
    percentage,
    base_amount,
    commission_amount,
    now,
  });

  return db.prepare(`SELECT ${COMMISSION_FIELDS} FROM commissions c WHERE c.id = ?`).get(id);
}

/**
 * Obter comissões de um utilizador específico.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} userId
 * @param {object} [filters]
 * @param {boolean|number} [filters.paid]
 * @returns {object[]}
 */
function getCommissionsByUser(db, userId, { paid } = {}) {
  const conditions = ['c.user_id = ?'];
  const params     = [userId];

  if (paid !== undefined && paid !== null) {
    conditions.push('c.paid = ?');
    params.push(Number(paid) ? 1 : 0);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  return db.prepare(`
    SELECT
      ${COMMISSION_FIELDS},
      b.scheduled_date,
      cl.name AS client_name
    FROM commissions c
    JOIN bookings b ON c.booking_id = b.id
    JOIN clients cl ON b.client_id  = cl.id
    ${where}
    ORDER BY c.created_at DESC
  `).all(...params);
}

/**
 * Obter relatório geral de comissões com agregados.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} [filters]
 * @param {string} [filters.startDate]
 * @param {string} [filters.endDate]
 * @param {string} [filters.role]
 * @param {boolean|number} [filters.paid]
 * @returns {object}
 */
function getCommissionsReport(db, { startDate, endDate, role, paid } = {}) {
  const conditions = [];
  const params     = [];

  if (startDate) {
    conditions.push('c.created_at >= ?');
    params.push(startDate);
  }
  if (endDate) {
    conditions.push('c.created_at <= ?');
    params.push(endDate);
  }
  if (role) {
    conditions.push('c.role = ?');
    params.push(role);
  }
  if (paid !== undefined && paid !== null) {
    conditions.push('c.paid = ?');
    params.push(Number(paid) ? 1 : 0);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const summary = db.prepare(`
    SELECT
      COUNT(*) AS total_count,
      COALESCE(SUM(c.commission_amount), 0) AS total_amount,
      COALESCE(SUM(CASE WHEN c.paid = 1 THEN c.commission_amount ELSE 0 END), 0) AS paid_amount,
      COALESCE(SUM(CASE WHEN c.paid = 0 THEN c.commission_amount ELSE 0 END), 0) AS pending_amount
    FROM commissions c
    ${where}
  `).get(...params);

  const items = db.prepare(`
    SELECT
      ${COMMISSION_FIELDS},
      u.name AS user_name,
      b.scheduled_date,
      cl.name AS client_name
    FROM commissions c
    JOIN users u ON c.user_id    = u.id
    JOIN bookings b ON c.booking_id = b.id
    JOIN clients cl ON b.client_id  = cl.id
    ${where}
    ORDER BY c.created_at DESC
    LIMIT 100
  `).all(...params);

  return { summary, items };
}

/**
 * Marcar uma comissão como paga.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} commissionId
 * @returns {object} Comissão atualizada
 */
function payCommission(db, commissionId) {
  const commission = db.prepare('SELECT * FROM commissions WHERE id = ?').get(commissionId);
  if (!commission) throw new NotFoundError('Comissão');

  if (commission.paid) {
    throw new ValidationError('Esta comissão já se encontra marcada como paga.');
  }

  const now = new Date().toISOString();
  db.prepare('UPDATE commissions SET paid = 1, paid_at = ? WHERE id = ?').run(now, commissionId);

  return db.prepare(`SELECT ${COMMISSION_FIELDS} FROM commissions c WHERE c.id = ?`).get(commissionId);
}

module.exports = {
  createCommission,
  getCommissionsByUser,
  getCommissionsReport,
  payCommission,
};
