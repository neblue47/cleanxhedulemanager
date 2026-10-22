/**
 * CleanXhedule Manager — Testes: Gestão de Técnicos
 * Cobre listagem, CRUD, disponibilidade por turnos, bookings e estatísticas
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
      ('bk-gestor-003', 'Gestor', 'gestor@bk.ao', '+244930100003', ?, 'GestorComercial', 1, ?, ?),
      ('bk-tech-004', 'Tecnico A', 'tec-a@bk.ao', '+244930100004', ?, 'Tecnico', 1, ?, ?),
      ('bk-tech-005', 'Tecnico B', 'tec-b@bk.ao', '+244930100005', ?, 'Tecnico', 1, ?, ?)
  `).run(hash, now, now, hash, now, now, hash, now, now, hash, now, now, hash, now, now);

  return { getDb: () => db, closeDb: () => {} };
});

const { createApp } = require('../src/app');
const app = createApp();

let adminToken;
let assistToken;
let techToken;
let createdTechId;

async function loginAs(email, password = 'Admin@1234') {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password });
  return res.body.data?.accessToken;
}

beforeAll(async () => {
  adminToken = await loginAs('admin@bk.ao');
  assistToken = await loginAs('assist@bk.ao');
  techToken = await loginAs('tec-a@bk.ao');
});

describe('Módulo de Técnicos — API REST', () => {

  // 1. Listagem
  describe('GET /api/v1/technicians', () => {
    it('deve listar técnicos para perfil Admin → 200', async () => {
      const res = await request(app)
        .get('/api/v1/technicians')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(2);
      expect(res.body.data[0]).toHaveProperty('name');
      expect(res.body.data[0]).toHaveProperty('role', 'Tecnico');
      expect(res.body.data[0]).not.toHaveProperty('password_hash');
    });

    it('deve filtrar técnicos ativos com activeOnly=true', async () => {
      const res = await request(app)
        .get('/api/v1/technicians?activeOnly=true')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.every(t => t.active === 1)).toBe(true);
    });
  });

  // 2. Criação (POST)
  describe('POST /api/v1/technicians', () => {
    it('deve criar novo técnico com sucesso (Admin) → 201', async () => {
      const res = await request(app)
        .post('/api/v1/technicians')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Manuel Sebastião',
          email: 'manuel.sebastiao@bk.ao',
          phone: '+244923456789',
          password: 'PasswordSegura@123',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Manuel Sebastião');
      expect(res.body.data.email).toBe('manuel.sebastiao@bk.ao');
      expect(res.body.data.role).toBe('Tecnico');
      expect(res.body.data.active).toBe(1);
      createdTechId = res.body.data.id;
    });

    it('deve retornar 400 ao tentar criar com email duplicado', async () => {
      const res = await request(app)
        .post('/api/v1/technicians')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Duplicado',
          email: 'manuel.sebastiao@bk.ao',
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('deve retornar 400 se nome ou email estiver em falta', async () => {
      const res = await request(app)
        .post('/api/v1/technicians')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Sem Email' });

      expect(res.status).toBe(400);
    });

    it('não deve permitir que Assistente crie técnico → 403', async () => {
      const res = await request(app)
        .post('/api/v1/technicians')
        .set('Authorization', `Bearer ${assistToken}`)
        .send({
          name: 'Técnico Não Autorizado',
          email: 'sem.acesso@bk.ao',
        });

      expect(res.status).toBe(403);
    });
  });

  // 3. Detalhe (GET /:id)
  describe('GET /api/v1/technicians/:id', () => {
    it('deve retornar detalhes do técnico criado → 200', async () => {
      const res = await request(app)
        .get(`/api/v1/technicians/${createdTechId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(createdTechId);
      expect(res.body.data.name).toBe('Manuel Sebastião');
    });

    it('deve retornar 404 para ID inexistente', async () => {
      const res = await request(app)
        .get('/api/v1/technicians/tech-inexistente-999')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });
  });

  // 4. Atualização (PUT /:id)
  describe('PUT /api/v1/technicians/:id', () => {
    it('deve atualizar nome e telefone do técnico → 200', async () => {
      const res = await request(app)
        .put(`/api/v1/technicians/${createdTechId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Manuel Sebastião Atualizado',
          phone: '+244923999888',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Manuel Sebastião Atualizado');
      expect(res.body.data.phone).toBe('+244923999888');
    });

    it('deve retornar 400 se password for inferior a 8 caracteres', async () => {
      const res = await request(app)
        .put(`/api/v1/technicians/${createdTechId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ password: '123' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });

  // 5. Disponibilidade (GET e PUT /:id/availability)
  describe('Disponibilidade Operacional do Técnico', () => {
    it('deve registar turnos de disponibilidade via PUT /availability → 200', async () => {
      const entries = [
        { date: '2026-09-01', shift: 'Manhã', is_available: 1 },
        { date: '2026-09-01', shift: 'Tarde', is_available: 1 },
        { date: '2026-09-01', shift: 'Noite', is_available: 0 },
        { date: '2026-09-02', shift: 'Manhã', is_available: 1 },
      ];

      const res = await request(app)
        .put(`/api/v1/technicians/${createdTechId}/availability`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ entries });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('deve consultar disponibilidade do técnico via GET /availability → 200', async () => {
      const res = await request(app)
        .get(`/api/v1/technicians/${createdTechId}/availability?year=2026&month=9`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(4);
      const m1 = res.body.data.find(d => d.date === '2026-09-01' && d.shift === 'Manhã');
      expect(m1).toBeDefined();
      expect(m1.is_available).toBe(1);
    });

    it('deve rejeitar turno inválido no PUT /availability → 400', async () => {
      const res = await request(app)
        .put(`/api/v1/technicians/${createdTechId}/availability`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          entries: [{ date: '2026-09-01', shift: 'Madrugada', is_available: 1 }]
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });

  // 6. Histórico de Agendamentos e Estatísticas (GET /:id/bookings e /:id/stats)
  describe('Estatísticas e Histórico do Técnico', () => {
    it('deve obter estatísticas do técnico → 200', async () => {
      const res = await request(app)
        .get(`/api/v1/technicians/${createdTechId}/stats`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('stats');
      expect(res.body.data.stats).toHaveProperty('total_bookings');
      expect(res.body.data.stats).toHaveProperty('completed_bookings');
      expect(res.body.data.stats).toHaveProperty('total_commissions');
    });

    it('deve obter lista de agendamentos do técnico → 200', async () => {
      const res = await request(app)
        .get(`/api/v1/technicians/${createdTechId}/bookings`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  // 7. Desativação (DELETE /:id)
  describe('DELETE /api/v1/technicians/:id', () => {
    it('deve desativar o técnico com sucesso → 200', async () => {
      const res = await request(app)
        .delete(`/api/v1/technicians/${createdTechId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const check = await request(app)
        .get(`/api/v1/technicians/${createdTechId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(check.body.data.active).toBe(0);
    });
  });
});
