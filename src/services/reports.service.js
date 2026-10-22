/**
 * CleanXhedule Manager — Service: Relatórios Analíticos (BI)
 * -----------------------------------------------------------
 * Relatórios agregados de faturação, clientes, desempenho técnico, canais de origem e pendências.
 */
'use strict';

/**
 * Relatório consolidado de clientes (Particular vs Empresa).
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {object}
 */
function getClientReport(db) {
  const summary = db.prepare(`
    SELECT
      COUNT(*) AS total_clients,
      COALESCE(SUM(CASE WHEN type = 'Particular' THEN 1 ELSE 0 END), 0) AS particulars,
      COALESCE(SUM(CASE WHEN type = 'Empresa' THEN 1 ELSE 0 END), 0) AS empresas
    FROM clients
  `).get();

  const topClients = db.prepare(`
    SELECT
      c.id, c.name, c.phone, c.type,
      COUNT(b.id) AS total_bookings,
      COALESCE(SUM(b.final_amount), 0) AS total_spent
    FROM clients c
    LEFT JOIN bookings b ON c.id = b.client_id AND b.status = 'Concluído'
    GROUP BY c.id
    ORDER BY total_spent DESC
    LIMIT 10
  `).all();

  return { summary, topClients };
}

/**
 * Relatório de serviços mais solicitados e receita por tipo de serviço.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {object}
 */
function getServiceReport(db) {
  const services = db.prepare(`
    SELECT
      st.id, st.name, st.base_price,
      COUNT(b.id) AS total_bookings,
      COALESCE(SUM(b.final_amount), 0) AS total_revenue
    FROM service_types st
    LEFT JOIN bookings b ON st.id = b.service_type_id AND b.status = 'Concluído'
    GROUP BY st.id
    ORDER BY total_bookings DESC
  `).all();

  return { services };
}

/**
 * Relatório de faturação e receitas.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} [filters]
 * @param {string} [filters.startDate]
 * @param {string} [filters.endDate]
 * @returns {object}
 */
function getRevenueReport(db, { startDate, endDate } = {}) {
  const conditions = ["status = 'Concluído'"];
  const params     = [];

  if (startDate) {
    conditions.push('scheduled_date >= ?');
    params.push(startDate);
  }
  if (endDate) {
    conditions.push('scheduled_date <= ?');
    params.push(endDate);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const summary = db.prepare(`
    SELECT
      COUNT(*) AS completed_bookings,
      COALESCE(SUM(final_amount), 0) AS total_revenue,
      COALESCE(AVG(final_amount), 0) AS average_ticket,
      COALESCE(SUM(CASE WHEN payment_method = 'Dinheiro' THEN final_amount ELSE 0 END), 0) AS cash_revenue,
      COALESCE(SUM(CASE WHEN payment_method = 'Transferencia' THEN final_amount ELSE 0 END), 0) AS transfer_revenue
    FROM bookings
    ${where}
  `).get(...params);

  return { summary };
}

/**
 * Relatório de desempenho de técnicos (produtividade e classificação).
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {object}
 */
function getTechnicianPerformanceReport(db) {
  const technicians = db.prepare(`
    SELECT
      u.id, u.name, u.email, u.phone,
      COUNT(b.id) AS completed_services,
      COALESCE(SUM(b.final_amount), 0) AS total_serviced_amount,
      COALESCE(AVG(b.rating), 0) AS average_rating
    FROM users u
    LEFT JOIN bookings b ON u.id = b.technician_id AND b.status = 'Concluído'
    WHERE u.role = 'Tecnico' AND u.active = 1
    GROUP BY u.id
    ORDER BY completed_services DESC
  `).all();

  return { technicians };
}

/**
 * Análise de canais de captação (Telefone vs WhatsApp).
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {object}
 */
function getChannelReport(db) {
  const channels = db.prepare(`
    SELECT
      origin_channel AS channel,
      COUNT(*) AS total_bookings,
      COALESCE(SUM(final_amount), 0) AS total_revenue
    FROM bookings
    GROUP BY origin_channel
  `).all();

  return { channels };
}

/**
 * Relatório de pagamentos pendentes.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {object}
 */
function getPendingPaymentsReport(db) {
  const summary = db.prepare(`
    SELECT
      COUNT(*) AS pending_count,
      COALESCE(SUM(final_amount), 0) AS total_pending_amount
    FROM bookings
    WHERE payment_status = 'Pendente' AND status NOT IN ('Cancelado', 'Rejeitado')
  `).get();

  const bookings = db.prepare(`
    SELECT
      b.id, b.scheduled_date, b.scheduled_time, b.final_amount,
      c.name AS client_name, c.phone AS client_phone,
      u.name AS technician_name
    FROM bookings b
    JOIN clients c ON b.client_id = c.id
    LEFT JOIN users u ON b.technician_id = u.id
    WHERE b.payment_status = 'Pendente' AND b.status NOT IN ('Cancelado', 'Rejeitado')
    ORDER BY b.scheduled_date ASC
  `).all();

  return { summary, bookings };
}

module.exports = {
  getClientReport,
  getServiceReport,
  getRevenueReport,
  getTechnicianPerformanceReport,
  getChannelReport,
  getPendingPaymentsReport,
};
