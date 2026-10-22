/**
 * CleanXhedule Manager — Service: Utilizadores (Funcionários)
 *
 * RBAC:
 *   createUser   → Admin only
 *   listUsers    → Admin, GestorComercial
 *   getUserById  → Admin, GestorComercial | próprio utilizador
 *   updateUser   → Admin | próprio utilizador (campos limitados)
 *   deactivateUser → Admin only
 */
'use strict';

const { v4: uuidv4 }    = require('uuid');
const { hashPassword }  = require('./auth.service');
const { NotFoundError, ValidationError } = require('../middleware/errorHandler');

// Campos devolvidos ao cliente (excluindo password_hash)
const PUBLIC_FIELDS = 'id, name, email, phone, role, active, created_at, updated_at';

// Roles permitidos para criação/atualização
const VALID_ROLES = ['Admin', 'GestorComercial', 'Assistente', 'Tecnico'];

/**
 * Cria um novo utilizador (funcionário).
 * Apenas Admins podem chamar este serviço.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} data
 * @param {string} data.name
 * @param {string} data.email
 * @param {string} data.password
 * @param {string} data.role
 * @param {string} [data.phone]
 * @returns {object} Utilizador criado (sem password_hash)
 */
function createUser(db, { name, email, password, role, phone }) {
  if (!VALID_ROLES.includes(role)) {
    throw new ValidationError(`Role inválido. Valores aceites: ${VALID_ROLES.join(', ')}.`);
  }
  if (!password || password.length < 8) {
    throw new ValidationError('A password deve ter pelo menos 8 caracteres.');
  }

  const id            = uuidv4();
  const password_hash = hashPassword(password);
  const normalizedEmail = email.trim().toLowerCase();
  const now           = new Date().toISOString();

  db.prepare(`
    INSERT INTO users (id, name, email, phone, password_hash, role, active, created_at, updated_at)
    VALUES (@id, @name, @email, @phone, @password_hash, @role, 1, @now, @now)
  `).run({ id, name: name.trim(), email: normalizedEmail, phone: phone || null, password_hash, role, now });

  return getUserById(db, id);
}

/**
 * Lista utilizadores com filtros opcionais.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} [filters]
 * @param {string} [filters.role]    - Filtra por role
 * @param {boolean} [filters.active] - Filtra por estado (true/false)
 * @param {number} [filters.limit]   - Limite de resultados (default: 50)
 * @param {number} [filters.offset]  - Offset para paginação (default: 0)
 * @returns {object[]}
 */
function listUsers(db, { role, active, limit = 50, offset = 0 } = {}) {
  const conditions = [];
  const params     = [];

  if (role) {
    conditions.push('role = ?');
    params.push(role);
  }
  if (active !== undefined) {
    conditions.push('active = ?');
    params.push(active ? 1 : 0);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql   = `SELECT ${PUBLIC_FIELDS} FROM users ${where} ORDER BY name ASC LIMIT ? OFFSET ?`;

  params.push(Number(limit), Number(offset));
  return db.prepare(sql).all(...params);
}

/**
 * Retorna um utilizador pelo ID.
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 * @returns {object}
 * @throws {NotFoundError}
 */
function getUserById(db, id) {
  const user = db
    .prepare(`SELECT ${PUBLIC_FIELDS} FROM users WHERE id = ?`)
    .get(id);

  if (!user) throw new NotFoundError('Utilizador');
  return user;
}

/**
 * Atualiza dados de um utilizador.
 * - Admins podem alterar qualquer campo (incluindo role e active).
 * - Outros utilizadores só podem alterar name, phone (campos limitados).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} id - UUID do utilizador a atualizar
 * @param {object} data - Campos a atualizar
 * @param {string} requesterRole - Role do utilizador que faz o pedido
 * @returns {object} Utilizador atualizado
 */
function updateUser(db, id, data, requesterRole = 'Tecnico') {
  // Verifica que o utilizador existe
  getUserById(db, id);

  const allowedForAll  = ['name', 'phone'];
  const allowedForAdmin = [...allowedForAll, 'email', 'role', 'active'];

  const allowed = requesterRole === 'Admin' ? allowedForAdmin : allowedForAll;
  const updates = {};

  for (const key of allowed) {
    if (data[key] !== undefined) {
      updates[key] = data[key];
    }
  }

  // Atualizar password separadamente com hashing
  if (data.password) {
    if (data.password.length < 8) {
      throw new ValidationError('A nova password deve ter pelo menos 8 caracteres.');
    }
    updates.password_hash = hashPassword(data.password);
  }

  if (Object.keys(updates).length === 0) {
    throw new ValidationError('Nenhum campo válido fornecido para atualização.');
  }

  // Validar role se estiver a ser atualizado
  if (updates.role && !VALID_ROLES.includes(updates.role)) {
    throw new ValidationError(`Role inválido. Valores aceites: ${VALID_ROLES.join(', ')}.`);
  }

  updates.updated_at = new Date().toISOString();
  if (updates.email) updates.email = updates.email.trim().toLowerCase();

  const setClauses = Object.keys(updates).map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE users SET ${setClauses} WHERE id = @id`).run({ ...updates, id });

  return getUserById(db, id);
}

/**
 * Desativa um utilizador (soft delete — nunca remove da BD).
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 * @returns {{ message: string }}
 */
function deactivateUser(db, id) {
  getUserById(db, id); // Garante que existe
  db.prepare('UPDATE users SET active = 0, updated_at = ? WHERE id = ?')
    .run(new Date().toISOString(), id);
  return { message: 'Utilizador desativado com sucesso.' };
}

/**
 * Lista apenas utilizadores com role = 'Tecnico' (para atribuição de serviços).
 * @param {import('better-sqlite3').Database} db
 * @param {object} [filters]
 * @param {boolean} [filters.activeOnly]
 */
function listTechnicians(db, { activeOnly = true } = {}) {
  const where = activeOnly ? "WHERE role = 'Tecnico' AND active = 1" : "WHERE role = 'Tecnico'";
  return db.prepare(`SELECT ${PUBLIC_FIELDS} FROM users ${where} ORDER BY name ASC`).all();
}

module.exports = { createUser, listUsers, getUserById, updateUser, deactivateUser, listTechnicians };
