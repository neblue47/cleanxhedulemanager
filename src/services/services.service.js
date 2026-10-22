/**
 * CleanXhedule Manager — Service: Catálogo de Serviços
 * ----------------------------------------------------
 * Gestão do catálogo de serviços de higienização de móveis (service_types).
 */
'use strict';

const { v4: uuidv4 } = require('uuid');
const { NotFoundError, ValidationError } = require('../middleware/errorHandler');

const SERVICE_FIELDS = `
  id, name, description, base_price, price_medium_multiplier,
  price_large_multiplier, duration_minutes, checklist_template_id,
  is_active, created_at, updated_at
`;

/**
 * Lista serviços do catálogo com suporte a filtro por estado ativo e paginação.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} [filters]
 * @param {boolean|number} [filters.is_active]
 * @param {number} [filters.limit]
 * @param {number} [filters.offset]
 * @returns {{ data: object[], total: number, limit: number, offset: number }}
 */
function listServices(db, { is_active, limit = 50, offset = 0 } = {}) {
  const conditions = [];
  const params     = [];

  if (is_active !== undefined && is_active !== null) {
    conditions.push('is_active = ?');
    params.push(Number(is_active) ? 1 : 0);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = db
    .prepare(`SELECT COUNT(*) AS count FROM service_types ${where}`)
    .get(...params).count;

  const data = db
    .prepare(`SELECT ${SERVICE_FIELDS} FROM service_types ${where} ORDER BY name ASC LIMIT ? OFFSET ?`)
    .all(...params, Number(limit), Number(offset));

  return { data, total, limit: Number(limit), offset: Number(offset) };
}

/**
 * Obtém os detalhes de um serviço pelo ID.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 * @returns {object}
 * @throws {NotFoundError}
 */
function getServiceById(db, id) {
  const service = db
    .prepare(`SELECT ${SERVICE_FIELDS} FROM service_types WHERE id = ?`)
    .get(id);

  if (!service) throw new NotFoundError('Tipo de serviço');
  return service;
}

/**
 * Regista um novo tipo de serviço no catálogo.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} data
 * @param {string} data.name
 * @param {string} [data.description]
 * @param {number} data.base_price
 * @param {number} [data.price_medium_multiplier=1.5]
 * @param {number} [data.price_large_multiplier=2.0]
 * @param {number} [data.duration_minutes=60]
 * @returns {object} Serviço criado
 */
function createService(db, data) {
  const {
    name,
    description,
    base_price,
    price_medium_multiplier = 1.5,
    price_large_multiplier  = 2.0,
    duration_minutes        = 60,
  } = data;

  if (!name || name.trim() === '') {
    throw new ValidationError('O nome do serviço é obrigatório.');
  }

  if (base_price === undefined || base_price === null || Number(base_price) < 0) {
    throw new ValidationError('O preço base deve ser um valor numérico não negativo.');
  }

  const id  = uuidv4();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO service_types (
      id, name, description, base_price, price_medium_multiplier,
      price_large_multiplier, duration_minutes, is_active, created_at, updated_at
    ) VALUES (
      @id, @name, @description, @base_price, @price_medium_multiplier,
      @price_large_multiplier, @duration_minutes, 1, @now, @now
    )
  `).run({
    id,
    name:                    name.trim(),
    description:             description ? description.trim() : null,
    base_price:              Number(base_price),
    price_medium_multiplier: Number(price_medium_multiplier),
    price_large_multiplier:  Number(price_large_multiplier),
    duration_minutes:        Number(duration_minutes),
    now,
  });

  return getServiceById(db, id);
}

/**
 * Atualiza um serviço existente no catálogo.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 * @param {object} data
 * @returns {object} Serviço atualizado
 */
function updateService(db, id, data) {
  getServiceById(db, id); // Garantir existência

  const allowed = [
    'name', 'description', 'base_price',
    'price_medium_multiplier', 'price_large_multiplier',
    'duration_minutes', 'is_active',
  ];

  const updates = {};
  for (const key of allowed) {
    if (data[key] !== undefined) {
      updates[key] = data[key];
    }
  }

  if (Object.keys(updates).length === 0) {
    throw new ValidationError('Nenhum campo válido enviado para atualização.');
  }

  if (updates.name !== undefined && updates.name.trim() === '') {
    throw new ValidationError('O nome do serviço não pode ser vazio.');
  }
  if (updates.base_price !== undefined && Number(updates.base_price) < 0) {
    throw new ValidationError('O preço base deve ser maior ou igual a zero.');
  }

  updates.updated_at = new Date().toISOString();
  if (updates.name) updates.name = updates.name.trim();
  if (updates.description) updates.description = updates.description.trim();

  const setClauses = Object.keys(updates).map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE service_types SET ${setClauses} WHERE id = @id`).run({ ...updates, id });

  return getServiceById(db, id);
}

/**
 * Desativa ou remove um serviço do catálogo.
 * Se houver agendamentos associados, efetua desativação (soft delete).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 * @returns {{ message: string }}
 */
function deleteService(db, id) {
  getServiceById(db, id);

  const bookingsCount = db
    .prepare('SELECT COUNT(*) AS cnt FROM bookings WHERE service_type_id = ?')
    .get(id).cnt;

  if (bookingsCount > 0) {
    const now = new Date().toISOString();
    db.prepare('UPDATE service_types SET is_active = 0, updated_at = ? WHERE id = ?').run(now, id);
    return { message: 'Serviço desativado por conter agendamentos associados.' };
  }

  db.prepare('DELETE FROM service_types WHERE id = ?').run(id);
  return { message: 'Serviço removido com sucesso.' };
}

module.exports = {
  listServices,
  getServiceById,
  createService,
  updateService,
  deleteService,
};
