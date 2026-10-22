/**
 * CleanXhedule Manager — Testes: Catálogo de Serviços
 */
'use strict';

const request = require('supertest');

jest.mock('../database/db', () => {
  const Database = (() => {
    try {
      return require('better-sqlite3');
    } catch {
      const { Database: WasmDatabase } = require('node-sqlite3-wasm');

      const origPrepare = WasmDatabase.prototype.prepare;
      WasmDatabase.prototype.prepare = function (sql) {
        const stmt = origPrepare.call(this, sql);
        stmt.source = sql;
        return stmt;
      };

      const tempDb = new WasmDatabase(':memory:');
      const StatementProto = Object.getPrototypeOf(tempDb.prepare('SELECT 1'));
      tempDb.close();

      const wrapMethod = (origMethod) => {
        return function (...args) {
          let finalArgs = args;
          if (args.length > 1) finalArgs = [args];
          const firstArg = finalArgs[0];
          if (firstArg && typeof firstArg === 'object' && !Array.isArray(firstArg)) {
            const sql = this.source || '';
            const placeholders = sql.match(/([@$:][a-zA-Z0-9_]+)/g) || [];
            const mapped = {};
            for (const p of placeholders) {
              const raw = p.slice(1);
              mapped[p] = firstArg[p] !== undefined ? firstArg[p] : firstArg[raw];
            }
            finalArgs = [mapped];
          }
          return origMethod.apply(this, finalArgs);
        };
      };

      StatementProto.run = wrapMethod(StatementProto.run);
      StatementProto.all = wrapMethod(StatementProto.all);
      StatementProto.get = wrapMethod(StatementProto.get);

      if (!WasmDatabase.prototype.pragma) {
        WasmDatabase.prototype.pragma = function (source, options) {
          const stmt = this.prepare(`PRAGMA ${source}`);
          const simplify = options && options.simple;
          try {
            const results = stmt.all();
            if (simplify && results.length > 0) {
              return results[0][Object.keys(results[0])[0]];
            }
            return results;
          } catch { return stmt.run(); }
        };
      }

      if (!WasmDatabase.prototype.transaction) {
        WasmDatabase.prototype.transaction = function (fn) {
          const self = this;
          return function (...args) {
            self.exec('BEGIN IMMEDIATE');
            try {
              const res = fn.apply(this, args);
              self.exec('COMMIT');
              return res;
            } catch (err) {
              self.exec('ROLLBACK');
              throw err;
            }
          };
        };
      }

      return WasmDatabase;
    }
  })();

  const path = require('path');
  const fs   = require('fs');

  const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');
  const seedPath   = path.join(__dirname, '..', 'database', 'seed.sql');
  const schema     = fs.readFileSync(schemaPath, 'utf8');
  const seed       = fs.readFileSync(seedPath, 'utf8');

  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(schema);
  db.exec(seed);

  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync('Admin@1234', 10);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR REPLACE INTO users (id, name, email, phone, password_hash, role, active, created_at, updated_at)
    VALUES
      ('bk-admin-001', 'Admin', 'admin@bk.ao', '+244930100001', ?, 'Admin', 1, ?, ?),
      ('bk-assist-002', 'Assistente', 'assist@bk.ao', '+244930100002', ?, 'Assistente', 1, ?, ?),
      ('bk-gestor-003', 'Gestor', 'gestor@bk.ao', '+244930100003', ?, 'GestorComercial', 1, ?, ?)
  `).run(hash, now, now, hash, now, now, hash, now, now);

  return { getDb: () => db, closeDb: () => {} };
});

const { createApp } = require('../src/app');
const app = createApp();

let adminToken;
let assistToken;
let createdServiceId;

async function loginAs(email, password = 'Admin@1234') {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password });
  return res.body.data?.accessToken;
}

describe('Catálogo de Serviços — GET & CRUD', () => {
  beforeAll(async () => {
    adminToken  = await loginAs('admin@bk.ao');
    assistToken = await loginAs('assist@bk.ao');
  });

  it('deve listar serviços do catálogo → 200', async () => {
    const res = await request(app)
      .get('/api/v1/services')
      .set('Authorization', `Bearer ${assistToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('data');
    expect(Array.isArray(res.body.data.data)).toBe(true);
  });

  it('deve criar novo serviço (Admin) → 201', async () => {
    const res = await request(app)
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name:                    'Higienização de Tapetes',
        description:             'Limpeza profunda de tapetes artesanais',
        base_price:              12000,
        price_medium_multiplier: 1.4,
        price_large_multiplier:  1.8,
        duration_minutes:        90,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Higienização de Tapetes');
    expect(res.body.data.base_price).toBe(12000);
    createdServiceId = res.body.data.id;
  });

  it('deve obter detalhe do serviço criado → 200', async () => {
    expect(createdServiceId).toBeDefined();
    const res = await request(app)
      .get(`/api/v1/services/${createdServiceId}`)
      .set('Authorization', `Bearer ${assistToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(createdServiceId);
  });

  it('deve atualizar serviço (Admin) → 200', async () => {
    const res = await request(app)
      .put(`/api/v1/services/${createdServiceId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        base_price: 14000,
      });

    expect(res.status).toBe(200);
    expect(res.body.data.base_price).toBe(14000);
  });

  it('deve eliminar/desativar serviço (Admin) → 200', async () => {
    const res = await request(app)
      .delete(`/api/v1/services/${createdServiceId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
