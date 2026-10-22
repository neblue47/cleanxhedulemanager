/**
 * CleanXhedule Manager — Service: Clientes
 *
 * Identificador principal: número de telefone (Angola — WhatsApp/Chamadas).
 * Busca rápida por telefone: searchByPhone() com LIKE parcial para o assistente.
 */
'use strict';

const { v4: uuidv4 } = require('uuid');
const { NotFoundError, ValidationError } = require('../middleware/errorHandler');

// Campos públicos devolvidos nas listagens
const CLIENT_FIELDS = `
  id, name, phone, email, address, tax_id, type, notes,
  created_by, created_at, updated_at
`;

// Campos parciais para a busca rápida (não expõe dados sensíveis desnecessários)
const SEARCH_FIELDS = 'id, name, phone, email, type, address';

const VALID_TYPES = ['Particular', 'Empresa'];

/**
 * Cria um novo cliente.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} data
 * @param {string} createdByUserId - UUID do utilizador que está a registar
 * @returns {object} Cliente criado
 */
function createClient(db, data, createdByUserId) {
  const { name, phone, email, address, tax_id, type = 'Particular', notes } = data;

  if (!name || !phone || !address) {
    throw new ValidationError('Os campos name, phone e address são obrigatórios.');
  }
  if (!VALID_TYPES.includes(type)) {
    throw new ValidationError(`Tipo inválido. Valores aceites: ${VALID_TYPES.join(', ')}.`);
  }
  if (type === 'Empresa' && !tax_id) {
    throw new ValidationError("O campo tax_id (NIF) é obrigatório para clientes do tipo 'Empresa'.");
  }

  const id  = uuidv4();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO clients
      (id, name, phone, email, address, tax_id, type, notes, created_by, created_at, updated_at)
    VALUES
      (@id, @name, @phone, @email, @address, @tax_id, @type, @notes, @created_by, @now, @now)
  `).run({
    id,
    name:       name.trim(),
    phone:      phone.trim(),
    email:      email ? email.trim().toLowerCase() : null,
    address:    address.trim(),
    tax_id:     tax_id  || null,
    type,
    notes:      notes   || null,
    created_by: createdByUserId,
    now,
  });

  return getClientById(db, id);
}

/**
 * Lista clientes com filtros e paginação.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} [filters]
 * @param {string} [filters.type]    - 'Particular' | 'Empresa'
 * @param {string} [filters.search]  - Pesquisa por nome (LIKE)
 * @param {number} [filters.limit]
 * @param {number} [filters.offset]
 * @returns {{ data: object[], total: number }}
 */
function listClients(db, { type, search, limit = 50, offset = 0 } = {}) {
  const conditions = [];
  const params     = [];

  if (type) {
    conditions.push('type = ?');
    params.push(type);
  }
  if (search) {
    conditions.push('(name LIKE ? OR phone LIKE ?)');
    const pattern = `%${search}%`;
    params.push(pattern, pattern);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = db
    .prepare(`SELECT COUNT(*) as count FROM clients ${where}`)
    .get(...params).count;

  const data = db
    .prepare(`SELECT ${CLIENT_FIELDS} FROM clients ${where} ORDER BY name ASC LIMIT ? OFFSET ?`)
    .all(...params, Number(limit), Number(offset));

  return { data, total, limit: Number(limit), offset: Number(offset) };
}

/**
 * Retorna um cliente pelo ID.
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 * @returns {object}
 * @throws {NotFoundError}
 */
function getClientById(db, id) {
  const client = db
    .prepare(`SELECT ${CLIENT_FIELDS} FROM clients WHERE id = ?`)
    .get(id);

  if (!client) throw new NotFoundError('Cliente');
  return client;
}

/**
 * Busca rápida de clientes por número de telefone (parcial).
 * Usada pelo assistente de atendimento para identificar o cliente instantaneamente.
 *
 * Pesquisa com LIKE em ambas as direções para suportar pesquisa parcial:
 * Ex: "923" retorna todos os clientes cujo telefone contém "923".
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} phoneQuery - Fragmento do número de telefone
 * @param {number} [limit]    - Máximo de resultados (default: 10 para velocidade)
 * @returns {object[]} Lista de clientes com campos parciais
 */
function searchByPhone(db, phoneQuery, limit = 10) {
  if (!phoneQuery || phoneQuery.trim().length < 3) {
    throw new ValidationError('A pesquisa por telefone deve ter pelo menos 3 caracteres.');
  }

  // Remove espaços para pesquisa mais robusta
  const cleanQuery = phoneQuery.replace(/\s/g, '');
  const pattern    = `%${cleanQuery}%`;

  return db
    .prepare(`
      SELECT ${SEARCH_FIELDS}
      FROM   clients
      WHERE  REPLACE(phone, ' ', '') LIKE ?
      ORDER BY name ASC
      LIMIT  ?
    `)
    .all(pattern, Number(limit));
}

/**
 * Atualiza dados de um cliente.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 * @param {object} data - Campos a atualizar
 * @returns {object} Cliente atualizado
 */
function updateClient(db, id, data) {
  // Verifica existência
  getClientById(db, id);

  const allowed = ['name', 'phone', 'email', 'address', 'tax_id', 'type', 'notes'];
  const updates = {};

  for (const key of allowed) {
    if (data[key] !== undefined) {
      updates[key] = data[key];
    }
  }

  if (Object.keys(updates).length === 0) {
    throw new ValidationError('Nenhum campo válido fornecido para atualização.');
  }

  if (updates.type && !VALID_TYPES.includes(updates.type)) {
    throw new ValidationError(`Tipo inválido. Valores aceites: ${VALID_TYPES.join(', ')}.`);
  }

  updates.updated_at = new Date().toISOString();
  if (updates.email) updates.email = updates.email.trim().toLowerCase();
  if (updates.name)  updates.name  = updates.name.trim();
  if (updates.phone) updates.phone = updates.phone.trim();

  const setClauses = Object.keys(updates).map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE clients SET ${setClauses} WHERE id = @id`).run({ ...updates, id });

  return getClientById(db, id);
}

module.exports = { createClient, listClients, getClientById, searchByPhone, updateClient };
