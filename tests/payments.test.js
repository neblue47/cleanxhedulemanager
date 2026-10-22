/**
 * CleanXhedule Manager — Testes: Pagamentos
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

  // Seed cliente extra para pagamentos
  db.prepare(`
    INSERT OR IGNORE INTO clients (id, name, phone, address, type, created_by)
    VALUES ('bk-client-001', 'Maria Cliente', '+244923456789', 'Luanda', 'Particular', 'bk-admin-001')
  `).run();

  return { getDb: () => db, closeDb: () => {} };
});

const { createApp } = require('../src/app');
const app = createApp();

let adminToken;
let assistToken;
let bookingId;
let paymentId;

async function loginAs(email, password = 'Admin@1234') {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password });
  return res.body.data?.accessToken;
}

describe('Módulo de Pagamentos — API', () => {
  beforeAll(async () => {
    adminToken  = await loginAs('admin@bk.ao');
    assistToken = await loginAs('assist@bk.ao');

    // Criar um agendamento para testes de pagamento
    const res = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${assistToken}`)
      .send({
        client_id:       'bk-client-001',
        service_type_id: 'b1b2c3d4-0001-4000-8000-100000000001',
        item_size:       'Pequeno',
        scheduled_date:  '2026-09-10',
        scheduled_time:  '10:00',
        origin_channel:  'WhatsApp',
        address:         'Rua da Samba, Luanda',
        travel_fee:      0,
        discount:        0,
      });

    bookingId = res.body.data?.id;
  });

  it('deve registar um pagamento em dinheiro → 201', async () => {
    expect(bookingId).toBeDefined();

    const res = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${assistToken}`)
      .send({
        booking_id: bookingId,
        amount:     15000,
        method:     'Dinheiro',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.amount).toBe(15000);
    paymentId = res.body.data.id;
  });

  it('deve obter histórico de pagamentos do agendamento → 200', async () => {
    const res = await request(app)
      .get(`/api/v1/payments/booking/${bookingId}`)
      .set('Authorization', `Bearer ${assistToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('deve confirmar pagamento e depósito bancário → 200', async () => {
    expect(paymentId).toBeDefined();

    const res = await request(app)
      .put(`/api/v1/payments/${paymentId}/confirm`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.deposited_to_bank).toBe(1);
  });

  it('deve obter relatório consolidado de pagamentos → 200', async () => {
    const res = await request(app)
      .get('/api/v1/payments/report')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('summary');
    expect(res.body.data).toHaveProperty('transactions');
  });
});
