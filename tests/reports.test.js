/**
 * CleanXhedule Manager — Testes: Relatórios BI
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

async function loginAs(email, password = 'Admin@1234') {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password });
  return res.body.data?.accessToken;
}

describe('Relatórios Analíticos (BI) — API', () => {
  beforeAll(async () => {
    adminToken  = await loginAs('admin@bk.ao');
    assistToken = await loginAs('assist@bk.ao');
  });

  it('deve obter relatório de clientes (Admin) → 200', async () => {
    const res = await request(app)
      .get('/api/v1/reports/clients')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('summary');
    expect(res.body.data).toHaveProperty('topClients');
  });

  it('deve obter relatório de serviços → 200', async () => {
    const res = await request(app)
      .get('/api/v1/reports/services')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('services');
  });

  it('deve obter relatório de faturação / receita → 200', async () => {
    const res = await request(app)
      .get('/api/v1/reports/revenue')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('summary');
  });

  it('deve obter relatório de desempenho dos técnicos → 200', async () => {
    const res = await request(app)
      .get('/api/v1/reports/performance')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('technicians');
  });

  it('deve obter análise de canais (Telefone vs WhatsApp) → 200', async () => {
    const res = await request(app)
      .get('/api/v1/reports/channels')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('channels');
  });

  it('deve obter relatório de pagamentos pendentes → 200', async () => {
    const res = await request(app)
      .get('/api/v1/reports/payments')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('summary');
    expect(res.body.data).toHaveProperty('bookings');
  });

  it('não deve permitir acesso ao relatório para perfil de Assistente → 403', async () => {
    const res = await request(app)
      .get('/api/v1/reports/revenue')
      .set('Authorization', `Bearer ${assistToken}`);

    expect(res.status).toBe(403);
  });
});
