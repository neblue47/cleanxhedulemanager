/**
 * CleanXhedule Manager — Service: Logs de Trabalho & Fotos
 * --------------------------------------------------------
 * Registo de execução técnica no local (Check-in / Check-out GPS, Checklist e Fotos Antes/Depois).
 */
'use strict';

const { v4: uuidv4 } = require('uuid');
const { NotFoundError, ValidationError } = require('../middleware/errorHandler');
const { createCommission } = require('./commissions.service');

/**
 * Registar Check-in do técnico no local do cliente.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} data
 * @param {string} data.booking_id
 * @param {string} data.technician_id
 * @param {number} [data.latitude]
 * @param {number} [data.longitude]
 * @returns {object} Work log criado
 */
function checkIn(db, data) {
  const { booking_id, technician_id, latitude, longitude } = data;

  if (!booking_id || !technician_id) {
    throw new ValidationError('Os campos booking_id e technician_id são obrigatórios.');
  }

  const transaction = db.transaction(() => {
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(booking_id);
    if (!booking) throw new NotFoundError('Agendamento');

    const now = new Date().toISOString();
    let workLog = db.prepare('SELECT * FROM work_logs WHERE booking_id = ?').get(booking_id);

    if (!workLog) {
      const id = uuidv4();
      db.prepare(`
        INSERT INTO work_logs (
          id, booking_id, technician_id, check_in_time,
          check_in_latitude, check_in_longitude, status, created_at
        ) VALUES (
          @id, @booking_id, @technician_id, @now,
          @latitude, @longitude, 'Em Execução', @now
        )
      `).run({
        id,
        booking_id,
        technician_id,
        now,
        latitude: latitude !== undefined ? Number(latitude) : null,
        longitude: longitude !== undefined ? Number(longitude) : null,
      });

      workLog = db.prepare('SELECT * FROM work_logs WHERE id = ?').get(id);
    }

    // Atualiza estado do agendamento para 'Em Execução' (se não estiver concluído)
    if (booking.status !== 'Concluido' && booking.status !== 'Cancelado') {
      db.prepare("UPDATE bookings SET status = 'Em Execução', updated_at = ? WHERE id = ?")
        .run(now, booking_id);
    }

    return workLog;
  });

  return transaction();
}

/**
 * Registar Check-out do técnico e finalizar serviço.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} data
 * @param {string} data.booking_id
 * @param {string} data.technician_id
 * @param {number} [data.latitude]
 * @param {number} [data.longitude]
 * @param {object|array} [data.checklist_completed]
 * @returns {object} Work log atualizado
 */
function checkOut(db, data) {
  const { booking_id, technician_id, latitude, longitude, checklist_completed } = data;

  if (!booking_id || !technician_id) {
    throw new ValidationError('Os campos booking_id e technician_id são obrigatórios.');
  }

  const transaction = db.transaction(() => {
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(booking_id);
    if (!booking) throw new NotFoundError('Agendamento');

    const now = new Date().toISOString();
    let workLog = db.prepare('SELECT * FROM work_logs WHERE booking_id = ?').get(booking_id);

    const checklistStr = checklist_completed ? JSON.stringify(checklist_completed) : null;

    if (!workLog) {
      const id = uuidv4();
      db.prepare(`
        INSERT INTO work_logs (
          id, booking_id, technician_id, check_out_time,
          check_out_latitude, check_out_longitude, checklist_completed, status, created_at
        ) VALUES (
          @id, @booking_id, @technician_id, @now,
          @latitude, @longitude, @checklistStr, 'Concluído', @now
        )
      `).run({
        id,
        booking_id,
        technician_id,
        now,
        latitude: latitude !== undefined ? Number(latitude) : null,
        longitude: longitude !== undefined ? Number(longitude) : null,
        checklistStr,
      });
    } else {
      db.prepare(`
        UPDATE work_logs
        SET check_out_time = @now,
            check_out_latitude = @latitude,
            check_out_longitude = @longitude,
            checklist_completed = COALESCE(@checklistStr, checklist_completed),
            status = 'Concluído'
        WHERE booking_id = @booking_id
      `).run({
        booking_id,
        now,
        latitude: latitude !== undefined ? Number(latitude) : null,
        longitude: longitude !== undefined ? Number(longitude) : null,
        checklistStr,
      });
    }

    // Atualizar agendamento para 'Concluido'
    db.prepare("UPDATE bookings SET status = 'Concluído', updated_at = ? WHERE id = ?")
      .run(now, booking_id);

    // Gerar comissão automática para o técnico se ainda não tiver sido gerada
    const existingComm = db.prepare('SELECT id FROM commissions WHERE booking_id = ? AND user_id = ?').get(booking_id, technician_id);
    if (!existingComm) {
      try {
        createCommission(db, booking_id, technician_id, 'Tecnico');
      } catch {
        // Ignora se não conseguir gerar comissão automática
      }
    }

    return db.prepare('SELECT * FROM work_logs WHERE booking_id = ?').get(booking_id);
  });

  return transaction();
}

/**
 * Registar foto "Antes" ou "Depois" do agendamento.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} data
 * @param {string} data.booking_id
 * @param {string} data.technician_id
 * @param {'Antes'|'Depois'} data.photo_type
 * @param {string} data.file_url
 * @param {string} [data.checklist_task_id]
 * @returns {object} Foto registada
 */
function uploadPhoto(db, data) {
  const { booking_id, technician_id, photo_type, file_url, checklist_task_id } = data;

  if (!booking_id || !technician_id || !photo_type || !file_url) {
    throw new ValidationError('Os campos booking_id, technician_id, photo_type e file_url são obrigatórios.');
  }

  const validTypes = ['Antes', 'Depois'];
  if (!validTypes.includes(photo_type)) {
    throw new ValidationError(`Tipo de foto inválido. Valores aceites: ${validTypes.join(', ')}.`);
  }

  const booking = db.prepare('SELECT id FROM bookings WHERE id = ?').get(booking_id);
  if (!booking) throw new NotFoundError('Agendamento');

  const id  = uuidv4();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO photos (
      id, booking_id, technician_id, photo_type, file_url, checklist_task_id, uploaded_at
    ) VALUES (
      @id, @booking_id, @technician_id, @photo_type, @file_url, @checklist_task_id, @now
    )
  `).run({
    id,
    booking_id,
    technician_id,
    photo_type,
    file_url,
    checklist_task_id: checklist_task_id || null,
    now,
  });

  return db.prepare('SELECT * FROM photos WHERE id = ?').get(id);
}

/**
 * Obter log de trabalho e fotos de um agendamento.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} bookingId
 * @returns {object}
 */
function getWorkLogByBooking(db, bookingId) {
  const workLog = db.prepare('SELECT * FROM work_logs WHERE booking_id = ?').get(bookingId);
  const photos  = db.prepare('SELECT * FROM photos WHERE booking_id = ? ORDER BY uploaded_at ASC').all(bookingId);

  return {
    workLog: workLog || null,
    photos,
  };
}

module.exports = {
  checkIn,
  checkOut,
  uploadPhoto,
  getWorkLogByBooking,
};
