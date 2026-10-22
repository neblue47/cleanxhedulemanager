/**
 * CleanXhedule Manager — Service: Agendamentos
 * --------------------------------------------
 * Implementa a lógica do Módulo 3: Core do Agendamento (SQLite)
 */
'use strict';

const { v4: uuidv4 } = require('uuid');
const { getAvailableTechnicians } = require('../services/technicians.service');
const { ValidationError, NotFoundError } = require('../middleware/errorHandler');


// Validation helper for technician assignment
function validateTechnicianAssignment(db, technicianId, date, time) {
  const shift = getShiftFromTime(time);
  const available = getAvailableTechnicians(db, { date, shift });
  const ok = available.some(t => t.id === technicianId);
  if (!ok) {
    throw new ValidationError('Técnico selecionado não está disponível para a data/turno selecionados.');
  }
}

/**
 * Mapeia o horário do agendamento (HH:MM) para o turno correspondente:
 * - Manhã: 06:00 às 11:59
 * - Tarde: 12:00 às 17:59
 * - Noite: 18:00 às 23:59
 *
 * @param {string} timeString - Horário no formato HH:MM
 * @returns {'Manhã'|'Tarde'|'Noite'}
 */
function getShiftFromTime(timeString) {
  if (!timeString || !timeString.includes(':')) {
    throw new ValidationError('Formato de hora inválido. Deve ser HH:MM.');
  }
  const parts = timeString.split(':');
  const hour = parseInt(parts[0], 10);
  if (isNaN(hour) || hour < 0 || hour > 23) {
    throw new ValidationError('Formato de hora inválido. Deve ser HH:MM.');
  }

  if (hour >= 6 && hour < 12) {
    return 'Manhã';
  } else if (hour >= 12 && hour < 18) {
    return 'Tarde';
  } else {
    return 'Noite';
  }
}

/**
 * Cria um novo agendamento de serviço.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} data
 * @param {string} data.client_id
 * @param {string} data.service_type_id
 * @param {'Pequeno'|'Médio'|'Grande'} data.item_size
 * @param {string} [data.item_material]
 * @param {string} [data.item_notes]
 * @param {string} data.scheduled_date - YYYY-MM-DD
 * @param {string} data.scheduled_time - HH:MM
 * @param {string} [data.technician_id]
 * @param {'Telefone'|'WhatsApp'} data.origin_channel
 * @param {string} data.address
 * @param {number} [data.travel_fee=0.0]
 * @param {number} [data.discount=0.0]
 * @param {string} [data.payment_method='Dinheiro']
 * @param {string} registeredByUserId - ID do utilizador (assistente/gestor) a registar
 * @returns {object} O agendamento criado
 */
function createBooking(db, data, registeredByUserId) {
  const {
    client_id,
    service_type_id,
    item_size,
    item_quantity = 1,
    item_material,
    item_notes,
    secondary_service_type_id,
    secondary_item_size,
    secondary_item_quantity = 1,
    scheduled_date,
    scheduled_time,
    technician_id,
    origin_channel,
    address,
    travel_fee = 0.0,
    discount = 0.0,
    payment_method = 'Dinheiro',
  } = data;

  // 1. Validações básicas de formato/campos obrigatórios
  if (!client_id || !service_type_id || !item_size || !scheduled_date || !scheduled_time || !origin_channel || !address) {
    throw new ValidationError('Os campos client_id, service_type_id, item_size, scheduled_date, scheduled_time, origin_channel e address são obrigatórios.');
  }

  const validSizes = ['Pequeno', 'Médio', 'Grande'];
  if (!validSizes.includes(item_size)) {
    throw new ValidationError(`Tamanho do item inválido. Valores aceites: ${validSizes.join(', ')}.`);
  }

  const validChannels = ['Telefone', 'WhatsApp'];
  if (!validChannels.includes(origin_channel)) {
    throw new ValidationError(`Canal de origem inválido. Valores aceites: ${validChannels.join(', ')}.`);
  }

  const validPaymentMethods = ['Dinheiro', 'Transferencia'];
  if (!validPaymentMethods.includes(payment_method)) {
    throw new ValidationError(`Método de pagamento inválido. Valores aceites: ${validPaymentMethods.join(', ')}.`);
  }

  // Obter o turno a partir do horário
  const shift = getShiftFromTime(scheduled_time);

  // Executa toda a lógica e persistência numa transação SQLite
  const transaction = db.transaction(() => {
    // 2. Verificar se o cliente existe
    const client = db.prepare('SELECT id FROM clients WHERE id = ?').get(client_id);
    if (!client) {
      throw new NotFoundError('Cliente');
    }

    // 3. Verificar se o tipo de serviço existe e está ativo
    const serviceType = db.prepare('SELECT * FROM service_types WHERE id = ? AND is_active = 1').get(service_type_id);
    if (!serviceType) {
      throw new NotFoundError('Tipo de serviço');
    }

    // 3.1. Validar segundo tipo de serviço (se fornecido)
    let secondaryServiceType = null;
    let secondary_service_amount = 0;
    if (secondary_service_type_id) {
      secondaryServiceType = db.prepare('SELECT * FROM service_types WHERE id = ? AND is_active = 1').get(secondary_service_type_id);
      if (!secondaryServiceType) {
        throw new NotFoundError('Segundo tipo de serviço');
      }
      const secSize = secondary_item_size || 'Pequeno';
      if (!validSizes.includes(secSize)) {
        throw new ValidationError(`Tamanho do item secundário inválido. Valores aceites: ${validSizes.join(', ')}.`);
      }
      let secMult = 1.0;
      if (secSize === 'Médio') {
        secMult = secondaryServiceType.price_medium_multiplier;
      } else if (secSize === 'Grande') {
        secMult = secondaryServiceType.price_large_multiplier;
      }
      secondary_service_amount = secondaryServiceType.base_price * secMult * Number(secondary_item_quantity || 1);
    }

    // 4. Se um técnico for especificado, verificar existência, estado e agenda/disponibilidade
    if (technician_id) {
      const technician = db.prepare("SELECT id, role, active FROM users WHERE id = ?").get(technician_id);
      if (!technician) {
        throw new NotFoundError('Técnico');
      }
      if (technician.role !== 'Tecnico' || technician.active !== 1) {
        throw new ValidationError('O utilizador especificado não é um técnico ativo.');
      }

      // Validar disponibilidade na tabela technician_availability
      const availability = db.prepare(`
        SELECT is_available FROM technician_availability
        WHERE technician_id = ? AND date = ? AND shift = ?
      `).get(technician_id, scheduled_date, shift);

      if (!availability || availability.is_available !== 1) {
        throw new ValidationError('O técnico não está disponível para a data e turno selecionados.');
      }

      // Validar conflito de agenda no mesmo horário exato em bookings ativos
      const conflict = db.prepare(`
        SELECT id FROM bookings
        WHERE technician_id = ?
          AND scheduled_date = ?
          AND scheduled_time = ?
          AND status NOT IN ('Rejeitado', 'Cancelado')
      `).get(technician_id, scheduled_date, scheduled_time);

      if (conflict) {
        throw new ValidationError('O técnico já possui um agendamento para este dia e horário.');
      }
    }

    // 5. Calcular valor final
    const base_service_price = serviceType.base_price;
    let multiplicador_tamanho = 1.0;
    if (item_size === 'Médio') {
      multiplicador_tamanho = serviceType.price_medium_multiplier;
    } else if (item_size === 'Grande') {
      multiplicador_tamanho = serviceType.price_large_multiplier;
    }

    const primary_service_amount = base_service_price * multiplicador_tamanho * Number(item_quantity);
    const total_services_amount = primary_service_amount + secondary_service_amount;
    const final_amount = total_services_amount + Number(travel_fee) - Number(discount);

    // 6. Inserir agendamento
    const bookingId = uuidv4();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO bookings (
        id, client_id, service_type_id, item_size, item_quantity, item_material, item_notes,
        secondary_service_type_id, secondary_item_size, secondary_item_quantity,
        scheduled_date, scheduled_time, technician_id, registered_by,
        origin_channel, address, travel_fee, base_service_price, discount,
        final_amount, status, payment_status, payment_method, created_at, updated_at
      ) VALUES (
        @id, @client_id, @service_type_id, @item_size, @item_quantity, @item_material, @item_notes,
        @secondary_service_type_id, @secondary_item_size, @secondary_item_quantity,
        @scheduled_date, @scheduled_time, @technician_id, @registered_by,
        @origin_channel, @address, @travel_fee, @base_service_price, @discount,
        @final_amount, 'Pendente', 'Pendente', @payment_method, @now, @now
      )
    `).run({
      id: bookingId,
      client_id,
      service_type_id,
      item_size,
      item_quantity,
      item_material: item_material || null,
      item_notes: item_notes || null,
      secondary_service_type_id: secondary_service_type_id || null,
      secondary_item_size: secondary_service_type_id ? (secondary_item_size || 'Pequeno') : null,
      secondary_item_quantity: secondary_service_type_id ? Number(secondary_item_quantity || 1) : null,
      scheduled_date,
      scheduled_time,
      technician_id: technician_id || null,
      registered_by: registeredByUserId,
      origin_channel,
      address,
      travel_fee,
      base_service_price,
      discount,
      final_amount,
      payment_method,
      now,
    });

    // 7. Inserir log de transação na tabela communication_logs
    const logId = uuidv4();
    const summary = `Agendamento registado via ${origin_channel}. Preço final: ${final_amount} AOA.`;

    db.prepare(`
      INSERT INTO communication_logs (
        id, booking_id, client_id, agent_id, channel, direction, summary, sent_at
      ) VALUES (
        @id, @booking_id, @client_id, @agent_id, @channel, 'Inbound', @summary, @now
      )
    `).run({
      id: logId,
      booking_id: bookingId,
      client_id,
      agent_id: registeredByUserId,
      channel: origin_channel,
      summary,
      now,
    });

    // Retorna o agendamento recém-criado
    return db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
  });

  return transaction();
}

/**
 * Retorna os detalhes de um agendamento pelo ID.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 * @returns {object}
 */
function getBookingById(db, id) {
  const booking = db.prepare(`
    SELECT
      b.*,
      c.name AS client_name, c.phone AS client_phone, c.type AS client_type, c.tax_id AS client_tax_id,
      st.name AS service_name,
      st2.name AS secondary_service_name,
      u.name AS technician_name
    FROM bookings b
    LEFT JOIN clients       c   ON b.client_id                 = c.id
    LEFT JOIN service_types st  ON b.service_type_id           = st.id
    LEFT JOIN service_types st2 ON b.secondary_service_type_id = st2.id
    LEFT JOIN users         u   ON b.technician_id             = u.id
    WHERE b.id = ?
  `).get(id);
  if (!booking) {
    throw new NotFoundError('Agendamento');
  }
  return booking;
}

module.exports = {
  createBooking,
  getBookingById,
  getShiftFromTime,
};
