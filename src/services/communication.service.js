/**
 * CleanXhedule Manager — Service: Comunicações
 * ---------------------------------------------
 * Envio de mensagens (WhatsApp/SMS), registo de logs e templates.
 */
'use strict';

const { v4: uuidv4 } = require('uuid');
const { NotFoundError, ValidationError } = require('../middleware/errorHandler');

const LOG_FIELDS = `
  l.id, l.booking_id, l.client_id, l.agent_id, l.channel,
  l.direction, l.summary, l.duration_seconds, l.sent_at, l.delivered_at
`;

/**
 * Substitui placeholders em templates de mensagem (ex: {{client_name}}, {{date}}).
 *
 * @param {string} templateBody
 * @param {object} params
 * @returns {string}
 */
function interpolateTemplate(templateBody, params = {}) {
  let result = templateBody;
  for (const [key, value] of Object.entries(params)) {
    const placeholder = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
    result = result.replace(placeholder, value || '');
  }
  return result;
}

/**
 * Enviar mensagem via WhatsApp.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} data
 * @param {string} [data.booking_id]
 * @param {string} data.client_id
 * @param {string} [data.template_type]
 * @param {string} [data.custom_message]
 * @param {string} agentId - ID do utilizador que enviou a mensagem
 * @returns {object} Registo no log de comunicação
 */
function sendWhatsAppMessage(db, data, agentId) {
  const { booking_id, client_id, template_type, custom_message } = data;

  if (!client_id) {
    throw new ValidationError('O campo client_id é obrigatório.');
  }

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(client_id);
  if (!client) throw new NotFoundError('Cliente');

  let messageText = custom_message;

  if (template_type) {
    const tmpl = db.prepare('SELECT body_template FROM message_templates WHERE type = ? AND channel = "WhatsApp" AND is_active = 1 LIMIT 1').get(template_type);
    if (tmpl) {
      let bookingData = {};
      if (booking_id) {
        const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(booking_id);
        if (b) {
          bookingData = {
            date: b.scheduled_date,
            time: b.scheduled_time,
            address: b.address,
            amount: b.final_amount,
          };
        }
      }
      messageText = interpolateTemplate(tmpl.body_template, {
        client_name: client.name,
        phone: client.phone,
        ...bookingData,
      });
    }
  }

  if (!messageText || messageText.trim() === '') {
    messageText = `Olá ${client.name}, mensagem da equipa CleanXhedule Manager.`;
  }

  const id  = uuidv4();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO communication_logs (
      id, booking_id, client_id, agent_id, channel, direction, summary, sent_at, delivered_at
    ) VALUES (
      @id, @booking_id, @client_id, @agentId, 'WhatsApp', 'Outbound', @messageText, @now, @now
    )
  `).run({
    id,
    booking_id: booking_id || null,
    client_id,
    agentId,
    messageText,
    now,
  });

  return db.prepare(`SELECT ${LOG_FIELDS} FROM communication_logs l WHERE l.id = ?`).get(id);
}

/**
 * Enviar SMS.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} data
 * @param {string} [data.booking_id]
 * @param {string} data.client_id
 * @param {string} data.message
 * @param {string} agentId
 * @returns {object}
 */
function sendSMSMessage(db, data, agentId) {
  const { booking_id, client_id, message } = data;

  if (!client_id || !message) {
    throw new ValidationError('Os campos client_id e message são obrigatórios.');
  }

  const client = db.prepare('SELECT id FROM clients WHERE id = ?').get(client_id);
  if (!client) throw new NotFoundError('Cliente');

  const id  = uuidv4();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO communication_logs (
      id, booking_id, client_id, agent_id, channel, direction, summary, sent_at, delivered_at
    ) VALUES (
      @id, @booking_id, @client_id, @agentId, 'SMS', 'Outbound', @message, @now, @now
    )
  `).run({
    id,
    booking_id: booking_id || null,
    client_id,
    agentId,
    message,
    now,
  });

  return db.prepare(`SELECT ${LOG_FIELDS} FROM communication_logs l WHERE l.id = ?`).get(id);
}

/**
 * Obter histórico de comunicações de um agendamento.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} bookingId
 * @returns {object[]}
 */
function getCommunicationLogsByBooking(db, bookingId) {
  return db.prepare(`
    SELECT
      ${LOG_FIELDS},
      u.name AS agent_name,
      c.name AS client_name
    FROM communication_logs l
    LEFT JOIN users   u ON l.agent_id  = u.id
    LEFT JOIN clients c ON l.client_id = c.id
    WHERE l.booking_id = ?
    ORDER BY l.sent_at DESC
  `).all(bookingId);
}

/**
 * Processar webhook de mensagem recebida do WhatsApp.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} payload
 * @returns {object}
 */
function handleWhatsAppWebhook(db, payload) {
  const { client_phone, message, booking_id } = payload || {};

  if (!client_phone || !message) {
    throw new ValidationError('Webhook necessita de client_phone e message.');
  }

  // Tenta encontrar o cliente pelo telefone
  const client = db.prepare('SELECT id FROM clients WHERE REPLACE(phone, " ", "") LIKE ? LIMIT 1')
    .get(`%${client_phone.replace(/\s/g, '')}%`);

  const clientId = client ? client.id : 'unknown-client';
  const systemAgent = db.prepare("SELECT id FROM users WHERE role = 'Admin' LIMIT 1").get();
  const agentId = systemAgent ? systemAgent.id : 'system';

  const id  = uuidv4();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO communication_logs (
      id, booking_id, client_id, agent_id, channel, direction, summary, sent_at
    ) VALUES (
      @id, @booking_id, @clientId, @agentId, 'WhatsApp', 'Inbound', @message, @now
    )
  `).run({
    id,
    booking_id: booking_id || null,
    clientId,
    agentId,
    message,
    now,
  });

  return { success: true, log_id: id };
}

module.exports = {
  sendWhatsAppMessage,
  sendSMSMessage,
  getCommunicationLogsByBooking,
  handleWhatsAppWebhook,
};
