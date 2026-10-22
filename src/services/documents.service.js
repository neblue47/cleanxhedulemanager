/**
 * CleanXhedule Manager — Service: Documentos
 * -------------------------------------------
 * Geração de Orçamentos, Faturas, Recibos e Relatórios de Serviço.
 */
'use strict';

const { v4: uuidv4 } = require('uuid');
const { NotFoundError, ValidationError } = require('../middleware/errorHandler');

const DOCUMENT_FIELDS = `
  d.id, d.booking_id, d.type, d.document_number, d.file_url,
  d.issued_at, d.sent_via_whatsapp
`;

/**
 * Gera um número de documento único com formato semântico (ex: ORC-20260820-A1B2)
 *
 * @param {string} prefix - 'ORC' | 'FT' | 'REC' | 'REL'
 * @returns {string}
 */
function generateDocumentNumber(prefix) {
  const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${dateStr}-${randomSuffix}`;
}

/**
 * Gerar um documento de Orçamento para um agendamento.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} bookingId
 * @returns {object} Documento criado
 */
function generateQuote(db, bookingId) {
  const booking = db.prepare(`
    SELECT b.*, c.name AS client_name, s.name AS service_name
    FROM bookings b
    JOIN clients c ON b.client_id = c.id
    JOIN service_types s ON b.service_type_id = s.id
    WHERE b.id = ?
  `).get(bookingId);

  if (!booking) throw new NotFoundError('Agendamento');

  const id = uuidv4();
  const document_number = generateDocumentNumber('ORC');
  const file_url = `/api/v1/documents/${id}/download`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO documents (
      id, booking_id, type, document_number, file_url, issued_at, sent_via_whatsapp
    ) VALUES (
      @id, @bookingId, 'Orcamento', @document_number, @file_url, @now, 0
    )
  `).run({
    id,
    bookingId,
    document_number,
    file_url,
    now,
  });

  return getDocumentById(db, id);
}

/**
 * Gerar um documento de Fatura / Recibo para um agendamento.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} bookingId
 * @returns {object} Documento criado
 */
function generateInvoice(db, bookingId) {
  const booking = db.prepare(`
    SELECT b.*, c.name AS client_name, s.name AS service_name
    FROM bookings b
    JOIN clients c ON b.client_id = c.id
    JOIN service_types s ON b.service_type_id = s.id
    WHERE b.id = ?
  `).get(bookingId);

  if (!booking) throw new NotFoundError('Agendamento');

  const id = uuidv4();
  const docType = booking.payment_status === 'Pago' ? 'Recibo' : 'Fatura';
  const prefix  = docType === 'Recibo' ? 'REC' : 'FT';
  const document_number = generateDocumentNumber(prefix);
  const file_url = `/api/v1/documents/${id}/download`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO documents (
      id, booking_id, type, document_number, file_url, issued_at, sent_via_whatsapp
    ) VALUES (
      @id, @bookingId, @docType, @document_number, @file_url, @now, 0
    )
  `).run({
    id,
    bookingId,
    docType,
    document_number,
    file_url,
    now,
  });

  return getDocumentById(db, id);
}

/**
 * Obter detalhes de um documento pelo ID.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 * @returns {object}
 */
function getDocumentById(db, id) {
  const document = db.prepare(`
    SELECT
      ${DOCUMENT_FIELDS},
      b.scheduled_date, b.final_amount, b.item_size, b.item_quantity, b.payment_status,
      b.discount, b.travel_fee, b.base_service_price,
      b.secondary_service_type_id, b.secondary_item_size, b.secondary_item_quantity,
      s.name AS service_name,
      s.base_price AS service_base_price,
      s.price_medium_multiplier AS service_medium_multiplier,
      s.price_large_multiplier AS service_large_multiplier,
      s2.name AS secondary_service_name,
      s2.base_price AS secondary_service_base_price,
      s2.price_medium_multiplier AS secondary_medium_multiplier,
      s2.price_large_multiplier AS secondary_large_multiplier,
      c.name AS client_name, c.phone AS client_phone, c.address AS client_address
    FROM documents d
    JOIN bookings b ON d.booking_id = b.id
    JOIN clients  c ON b.client_id  = c.id
    LEFT JOIN service_types s  ON b.service_type_id           = s.id
    LEFT JOIN service_types s2 ON b.secondary_service_type_id = s2.id
    WHERE d.id = ?
  `).get(id);

  if (!document) throw new NotFoundError('Documento');
  return document;
}

/**
 * Registar envio de documento via WhatsApp.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 * @returns {object} Documento atualizado
 */
function markDocumentSentWhatsApp(db, id) {
  getDocumentById(db, id);

  db.prepare('UPDATE documents SET sent_via_whatsapp = 1 WHERE id = ?').run(id);
  return getDocumentById(db, id);
}

module.exports = {
  generateQuote,
  generateInvoice,
  getDocumentById,
  markDocumentSentWhatsApp,
};
