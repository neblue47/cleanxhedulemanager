/**
 * CleanXhedule Manager — Testes: Documentos (Faturas, Recibos)
 */
'use strict';

const request = require('supertest');

// ── Mock do DB em Memória ─────────────────────────────────────────────────────

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
  const fs = require('fs');
  const bcrypt = require('bcryptjs');

  const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');

  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(schema);

  const now = new Date().toISOString();
  const hash = bcrypt.hashSync('Admin@1234', 10);

  db.prepare(`
    INSERT INTO users (id, name, email, phone, password_hash, role, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run('doc-admin-01', 'Admin Documentos', 'admin.doc@cleanxhedule.ao', '+244921999001', hash, 'Admin', now, now);

  db.prepare(`
    INSERT INTO clients (id, name, phone, email, address, type, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'Particular', ?, ?, ?)
  `).run('doc-cli-01', 'Jose Maria Pedroto', '244922556633', 'pedroto@email.ao', 'Bairro Kifica, Benfica', 'doc-admin-01', now, now);

  db.prepare(`
    INSERT INTO service_types (id, name, description, base_price, price_medium_multiplier, price_large_multiplier, duration_minutes, is_active)
    VALUES (?, ?, ?, ?, ?, ?, 60, 1)
  `).run('srv-cama-01', 'Base da Cama', 'Higienização de base de cama', 40000.0, 1.5, 2.0);

  db.prepare(`
    INSERT INTO service_types (id, name, description, base_price, price_medium_multiplier, price_large_multiplier, duration_minutes, is_active)
    VALUES (?, ?, ?, ?, ?, ?, 90, 1)
  `).run('srv-sofa-02', 'Lavagem de Sofa', 'Higienização profunda de sofá', 21000.0, 1.5, 2.0);

  return {
    getDb: () => db,
    closeDb: () => db.close(),
  };
});

const jwt = require('jsonwebtoken');
const { createApp } = require('../src/app');
const app = createApp();
const { getDb } = require('../database/db');

describe('Módulo de Documentos — Geração de Faturas', () => {
  let db;
  let adminToken;

  beforeAll(() => {
    db = getDb();
    adminToken = jwt.sign(
      { id: 'doc-admin-01', email: 'admin.doc@cleanxhedule.ao', role: 'Admin' },
      process.env.JWT_SECRET || 'test_jwt_secret_cleanxhedule_2024',
      { expiresIn: '1h' }
    );
  });

  test('deve gerar fatura HTML com valores calculados para dois serviços sem exibir "Incluído"', async () => {
    const bookingRes = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        client_id: 'doc-cli-01',
        service_type_id: 'srv-cama-01',
        item_size: 'Pequeno',
        item_quantity: 1,
        secondary_service_type_id: 'srv-sofa-02',
        secondary_item_size: 'Pequeno',
        secondary_item_quantity: 2,
        scheduled_date: '2026-10-16',
        scheduled_time: '10:00',
        origin_channel: 'WhatsApp',
        address: 'Bairro Kifica, Benfica',
        travel_fee: 0,
        discount: 0,
        payment_method: 'Dinheiro',
      });

    expect(bookingRes.status).toBe(201);
    const bookingId = bookingRes.body.data.id;

    const invoiceRes = await request(app)
      .get(`/api/v1/documents/invoice/${bookingId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Accept', 'text/html');

    expect(invoiceRes.status).toBe(200);
    expect(invoiceRes.text).toContain('FATURA PROFORMA');
    expect(invoiceRes.text).toContain('Base da Cama');
    expect(invoiceRes.text).toContain('Lavagem de Sofa');

    // Validação principal: NÃO deve conter "Incluído" na tabela
    expect(invoiceRes.text).not.toContain('Incluído');

    // Deve exibir os valores calculados: 40.000,00 AOA e 42.000,00 AOA
    expect(invoiceRes.text).toContain('40.000,00 AOA');
    expect(invoiceRes.text).toContain('42.000,00 AOA');
    expect(invoiceRes.text).toContain('82.000,00 Kz');
  });

  test('deve gerar fatura HTML com taxa de deslocação detalhada quando travel_fee > 0', async () => {
    const bookingRes = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        client_id: 'doc-cli-01',
        service_type_id: 'srv-cama-01',
        item_size: 'Pequeno',
        item_quantity: 1,
        scheduled_date: '2026-10-17',
        scheduled_time: '11:00',
        origin_channel: 'Telefone',
        address: 'Bairro Kifica, Benfica',
        travel_fee: 3000,
        discount: 0,
        payment_method: 'Transferencia',
      });

    expect(bookingRes.status).toBe(201);
    const bookingId = bookingRes.body.data.id;

    const invoiceRes = await request(app)
      .get(`/api/v1/documents/invoice/${bookingId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Accept', 'text/html');

    expect(invoiceRes.status).toBe(200);
    expect(invoiceRes.text).toContain('Taxa de Deslocação');
    expect(invoiceRes.text).toContain('3.000,00 AOA');
    expect(invoiceRes.text).toContain('40.000,00 AOA');
    expect(invoiceRes.text).not.toContain('Incluído');
  });
});
