/**
 * CleanXhedule Manager — Testes: Agendamentos (Módulo 3)
 *
 * Cobre:
 *   ✅ POST /bookings — criar agendamento → 201 + preço calculado
 *   ✅ POST /bookings — técnico indisponível (technician_availability) → 400
 *   ✅ POST /bookings — conflito de horário no mesmo técnico → 400
 *   ✅ POST /bookings — cliente inexistente → 404
 *   ✅ POST /bookings — tipo de serviço inativo → 404
 *   ✅ POST /bookings — campos obrigatórios em falta → 400
 *   ✅ POST /bookings — canal inválido → 400
 *   ✅ POST /bookings — log inserido em communication_logs → verificado via DB
 *   ✅ GET  /bookings — lista paginada → 200
 *   ✅ GET  /bookings/:id — detalhe → 200
 *   ✅ GET  /bookings/:id — ID inexistente → 404
 *   ✅ PUT  /bookings/:id/status — atualizar estado → 200
 *   ✅ PUT  /bookings/:id/status — estado inválido → 400
 *   ✅ DELETE /bookings/:id — cancelar → 200
 *   ✅ GET  /technicians/available — filtra por data e turno → 200
 *   ✅ GET  /technicians/available — sem date/shift → 400
 *   ✅ Acesso sem token → 401
 *   ✅ Técnico não pode criar agendamento → 403
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

      // Override prepare to attach sql source for named-param mapping
      const origPrepare = WasmDatabase.prototype.prepare;
      WasmDatabase.prototype.prepare = function (sql) {
        const stmt = origPrepare.call(this, sql);
        stmt.source = sql;
        return stmt;
      };

      // Polyfill: accept positional spread args AND map named @param keys
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

      // Polyfill db.pragma
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

      // Polyfill db.transaction
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
  const schema     = fs.readFileSync(schemaPath, 'utf8');

  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(schema);

  const bcrypt = require('bcryptjs');
  const now    = new Date().toISOString();
  const hash   = bcrypt.hashSync('Admin@1234', 12);

  // ── Seed: utilizadores ──────────────────────────────────────────────────────
  const users = [
    { id: 'bk-admin-001',  name: 'Admin',      email: 'admin@bk.ao',   phone: '+244930100001', role: 'Admin' },
    { id: 'bk-assist-002', name: 'Assistente', email: 'assist@bk.ao',  phone: '+244930100002', role: 'Assistente' },
    { id: 'bk-gestor-003', name: 'Gestor',     email: 'gestor@bk.ao',  phone: '+244930100003', role: 'GestorComercial' },
    { id: 'bk-tech-004',   name: 'Tecnico A',  email: 'tec-a@bk.ao',   phone: '+244930100004', role: 'Tecnico' },
    { id: 'bk-tech-005',   name: 'Tecnico B',  email: 'tec-b@bk.ao',   phone: '+244930100005', role: 'Tecnico' },
  ];
  const stmtUser = db.prepare(
    `INSERT INTO users (id, name, email, phone, password_hash, role, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
  );
  users.forEach((u) => stmtUser.run(u.id, u.name, u.email, u.phone, hash, u.role, now, now));

  // ── Seed: cliente ───────────────────────────────────────────────────────────
  db.prepare(
    `INSERT INTO clients (id, name, phone, email, address, type, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('bk-client-001', 'Maria da Conceição', '+244923456789', 'maria@bk.ao',
        'Rua da Samba, Luanda', 'Particular', 'bk-admin-001', now, now);

  // ── Seed: tipo de serviço ───────────────────────────────────────────────────
  db.prepare(
    `INSERT INTO service_types (id, name, base_price, price_medium_multiplier, price_large_multiplier, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('svc-sofa-001', 'Higienização de Sofá', 15000, 1.5, 2.0, 1, now, now);

  // Tipo inativo para teste de rejeição
  db.prepare(
    `INSERT INTO service_types (id, name, base_price, price_medium_multiplier, price_large_multiplier, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('svc-inactive-999', 'Serviço Inativo', 5000, 1.0, 1.0, 0, now, now);

  // ── Seed: disponibilidade dos técnicos ──────────────────────────────────────
  const avail = db.prepare(
    `INSERT INTO technician_availability (id, technician_id, date, shift, is_available) VALUES (?, ?, ?, ?, ?)`
  );
  // Tecnico A: disponível manhã de 2026-08-01
  avail.run('av-001', 'bk-tech-004', '2026-08-01', 'Manhã', 1);
  // Tecnico A: indisponível tarde de 2026-08-01
  avail.run('av-002', 'bk-tech-004', '2026-08-01', 'Tarde', 0);
  // Tecnico B: disponível manhã e tarde de 2026-08-01
  avail.run('av-003', 'bk-tech-005', '2026-08-01', 'Manhã', 1);
  avail.run('av-004', 'bk-tech-005', '2026-08-01', 'Tarde', 1);
  avail.run('av-005', 'bk-tech-005', '2026-08-02', 'Manhã', 1);
  avail.run('av-006', 'bk-tech-005', '2026-08-03', 'Manhã', 1);
  avail.run('av-007', 'bk-tech-005', '2026-08-04', 'Manhã', 1);
  avail.run('av-008', 'bk-tech-005', '2026-08-05', 'Manhã', 1);

  return { getDb: () => db, closeDb: () => {} };
});

const { createApp } = require('../src/app');
const app = createApp();

// ── Helper: login ─────────────────────────────────────────────────────────────
async function loginAs(email, password = 'Admin@1234') {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password });
  return res.body.data?.accessToken;
}

// Dados de agendamento base
const BASE_BOOKING = {
  client_id:       'bk-client-001',
  service_type_id: 'svc-sofa-001',
  item_size:       'Médio',
  scheduled_date:  '2026-08-01',
  scheduled_time:  '09:00',
  technician_id:   'bk-tech-004',
  origin_channel:  'WhatsApp',
  address:         'Rua da Samba, Luanda',
  travel_fee:      2000,
  discount:        0,
};

// ─────────────────────────────────────────────────────────────────────────────
// PROTEÇÃO DE ROTAS
// ─────────────────────────────────────────────────────────────────────────────
describe('Agendamentos — Proteção de rotas', () => {
  it('Sem token → 401', async () => {
    const res = await request(app).post('/api/v1/bookings').send(BASE_BOOKING);
    expect(res.status).toBe(401);
  });

  it('Técnico não pode criar agendamento → 403', async () => {
    const token = await loginAs('tec-a@bk.ao');
    const res = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send(BASE_BOOKING);
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CRIAÇÃO DE AGENDAMENTO — POST /bookings
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/v1/bookings — Criar agendamento', () => {
  let token;

  beforeAll(async () => {
    token = await loginAs('assist@bk.ao');
  });

  it('deve criar agendamento e calcular valor_final correctamente → 201', async () => {
    const res = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send(BASE_BOOKING);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    const data = res.body.data;
    // Preço: 15000 * 1.5 (Médio) + 2000 (viagem) - 0 (desconto) = 24500
    expect(data.final_amount).toBe(24500);
    expect(data.base_service_price).toBe(15000);
    expect(data.status).toBe('Pendente');
    expect(data.origin_channel).toBe('WhatsApp');
    expect(data.id).toBeDefined();
  });

  it('deve calcular valor_final com desconto → 201', async () => {
    const res = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({
        ...BASE_BOOKING,
        scheduled_date:  '2026-08-02',  // data diferente para não alterar o dia 2026-08-01 do técnico B
        scheduled_time:  '10:00',
        item_size:       'Grande',
        travel_fee:      3000,
        discount:        1000,
        technician_id:   'bk-tech-005', // técnico diferente
      });

    expect(res.status).toBe(201);
    // Preço: 15000 * 2.0 (Grande) + 3000 - 1000 = 32000
    expect(res.body.data.final_amount).toBe(32000);
  });

  it('deve inserir log em communication_logs após agendar → verificado via DB', async () => {
    const { getDb } = require('../database/db');
    const db = getDb();

    // Busca o booking criado no primeiro teste
    const booking = db.prepare(
      `SELECT id FROM bookings WHERE client_id = 'bk-client-001' AND scheduled_time = '09:00' LIMIT 1`
    ).get();
    expect(booking).toBeDefined();

    const log = db.prepare(
      `SELECT * FROM communication_logs WHERE booking_id = ?`
    ).get(booking.id);
    expect(log).toBeDefined();
    expect(log.channel).toBe('WhatsApp');
    expect(log.direction).toBe('Inbound');
    expect(log.summary).toMatch(/WhatsApp/);
  });

  it('deve retornar 400 para campos obrigatórios em falta', async () => {
    const res = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({ client_id: 'bk-client-001' }); // maioria dos campos omitidos

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('deve retornar 400 para canal de origem inválido', async () => {
    const res = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...BASE_BOOKING, origin_channel: 'Email' }); // inválido

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('deve retornar 400 para tamanho de item inválido', async () => {
    const res = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...BASE_BOOKING, item_size: 'Gigante' }); // inválido

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('deve retornar 404 para cliente inexistente', async () => {
    const res = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...BASE_BOOKING, client_id: 'id-nao-existe' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('deve retornar 404 para tipo de serviço inativo', async () => {
    const res = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...BASE_BOOKING, service_type_id: 'svc-inactive-999' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('deve retornar 400 quando técnico não está disponível no turno (technician_availability)', async () => {
    // Tecnico A: indisponível na Tarde de 2026-08-01
    const res = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({
        ...BASE_BOOKING,
        scheduled_time: '14:00',  // → turno Tarde
        technician_id:  'bk-tech-004',
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.error).toMatch(/disponível/i);
  });

  it('deve retornar 400 ao agendar o mesmo técnico no mesmo horário exato (conflito)', async () => {
    // Primeira reserva: 09:00 com Tecnico A já foi criada no primeiro teste.
    // Tentativa de duplicar:
    const res = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({
        ...BASE_BOOKING,
        scheduled_time: '09:00',
        technician_id:  'bk-tech-004',
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.error).toMatch(/agendamento/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LISTAGEM E DETALHE — GET /bookings
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/v1/bookings — Listagem e detalhe', () => {
  let token;
  let bookingId;

  beforeAll(async () => {
    token = await loginAs('gestor@bk.ao');

    // Cria um agendamento para consulta
    const res = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${await loginAs('assist@bk.ao')}`)
      .send({
        ...BASE_BOOKING,
        scheduled_date:  '2026-08-05',
        scheduled_time:  '11:00',
        technician_id:   'bk-tech-005',
        origin_channel:  'Telefone',
      });
    bookingId = res.body.data?.id;
  });

  it('deve listar agendamentos com paginação → 200', async () => {
    const res = await request(app)
      .get('/api/v1/bookings?limit=10&offset=0')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('data');
    expect(res.body.data).toHaveProperty('total');
    expect(res.body.data).toHaveProperty('limit');
    expect(Array.isArray(res.body.data.data)).toBe(true);
  });

  it('deve filtrar por canal de origem → 200', async () => {
    const res = await request(app)
      .get('/api/v1/bookings?channel=Telefone')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const rows = res.body.data.data;
    expect(rows.every((r) => r.origin_channel === 'Telefone')).toBe(true);
  });

  it('deve retornar detalhe de agendamento existente → 200', async () => {
    expect(bookingId).toBeDefined();
    const res = await request(app)
      .get(`/api/v1/bookings/${bookingId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(bookingId);
  });

  it('deve retornar 404 para ID inexistente', async () => {
    const res = await request(app)
      .get('/api/v1/bookings/id-fantasma')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ATUALIZAÇÃO DE ESTADO — PUT /bookings/:id/status
// ─────────────────────────────────────────────────────────────────────────────
describe('PUT /api/v1/bookings/:id/status — Atualizar estado', () => {
  let adminToken;
  let bookingId;

  beforeAll(async () => {
    adminToken = await loginAs('admin@bk.ao');

    const res = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${await loginAs('assist@bk.ao')}`)
      .send({
        ...BASE_BOOKING,
        scheduled_date: '2026-08-03',
        scheduled_time: '07:00',
        technician_id:  'bk-tech-005',
      });
    bookingId = res.body.data?.id;
  });

  it('deve atualizar estado para Confirmado → 200', async () => {
    expect(bookingId).toBeDefined();
    const res = await request(app)
      .put(`/api/v1/bookings/${bookingId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'Confirmado' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('Confirmado');
  });

  it('deve retornar 400 para estado inválido', async () => {
    const res = await request(app)
      .put(`/api/v1/bookings/${bookingId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'Voando' }); // inválido

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EDITAR AGENDAMENTO PENDENTE — PUT /bookings/:id
// ─────────────────────────────────────────────────────────────────────────────
describe('PUT /api/v1/bookings/:id — Editar agendamento pendente', () => {
  let token;
  let bookingId;

  beforeAll(async () => {
    token = await loginAs('gestor@bk.ao');

    const res = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({
        ...BASE_BOOKING,
        scheduled_date: '2026-08-05',
        scheduled_time: '09:00',
        technician_id:  'bk-tech-005',
        item_size: 'Pequeno',
        item_quantity: 1,
      });
    bookingId = res.body.data?.id;
  });

  it('deve permitir editar serviços, período e recalcular preço para agendamento Pendente → 200', async () => {
    expect(bookingId).toBeDefined();

    // Atualiza para tamanho Grande (mult 2.0 = 30000) e adiciona segundo serviço Pequeno (15000)
    const res = await request(app)
      .put(`/api/v1/bookings/${bookingId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        service_type_id: 'svc-sofa-001',
        item_size: 'Grande',
        item_quantity: 1,
        secondary_service_type_id: 'svc-sofa-001',
        secondary_item_size: 'Pequeno',
        secondary_item_quantity: 1,
        scheduled_date: '2026-08-05',
        scheduled_time: '10:00',
        address: 'Nova Morada Editada, Luanda',
        item_notes: 'Observações atualizadas',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.item_size).toBe('Grande');
    expect(res.body.data.secondary_service_type_id).toBe('svc-sofa-001');
    expect(res.body.data.secondary_item_size).toBe('Pequeno');
    expect(res.body.data.scheduled_time).toBe('10:00');
    expect(res.body.data.address).toBe('Nova Morada Editada, Luanda');
    // Preço: Sofá Grande (15000 * 2.0 = 30000) + Sofá Pequeno (15000 * 1.0 = 15000) + Taxa deslocação (2000) = 47000
    expect(res.body.data.final_amount).toBe(47000);
  });

  it('não deve permitir editar agendamento que já não está Pendente → 400', async () => {
    // Confirmar o agendamento
    await request(app)
      .put(`/api/v1/bookings/${bookingId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'Confirmado' });

    // Tentar editar
    const res = await request(app)
      .put(`/api/v1/bookings/${bookingId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        scheduled_time: '11:00',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Pendente/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CANCELAR — DELETE /bookings/:id
// ─────────────────────────────────────────────────────────────────────────────
describe('DELETE /api/v1/bookings/:id — Cancelar agendamento', () => {
  let token;
  let bookingId;

  beforeAll(async () => {
    token = await loginAs('assist@bk.ao');

    const res = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({
        ...BASE_BOOKING,
        scheduled_date:  '2026-08-04',
        scheduled_time:  '08:30',
        technician_id:   'bk-tech-005',
        origin_channel:  'Telefone',
      });
    bookingId = res.body.data?.id;
  });

  it('deve cancelar agendamento → 200 + mensagem', async () => {
    expect(bookingId).toBeDefined();
    const res = await request(app)
      .delete(`/api/v1/bookings/${bookingId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/cancelado/i);
  });

  it('não deve permitir cancelar um agendamento já cancelado → 400', async () => {
    const res = await request(app)
      .delete(`/api/v1/bookings/${bookingId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TÉCNICOS DISPONÍVEIS — GET /technicians/available
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/v1/technicians/available — Técnicos disponíveis', () => {
  let token;

  beforeAll(async () => {
    token = await loginAs('assist@bk.ao');
  });

  it('deve retornar técnicos disponíveis para data e turno → 200', async () => {
    const res = await request(app)
      .get('/api/v1/technicians/available?date=2026-08-01&shift=Tarde')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    // Apenas Tecnico B está disponível na Tarde (Tecnico A → indisponível)
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    const ids = res.body.data.map((t) => t.id);
    expect(ids).not.toContain('bk-tech-004');
    expect(ids).toContain('bk-tech-005');
  });

  it('deve excluir técnicos com agendamento ativo no mesmo turno → 200', async () => {
    // Tecnico A tem um agendamento às 09:00 (Manhã) em 2026-08-01
    // Então na manhã, Tecnico A deve ser excluído dos disponíveis
    const res = await request(app)
      .get('/api/v1/technicians/available?date=2026-08-01&shift=Manhã')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const ids = res.body.data.map((t) => t.id);
    // Tecnico A tem booking na manhã → excluído
    expect(ids).not.toContain('bk-tech-004');
    // Tecnico B disponível e sem conflito → incluído
    expect(ids).toContain('bk-tech-005');
  });

  it('deve retornar 400 sem parâmetros date e shift', async () => {
    const res = await request(app)
      .get('/api/v1/technicians/available')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('deve retornar 400 para turno inválido', async () => {
    const res = await request(app)
      .get('/api/v1/technicians/available?date=2026-08-01&shift=Almoço')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});
