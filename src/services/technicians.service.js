/**
 * CleanXhedule Manager — Service: Técnicos
 * ----------------------------------------
 * Implementa a listagem, CRUD e filtros de técnicos disponíveis (Módulo 3)
 */
'use strict';

const { v4: uuidv4 } = require('uuid');
const { hashPassword } = require('./auth.service');
const { ValidationError, NotFoundError } = require('../middleware/errorHandler');

const PUBLIC_FIELDS = 'id, name, email, phone, role, active, created_at, updated_at';

/**
 * Retorna os técnicos disponíveis para uma determinada data e turno.
 * Filtra técnicos que:
 * 1. Têm role = 'Tecnico' e active = 1.
 * 2. Têm disponibilidade registada na tabela technician_availability com is_available = 1.
 * 3. Não têm agendamento ativo concorrente no mesmo dia e turno.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} filters
 * @param {string} filters.date - YYYY-MM-DD
 * @param {string} filters.shift - 'Manhã' | 'Tarde' | 'Noite'
 * @returns {object[]} Lista de técnicos disponíveis
 */
function getAvailableTechnicians(db, { date, shift }) {
  if (!date || !shift) {
    throw new ValidationError('Os parâmetros date e shift são obrigatórios.');
  }

  const validShifts = ['Manhã', 'Tarde', 'Noite'];
  if (!validShifts.includes(shift)) {
    throw new ValidationError(`Turno inválido. Valores aceites: ${validShifts.join(', ')}.`);
  }

  // Query SQLite eficiente que filtra por data e turno com parâmetros nomeados
  const sql = `
    SELECT u.id, u.name, u.email, u.phone
    FROM users u
    INNER JOIN technician_availability ta ON u.id = ta.technician_id
    WHERE u.role = 'Tecnico'
      AND u.active = 1
      AND ta.date = @date
      AND ta.shift = @shift
      AND ta.is_available = 1
      AND u.id NOT IN (
        SELECT DISTINCT b.technician_id
        FROM bookings b
        WHERE b.scheduled_date = @date
          AND b.status NOT IN ('Rejeitado', 'Cancelado')
          AND b.technician_id IS NOT NULL
          AND (
            CASE
              WHEN CAST(SUBSTR(b.scheduled_time, 1, 2) AS INTEGER) >= 6 AND CAST(SUBSTR(b.scheduled_time, 1, 2) AS INTEGER) < 12 THEN 'Manhã'
              WHEN CAST(SUBSTR(b.scheduled_time, 1, 2) AS INTEGER) >= 12 AND CAST(SUBSTR(b.scheduled_time, 1, 2) AS INTEGER) < 18 THEN 'Tarde'
              ELSE 'Noite'
            END
          ) = @shift
      )
    ORDER BY u.name ASC
  `;

  return db.prepare(sql).all({ date, shift });
}

/**
 * Lista todos os técnicos com filtro opcional de ativos.
 * @param {import('better-sqlite3').Database} db
 * @param {object} [options]
 * @param {boolean} [options.activeOnly=false]
 * @returns {object[]}
 */
function listTechnicians(db, { activeOnly = false } = {}) {
  const where = activeOnly ? "WHERE role = 'Tecnico' AND active = 1" : "WHERE role = 'Tecnico'";
  return db.prepare(`SELECT ${PUBLIC_FIELDS} FROM users ${where} ORDER BY name ASC`).all();
}

/**
 * Retorna técnico por ID.
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 * @returns {object}
 */
function getTechnicianById(db, id) {
  const tech = db.prepare(`SELECT ${PUBLIC_FIELDS} FROM users WHERE id = ? AND role = 'Tecnico'`).get(id);
  if (!tech) {
    throw new NotFoundError('Técnico');
  }
  return tech;
}

/**
 * Cria um novo técnico (usuário com role 'Tecnico').
 * @param {import('better-sqlite3').Database} db
 * @param {object} data - { name, email, phone, password, active }
 * @returns {object} Técnico criado.
 */
function createTechnician(db, data) {
  const { name, email, phone, password, active = 1 } = data;
  if (!name || !email) {
    throw new ValidationError('Nome e email são obrigatórios para criar um técnico.');
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) {
    throw new ValidationError('Já existe um utilizador registado com este email.');
  }

  const id = uuidv4();
  const rawPassword = password && password.length >= 8 ? password : 'Tecnico@1234';
  const password_hash = hashPassword(rawPassword);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO users (id, name, email, phone, password_hash, role, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'Tecnico', ?, ?, ?)
  `).run(id, name.trim(), normalizedEmail, phone || null, password_hash, active ? 1 : 0, now, now);

  return getTechnicianById(db, id);
}

/**
 * Atualiza dados de um técnico existente.
 * @param {import('better-sqlite3').Database} db
 * @param {string} id - ID do técnico.
 * @param {object} data - campos a atualizar.
 * @returns {object} Técnico atualizado.
 */
function updateTechnician(db, id, data) {
  getTechnicianById(db, id); // valida existência

  const fields = [];
  const params = [];

  if (data.name !== undefined) {
    fields.push('name = ?');
    params.push(data.name.trim());
  }
  if (data.email !== undefined) {
    const normalizedEmail = data.email.trim().toLowerCase();
    const existing = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(normalizedEmail, id);
    if (existing) {
      throw new ValidationError('Já existe outro utilizador com este email.');
    }
    fields.push('email = ?');
    params.push(normalizedEmail);
  }
  if (data.phone !== undefined) {
    fields.push('phone = ?');
    params.push(data.phone ? data.phone.trim() : null);
  }
  if (data.active !== undefined) {
    fields.push('active = ?');
    params.push(data.active ? 1 : 0);
  }
  if (data.password) {
    if (data.password.length < 8) {
      throw new ValidationError('A palavra-passe deve ter pelo menos 8 caracteres.');
    }
    fields.push('password_hash = ?');
    params.push(hashPassword(data.password));
  }

  if (fields.length === 0) {
    throw new ValidationError('Nenhum campo válido enviado para atualização do técnico.');
  }

  const now = new Date().toISOString();
  fields.push('updated_at = ?');
  params.push(now, id);

  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ? AND role = 'Tecnico'`).run(...params);
  return getTechnicianById(db, id);
}

/**
 * Remove / desativa um técnico.
 * @param {import('better-sqlite3').Database} db
 * @param {string} id - ID do técnico.
 */
function deleteTechnician(db, id) {
  getTechnicianById(db, id);
  db.prepare(`UPDATE users SET active = 0, updated_at = ? WHERE id = ? AND role = 'Tecnico'`)
    .run(new Date().toISOString(), id);
  return { success: true, message: 'Técnico desativado com sucesso.' };
}

/**
 * Atribui ou altera o técnico de um agendamento.
 * @param {import('better-sqlite3').Database} db
 * @param {string} bookingId
 * @param {string|null} technicianId
 * @returns {object} Agendamento atualizado
 */
function assignTechnicianToBooking(db, bookingId, technicianId) {
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
  if (!booking) {
    throw new NotFoundError('Agendamento');
  }

  if (technicianId) {
    const tech = db.prepare("SELECT id, name, role, active FROM users WHERE id = ? AND role = 'Tecnico'").get(technicianId);
    if (!tech) {
      throw new NotFoundError('Técnico');
    }
    if (tech.active !== 1) {
      throw new ValidationError('O técnico selecionado não está ativo.');
    }

    // Calcula o turno do agendamento
    const hour = parseInt((booking.scheduled_time || '09:00').split(':')[0], 10);
    const shift = (hour >= 6 && hour < 12) ? 'Manhã' : (hour >= 12 && hour < 18) ? 'Tarde' : 'Noite';

    // Verificar se técnico tem conflito de horário
    const conflict = db.prepare(`
      SELECT id FROM bookings
      WHERE technician_id = ?
        AND scheduled_date = ?
        AND scheduled_time = ?
        AND id != ?
        AND status NOT IN ('Rejeitado', 'Cancelado')
    `).get(technicianId, booking.scheduled_date, booking.scheduled_time, bookingId);

    if (conflict) {
      throw new ValidationError('O técnico selecionado já possui outro agendamento neste dia e horário.');
    }
  }

  const now = new Date().toISOString();
  db.prepare('UPDATE bookings SET technician_id = ?, updated_at = ? WHERE id = ?')
    .run(technicianId || null, now, bookingId);

  return db.prepare(`
    SELECT b.*, u.name AS technician_name
    FROM bookings b
    LEFT JOIN users u ON b.technician_id = u.id
    WHERE b.id = ?
  `).get(bookingId);
}

/**
 * Retorna os agendamentos atribuídos a um técnico.
 * @param {import('better-sqlite3').Database} db
 * @param {string} id - ID do técnico
 * @param {object} [options]
 * @param {string} [options.status]
 * @param {number} [options.limit=50]
 * @returns {object[]}
 */
function getTechnicianBookings(db, id, { status, limit = 50 } = {}) {
  getTechnicianById(db, id); // valida existência

  let sql = `
    SELECT 
      b.id, b.scheduled_date, b.scheduled_time, b.status, b.payment_status, b.final_amount, b.address, b.created_at,
      c.name AS client_name, c.phone AS client_phone, c.address AS client_address,
      st.name AS service_name
    FROM bookings b
    LEFT JOIN clients c ON b.client_id = c.id
    LEFT JOIN service_types st ON b.service_type_id = st.id
    WHERE b.technician_id = ?
  `;
  const params = [id];

  if (status) {
    sql += ' AND b.status = ?';
    params.push(status);
  }

  sql += ' ORDER BY b.scheduled_date DESC, b.scheduled_time DESC LIMIT ?';
  params.push(limit);

  return db.prepare(sql).all(...params);
}

/**
 * Retorna resumo estatístico de um técnico.
 * @param {import('better-sqlite3').Database} db
 * @param {string} id - ID do técnico
 * @returns {object}
 */
function getTechnicianStats(db, id) {
  const tech = getTechnicianById(db, id);

  const bookingsCount = db.prepare(`
    SELECT 
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'Concluído' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status = 'Em Execução' THEN 1 ELSE 0 END) AS in_progress,
      SUM(CASE WHEN status IN ('Pendente', 'Confirmado') THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status IN ('Cancelado', 'Rejeitado') THEN 1 ELSE 0 END) AS cancelled
    FROM bookings
    WHERE technician_id = ?
  `).get(id);

  const commissions = db.prepare(`
    SELECT 
      COALESCE(SUM(commission_amount), 0) AS total_commissions,
      COALESCE(SUM(CASE WHEN paid = 1 THEN commission_amount ELSE 0 END), 0) AS paid_commissions,
      COALESCE(SUM(CASE WHEN paid = 0 THEN commission_amount ELSE 0 END), 0) AS pending_commissions
    FROM commissions
    WHERE user_id = ?
  `).get(id);

  return {
    technician: tech,
    stats: {
      total_bookings: bookingsCount.total || 0,
      completed_bookings: bookingsCount.completed || 0,
      in_progress_bookings: bookingsCount.in_progress || 0,
      pending_bookings: bookingsCount.pending || 0,
      cancelled_bookings: bookingsCount.cancelled || 0,
      total_commissions: commissions.total_commissions || 0,
      paid_commissions: commissions.paid_commissions || 0,
      pending_commissions: commissions.pending_commissions || 0,
    }
  };
}

module.exports = {
  getAvailableTechnicians,
  listTechnicians,
  getTechnicianById,
  createTechnician,
  updateTechnician,
  deleteTechnician,
  assignTechnicianToBooking,
  getTechnicianBookings,
  getTechnicianStats,
};

