/**
 * CleanXhedule Manager — Rotas: Agendamentos
 * Base: /api/v1/bookings
 *
 * Endpoints implementados:
 *   POST   /bookings            — Criar agendamento (Assistente/GestorComercial/Admin)
 *   GET    /bookings            — Listar agendamentos (filtros opcionais: status, date, technician_id, channel)
 *   GET    /bookings/calendar   — Agendamentos do dia para o calendário
 *   GET    /bookings/:id        — Detalhes de um agendamento
 *   PUT    /bookings/:id/status — Atualizar estado do agendamento (Tecnico/Gestor/Admin)
 *   PUT    /bookings/:id        — Atualizar dados do agendamento (Gestor/Admin)
 *   DELETE /bookings/:id        — Cancelar agendamento (soft-delete)
 */
'use strict';

const express = require('express');
const router = express.Router();

const { verifyToken, requireRoles } = require('../middleware/auth');
const { getDb } = require('../../database/db');
const { createBooking, getBookingById } = require('../services/bookings.service');
const { ValidationError, NotFoundError } = require('../middleware/errorHandler');

// Todos os endpoints requerem autenticação
router.use(verifyToken);

/* ─────────────────────────────────────────────────────────────────────────────
   POST /bookings — Criar agendamento
   Perfis autorizados: Admin, GestorComercial, Assistente
───────────────────────────────────────────────────────────────────────────── */
router.post(
  '/',
  requireRoles('Admin', 'GestorComercial', 'Assistente'),
  (req, res, next) => {
    try {
      const db = getDb();
      const booking = createBooking(db, req.body, req.user.id);
      return res.status(201).json({ success: true, data: booking });
    } catch (err) {
      next(err);
    }
  }
);

/* ─────────────────────────────────────────────────────────────────────────────
   GET /bookings/calendar — Agendamentos do dia para o calendário
   Query params: date (YYYY-MM-DD) — se omitido usa hoje
───────────────────────────────────────────────────────────────────────────── */
router.get('/calendar', (req, res, next) => {
  try {
    const db = getDb();
    const date = req.query.date || new Date().toISOString().split('T')[0];

    const rows = db.prepare(`
      SELECT
        b.id, b.scheduled_time, b.status,
        b.item_size, b.final_amount,
        c.name AS client_name,
        u.name AS technician_name
      FROM bookings b
      LEFT JOIN clients  c ON b.client_id     = c.id
      LEFT JOIN users    u ON b.technician_id  = u.id
      WHERE b.scheduled_date = ?
        AND b.status NOT IN ('Cancelado', 'Rejeitado')
      ORDER BY b.scheduled_time ASC
    `).all(date);

    return res.json({ success: true, data: rows, date });
  } catch (err) {
    next(err);
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   GET /bookings — Listar agendamentos com filtros opcionais
   Query params: status, date, technician_id, channel, limit, offset
───────────────────────────────────────────────────────────────────────────── */
router.get('/', (req, res, next) => {
  try {
    const db = getDb();
    const {
      status,
      date,
      technician_id,
      channel,
      limit = 20,
      offset = 0,
    } = req.query;

    const conditions = [];
    const params = [];

    if (status) { conditions.push('b.status = ?'); params.push(status); }
    if (date) { conditions.push('b.scheduled_date = ?'); params.push(date); }
    if (technician_id) { conditions.push('b.technician_id = ?'); params.push(technician_id); }
    if (channel) { conditions.push('b.origin_channel = ?'); params.push(channel); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const total = db.prepare(`SELECT COUNT(*) AS cnt FROM bookings b ${where}`).get(...params).cnt;

    const rows = db.prepare(`
      SELECT
        b.*,
        c.name AS client_name, c.phone AS client_phone, c.type AS client_type,
        st.name AS service_name,
        st2.name AS secondary_service_name,
        u.name AS technician_name
      FROM bookings b
      LEFT JOIN clients       c   ON b.client_id                 = c.id
      LEFT JOIN service_types st  ON b.service_type_id           = st.id
      LEFT JOIN service_types st2 ON b.secondary_service_type_id = st2.id
      LEFT JOIN users         u   ON b.technician_id             = u.id
      ${where}
      ORDER BY b.scheduled_date DESC, b.scheduled_time DESC
      LIMIT ? OFFSET ?
    `).all(...params, Number(limit), Number(offset));

    return res.json({
      success: true,
      data: {
        data: rows,
        total,
        limit: Number(limit),
        offset: Number(offset),
      },
    });
  } catch (err) {
    next(err);
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   GET /bookings/:id — Detalhes de um agendamento
───────────────────────────────────────────────────────────────────────────── */
router.get('/:id', (req, res, next) => {
  try {
    const db = getDb();
    const booking = getBookingById(db, req.params.id);
    return res.json({ success: true, data: booking });
  } catch (err) {
    next(err);
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   PUT /bookings/:id/status — Atualizar estado do agendamento
   Perfis: Admin, GestorComercial, Tecnico
   Body: { status: 'EmExecucao' | 'Concluido' | 'Cancelado' | 'Rejeitado' }
───────────────────────────────────────────────────────────────────────────── */
const STATUS_MAP = {
  'Pendente': 'Pendente',
  'Confirmado': 'Confirmado',
  'EmExecucao': 'Em Execução',
  'Em Execução': 'Em Execução',
  'Concluido': 'Concluído',
  'Concluído': 'Concluído',
  'Cancelado': 'Cancelado',
  'Rejeitado': 'Rejeitado',
};

const VALID_STATUS_TRANSITIONS = Object.keys(STATUS_MAP);

router.put(
  '/:id/status',
  requireRoles('Admin', 'GestorComercial', 'Assistente', 'Tecnico'),
  (req, res, next) => {
    try {
      const { status } = req.body;
      if (!status || !STATUS_MAP[status]) {
        throw new ValidationError(
          `Estado inválido. Valores aceites: ${VALID_STATUS_TRANSITIONS.join(', ')}.`
        );
      }

      const normalizedStatus = STATUS_MAP[status];
      const db = getDb();
      // Técnicos só podem atualizar os seus próprios agendamentos
      const booking = getBookingById(db, req.params.id);
      if (req.user.role === 'Tecnico' && booking.technician_id !== req.user.id) {
        const { ForbiddenError } = require('../middleware/errorHandler');
        throw new ForbiddenError('Só pode atualizar os seus próprios agendamentos.');
      }

      const now = new Date().toISOString();
      db.prepare(`UPDATE bookings SET status = ?, updated_at = ? WHERE id = ?`)
        .run(normalizedStatus, now, req.params.id);

      const updated = getBookingById(db, req.params.id);
      return res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

/* ─────────────────────────────────────────────────────────────────────────────
   PUT /bookings/:id — Atualizar dados do agendamento (Gestor/Admin/Assistente)
   Apenas agendamentos com status 'Pendente' podem ser editados.
────────────────────────────────────────────────────────────────────────────── */
router.put(
  '/:id',
  requireRoles('Admin', 'GestorComercial', 'Assistente'),
  (req, res, next) => {
    try {
      const db = getDb();
      const booking = getBookingById(db, req.params.id);

      if (booking.status !== 'Pendente') {
        throw new ValidationError('Só é possível editar agendamentos com estado "Pendente".');
      }

      const {
        scheduled_date, scheduled_time, address, notes,
        discount, travel_fee, technician_id,
        service_type_id, item_size, item_quantity,
        secondary_service_type_id, secondary_item_size, secondary_item_quantity,
      } = req.body;

      const updates = [];
      const params = [];

      // Campos simples (sem impacto no preço)
      const resolvedNotes = req.body.item_notes !== undefined ? req.body.item_notes : (notes !== undefined ? notes : undefined);
      const simpleFields = {
        scheduled_date,
        scheduled_time,
        address,
        item_notes: resolvedNotes,
        discount,
        travel_fee,
        technician_id,
      };
      for (const [field, val] of Object.entries(simpleFields)) {
        if (val !== undefined) { updates.push(`${field} = ?`); params.push(val); }
      }

      // Campos de serviço — recalcular final_amount
      const newServiceId     = service_type_id     ?? booking.service_type_id;
      const newSize          = item_size            ?? booking.item_size;
      const newQty           = Number(item_quantity ?? booking.item_quantity ?? 1);
      const newSecServiceId  = secondary_service_type_id !== undefined ? (secondary_service_type_id || null) : booking.secondary_service_type_id;
      const newSecSize       = secondary_item_size  ?? booking.secondary_item_size ?? 'Pequeno';
      const newSecQty        = Number(secondary_item_quantity ?? booking.secondary_item_quantity ?? 1);

      const validSizes = ['Pequeno', 'Médio', 'Grande'];
      if (!validSizes.includes(newSize)) throw new ValidationError('Tamanho do item inválido.');
      if (newSecServiceId && !validSizes.includes(newSecSize)) throw new ValidationError('Tamanho do item secundário inválido.');

      // Buscar preço do serviço principal
      const svc = db.prepare('SELECT * FROM service_types WHERE id = ? AND is_active = 1').get(newServiceId);
      if (!svc) throw new ValidationError('Tipo de serviço principal não encontrado ou inativo.');

      let mult = 1.0;
      if (newSize === 'Médio') mult = svc.price_medium_multiplier;
      if (newSize === 'Grande') mult = svc.price_large_multiplier;
      const primaryAmount = svc.base_price * mult * newQty;

      // Buscar preço do serviço secundário (se existir)
      let secondaryAmount = 0;
      if (newSecServiceId) {
        const svc2 = db.prepare('SELECT * FROM service_types WHERE id = ? AND is_active = 1').get(newSecServiceId);
        if (!svc2) throw new ValidationError('Tipo de serviço secundário não encontrado ou inativo.');
        let mult2 = 1.0;
        if (newSecSize === 'Médio') mult2 = svc2.price_medium_multiplier;
        if (newSecSize === 'Grande') mult2 = svc2.price_large_multiplier;
        secondaryAmount = svc2.base_price * mult2 * newSecQty;
      }

      const effectiveDiscount   = discount   !== undefined ? Number(discount)    : Number(booking.discount    ?? 0);
      const effectiveTravelFee  = travel_fee !== undefined ? Number(travel_fee)  : Number(booking.travel_fee  ?? 0);
      const newFinalAmount = primaryAmount + secondaryAmount + effectiveTravelFee - effectiveDiscount;

      // Always update service / price columns
      updates.push('service_type_id = ?');           params.push(newServiceId);
      updates.push('item_size = ?');                 params.push(newSize);
      updates.push('item_quantity = ?');             params.push(newQty);
      updates.push('secondary_service_type_id = ?'); params.push(newSecServiceId || null);
      updates.push('secondary_item_size = ?');       params.push(newSecServiceId ? newSecSize : null);
      updates.push('secondary_item_quantity = ?');   params.push(newSecServiceId ? newSecQty : null);
      updates.push('base_service_price = ?');        params.push(svc.base_price);
      updates.push('final_amount = ?');              params.push(newFinalAmount);

      if (updates.length === 0) throw new ValidationError('Nenhum campo válido enviado para atualização.');

      const now = new Date().toISOString();
      updates.push('updated_at = ?');
      params.push(now, booking.id);

      db.prepare(`UPDATE bookings SET ${updates.join(', ')} WHERE id = ?`).run(...params);

      const updated = getBookingById(db, req.params.id);
      return res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

/* ─────────────────────────────────────────────────────────────────────────────
   PATCH /bookings/:id/technician — Atribuir ou alterar técnico de um agendamento
   Perfis: Admin, GestorComercial, Assistente
   Body: { technician_id: string|null }
───────────────────────────────────────────────────────────────────────────── */
router.patch(
  '/:id/technician',
  requireRoles('Admin', 'GestorComercial', 'Assistente'),
  (req, res, next) => {
    try {
      const { technician_id } = req.body;
      const db = getDb();
      const { assignTechnicianToBooking } = require('../services/technicians.service');
      const updated = assignTechnicianToBooking(db, req.params.id, technician_id || null);
      return res.json({ success: true, data: updated, message: 'Técnico atribuído com sucesso.' });
    } catch (err) {
      next(err);
    }
  }
);

/* ─────────────────────────────────────────────────────────────────────────────
   DELETE /bookings/:id — Cancelar agendamento (soft-delete via status)
   Perfis: Admin, GestorComercial, Assistente
───────────────────────────────────────────────────────────────────────────── */
router.delete(
  '/:id',
  requireRoles('Admin', 'GestorComercial', 'Assistente'),
  (req, res, next) => {
    try {
      const db = getDb();
      const booking = getBookingById(db, req.params.id);

      if (['Concluido', 'Cancelado'].includes(booking.status)) {
        throw new ValidationError('Não é possível cancelar um agendamento já concluído ou cancelado.');
      }

      const now = new Date().toISOString();
      db.prepare(`UPDATE bookings SET status = 'Cancelado', updated_at = ? WHERE id = ?`)
        .run(now, booking.id);

      return res.json({ success: true, message: 'Agendamento cancelado com sucesso.' });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
