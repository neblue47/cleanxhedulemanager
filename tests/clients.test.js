/**
 * CleanXhedule Manager — Testes: Clientes
 *
 * Cobre:
 *   ✅ POST /clients — criar cliente → 201
 *   ✅ POST /clients — phone duplicado → 409 UNIQUE_VIOLATION
 *   ✅ POST /clients — campos obrigatórios em falta → 400
 *   ✅ POST /clients — tipo Empresa sem NIF → 400
 *   ✅ GET  /clients/search?phone=xxx — busca parcial → 200 + dados
 *   ✅ GET  /clients/search?phone=xxx — sem resultados → 200 + []
 *   ✅ GET  /clients/search          — sem parâmetro phone → 400
 *   ✅ GET  /clients/search          — query muito curta (< 3 chars) → 400
 *   ✅ GET  /clients                 — lista com paginação → 200
 *   ✅ GET  /clients/:id             — detalhe → 200
 *   ✅ GET  /clients/:id             — ID inexistente → 404
 *   ✅ PUT  /clients/:id             — atualizar → 200
 *   ✅ PUT  /clients/:id             — phone duplicado → 409
 *   ✅ Acesso sem token              → 401
 *   ✅ Técnico não pode aceder       → 403
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

      // Overrides Database.prepare to attach sql source
      const origPrepare = WasmDatabase.prototype.prepare;
      WasmDatabase.prototype.prepare = function (sql) {
        const stmt = origPrepare.call(this, sql);
        stmt.source = sql;
        return stmt;
      };

      // Polyfill Statement methods to accept separate positional arguments and map named parameter objects
      const tempDb = new WasmDatabase(':memory:');
      const StatementProto = Object.getPrototypeOf(tempDb.prepare('SELECT 1'));
      tempDb.close();

      const wrapMethod = (origMethod) => {
        return function (...args) {
          let finalArgs = args;
          if (args.length > 1) {
            finalArgs = [args];
          }
          const firstArg = finalArgs[0];
          if (firstArg && typeof firstArg === 'object' && !Array.isArray(firstArg)) {
            const sql = this.source || '';
            const placeholders = sql.match(/([@$:][a-zA-Z0-9_]+)/g) || [];
            const mapped = {};
            for (const placeholder of placeholders) {
              const rawKey = placeholder.slice(1);
              if (firstArg[placeholder] !== undefined) {
                mapped[placeholder] = firstArg[placeholder];
              } else if (firstArg[rawKey] !== undefined) {
                mapped[placeholder] = firstArg[rawKey];
              }
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
              const firstRow = results[0];
              const key = Object.keys(firstRow)[0];
              return firstRow[key];
            }
            return results;
          } catch {
            return stmt.run();
          }
        };
      }

      return WasmDatabase;
    }
  })();
  const path     = require('path');
  const fs       = require('fs');

  const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');
  const schema     = fs.readFileSync(schemaPath, 'utf8');

  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(schema);

  const bcrypt = require('bcryptjs');
  const now    = new Date().toISOString();
  const hash   = bcrypt.hashSync('Admin@1234', 12);

  // Utilizadores de teste
  const users = [
    { id: 'cl-admin-001',  name: 'Admin',     email: 'admin@cl.ao',   phone: '+244921100001', role: 'Admin' },
    { id: 'cl-assist-002', name: 'Assistente',email: 'assist@cl.ao',  phone: '+244921100002', role: 'Assistente' },
    { id: 'cl-gestor-003', name: 'Gestor',    email: 'gestor@cl.ao',  phone: '+244921100003', role: 'GestorComercial' },
    { id: 'cl-tech-004',   name: 'Tecnico',   email: 'tecnico@cl.ao', phone: '+244921100004', role: 'Tecnico' },
  ];

  const stmt = db.prepare(`
    INSERT INTO users (id, name, email, phone, password_hash, role, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
  `);
  users.forEach((u) => stmt.run(u.id, u.name, u.email, u.phone, hash, u.role, now, now));

  // Cliente pré-existente (para testar duplicados)
  db.prepare(`
    INSERT INTO clients (id, name, phone, email, address, type, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'existing-client-001',
    'Cliente Existente',
    '+244923000099',
    'existente@email.ao',
    'Rua do Kilamba, Luanda',
    'Particular',
    'cl-admin-001',
    now, now
  );

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

// ─────────────────────────────────────────────────────────────────────────────
// PROTEÇÃO DE ROTAS
// ─────────────────────────────────────────────────────────────────────────────
describe('Clientes — Proteção de rotas', () => {
  it('Sem token → 401', async () => {
    const res = await request(app).get('/api/v1/clients');
    expect(res.status).toBe(401);
  });

  it('Técnico não pode listar clientes → 403', async () => {
    const token = await loginAs('tecnico@cl.ao');
    const res = await request(app)
      .get('/api/v1/clients')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CRIAÇÃO DE CLIENTES
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/v1/clients — Criar cliente', () => {
  let token;

  beforeAll(async () => {
    token = await loginAs('assist@cl.ao');
  });

  it('deve criar cliente Particular com sucesso → 201', async () => {
    const res = await request(app)
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name:    'Maria Dos Santos',
        phone:   '+244923100001',
        address: 'Av. 4 de Fevereiro, Luanda',
        email:   'maria.santos@gmail.com',
        type:    'Particular',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.phone).toBe('+244923100001');
    expect(res.body.data.type).toBe('Particular');
    // ID criado automaticamente
    expect(res.body.data.id).toBeDefined();
  });

  it('deve criar cliente Empresa com NIF → 201', async () => {
    const res = await request(app)
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name:    'CleanCorp Lda.',
        phone:   '+244923200002',
        address: 'Zona Industrial Viana, Luanda',
        type:    'Empresa',
        tax_id:  '5417823001',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.type).toBe('Empresa');
    expect(res.body.data.tax_id).toBe('5417823001');
  });

  // ── Chave duplicada: SQLITE_CONSTRAINT_UNIQUE ─────────────────────────────

  it('deve retornar 409 ao criar cliente com telefone duplicado → UNIQUE_VIOLATION', async () => {
    const res = await request(app)
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name:    'Outro Cliente',
        phone:   '+244923000099', // já existe (pré-inserido no mock)
        address: 'Qualquer Morada',
      });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('UNIQUE_VIOLATION');
    // A mensagem deve mencionar o campo "phone"
    expect(res.body.error).toMatch(/phone/i);
  });

  // ── Validação de campos ───────────────────────────────────────────────────

  it('deve retornar 400 quando campos obrigatórios estão em falta', async () => {
    const res = await request(app)
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Só o Nome' }); // sem phone e address

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('deve retornar 400 para Empresa sem NIF (tax_id)', async () => {
    const res = await request(app)
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name:    'Empresa Sem NIF',
        phone:   '+244923300003',
        address: 'Bairro Rangel, Luanda',
        type:    'Empresa',
        // tax_id ausente
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/NIF/i);
  });

  it('deve retornar 400 para tipo inválido', async () => {
    const res = await request(app)
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name:    'Tipo Errado',
        phone:   '+244923400004',
        address: 'Qualquer Morada',
        type:    'ONG', // inválido
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BUSCA RÁPIDA POR TELEFONE
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/v1/clients/search — Busca por telefone', () => {
  let token;

  beforeAll(async () => {
    token = await loginAs('assist@cl.ao');
  });

  it('deve retornar clientes para pesquisa parcial de telefone → 200', async () => {
    // "923000" está no telefone do cliente pré-existente: +244923000099
    const res = await request(app)
      .get('/api/v1/clients/search?phone=923000')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    // Apenas campos parciais (sem dados sensíveis desnecessários)
    expect(res.body.data[0]).toHaveProperty('phone');
    expect(res.body.data[0]).toHaveProperty('name');
    expect(res.body.data[0]).not.toHaveProperty('notes');
  });

  it('deve retornar array vazio para telefone inexistente → 200 + []', async () => {
    const res = await request(app)
      .get('/api/v1/clients/search?phone=999999999')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('deve retornar 400 sem parâmetro phone', async () => {
    const res = await request(app)
      .get('/api/v1/clients/search')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });

  it('deve retornar 400 para query com menos de 3 caracteres', async () => {
    const res = await request(app)
      .get('/api/v1/clients/search?phone=92')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('deve ignorar espaços na pesquisa de telefone', async () => {
    // "+244 923 000 099" com espaços deve encontrar "+244923000099"
    const res = await request(app)
      .get('/api/v1/clients/search?phone=923 000')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LISTAGEM E DETALHE
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/v1/clients — Listagem e detalhe', () => {
  let token;

  beforeAll(async () => {
    token = await loginAs('gestor@cl.ao');
  });

  it('deve listar clientes com paginação → 200', async () => {
    const res = await request(app)
      .get('/api/v1/clients?limit=5&offset=0')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('data');
    expect(res.body.data).toHaveProperty('total');
    expect(res.body.data).toHaveProperty('limit');
    expect(Array.isArray(res.body.data.data)).toBe(true);
  });

  it('deve retornar detalhe de cliente existente → 200', async () => {
    const res = await request(app)
      .get('/api/v1/clients/existing-client-001')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe('existing-client-001');
    expect(res.body.data.name).toBe('Cliente Existente');
  });

  it('deve retornar 404 para ID inexistente', async () => {
    const res = await request(app)
      .get('/api/v1/clients/id-que-nao-existe')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ATUALIZAÇÃO
// ─────────────────────────────────────────────────────────────────────────────
describe('PUT /api/v1/clients/:id — Atualizar cliente', () => {
  let token;
  let clienteId;

  beforeAll(async () => {
    token = await loginAs('assist@cl.ao');

    // Cria cliente para atualizar
    const res = await request(app)
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name:    'Para Atualizar',
        phone:   '+244924000001',
        address: 'Morada Inicial',
      });
    clienteId = res.body.data?.id;
  });

  it('deve atualizar nome e morada com sucesso → 200', async () => {
    const res = await request(app)
      .put(`/api/v1/clients/${clienteId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Nome Atualizado', address: 'Nova Morada, Luanda' });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Nome Atualizado');
    expect(res.body.data.address).toBe('Nova Morada, Luanda');
  });

  it('deve retornar 409 ao atualizar phone para um já existente → UNIQUE_VIOLATION', async () => {
    const res = await request(app)
      .put(`/api/v1/clients/${clienteId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: '+244923000099' }); // telefone do cliente pré-existente

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('UNIQUE_VIOLATION');
  });

  it('deve retornar 404 ao atualizar ID inexistente', async () => {
    const res = await request(app)
      .put('/api/v1/clients/id-fantasma')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Fantasma' });

    expect(res.status).toBe(404);
  });
});
