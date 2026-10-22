/**
 * CleanXhedule Manager — Testes: Autenticação e RBAC
 *
 * Cobre:
 *   ✅ POST /auth/login — credenciais válidas
 *   ✅ POST /auth/login — email inexistente
 *   ✅ POST /auth/login — password errada
 *   ✅ POST /auth/login — conta desativada
 *   ✅ POST /auth/login — campos em falta
 *   ✅ Acesso sem token → 401
 *   ✅ Token inválido → 401
 *   ✅ Acesso com role insuficiente → 403
 *   ✅ POST /users — criação por Admin → 201
 *   ✅ POST /users — criação por não-Admin → 403
 *   ✅ POST /users — email duplicado → 409 UNIQUE_VIOLATION
 *   ✅ POST /auth/refresh — token válido → 200
 *   ✅ POST /auth/refresh — token inválido → 401
 */
'use strict';

const request  = require('supertest');
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

    return WasmDatabase;
  }
})();
const path     = require('path');
const fs       = require('fs');

// ── Configuração do DB em Memória ─────────────────────────────────────────────

let db;
let app;

// Substitui o módulo database/db pelo DB em memória ANTES de importar a app
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

      return WasmDatabase;
    }
  })();
  const path     = require('path');
  const fs       = require('fs');

  const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');
  const schema     = fs.readFileSync(schemaPath, 'utf8');

  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.exec(schema);

  // Insere o utilizador Admin de teste
  const bcrypt = require('bcryptjs');
  const { v4: uuidv4 } = require('uuid');

  const adminId   = 'test-admin-uuid-0001';
  const gestorId  = 'test-gestor-uuid-0002';
  const techId    = 'test-tech-uuid-0003';
  const assistId  = 'test-assist-uuid-0004';
  const now       = new Date().toISOString();
  const hash      = bcrypt.hashSync('Admin@1234', 12);

  db.prepare(`
    INSERT INTO users (id, name, email, phone, password_hash, role, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(adminId,  'Admin Teste',   'admin@test.ao',   '+244911000001', hash, 'Admin',           now, now);
  db.prepare(`
    INSERT INTO users (id, name, email, phone, password_hash, role, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(gestorId, 'Gestor Teste',  'gestor@test.ao',  '+244911000002', hash, 'GestorComercial', now, now);
  db.prepare(`
    INSERT INTO users (id, name, email, phone, password_hash, role, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(techId,   'Tecnico Teste', 'tecnico@test.ao', '+244911000003', hash, 'Tecnico',         now, now);
  db.prepare(`
    INSERT INTO users (id, name, email, phone, password_hash, role, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(assistId, 'Assist Desativo', 'desativo@test.ao', '+244911000004', hash, 'Assistente',   now, now);

  return {
    getDb:   () => db,
    closeDb: () => {},
    __db:    db,
  };
});

// Importa a app DEPOIS do mock
const { createApp } = require('../src/app');
app = createApp();

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Faz login e retorna o accessToken */
async function loginAs(email, password = 'Admin@1234') {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password });
  return res.body.data?.accessToken;
}

// ═════════════════════════════════════════════════════════════════════════════
// TESTES DE AUTENTICAÇÃO
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/v1/auth/login', () => {
  it('deve retornar 200 e tokens JWT para credenciais válidas', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@test.ao', password: 'Admin@1234' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('accessToken');
    expect(res.body.data).toHaveProperty('refreshToken');
    expect(res.body.data).toHaveProperty('expiresIn');
    expect(res.body.data.user.role).toBe('Admin');
    // password_hash NÃO deve estar na resposta
    expect(res.body.data.user).not.toHaveProperty('password_hash');
  });

  it('deve retornar 401 para email não registado', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'naoexiste@test.ao', password: 'Admin@1234' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('UNAUTHORIZED');
    // Mensagem genérica — não revela se o email existe
    expect(res.body.error).toMatch(/email ou password/i);
  });

  it('deve retornar 401 para password errada', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@test.ao', password: 'passwordErrada' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('deve retornar 401 para conta desativada', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'desativo@test.ao', password: 'Admin@1234' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/desativada/i);
  });

  it('deve retornar 400 quando campos obrigatórios estão em falta', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@test.ao' }); // sem password

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('deve retornar 400 quando o body está vazio', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({});

    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/v1/auth/refresh', () => {
  it('deve emitir novo accessToken com refreshToken válido', async () => {
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@test.ao', password: 'Admin@1234' });

    const { refreshToken } = loginRes.body.data;

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('accessToken');
  });

  it('deve retornar 401 para refreshToken inválido', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'token.invalido.aqui' });

    expect(res.status).toBe(401);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// TESTES DE PROTEÇÃO DE ROTAS (JWT + RBAC)
// ═════════════════════════════════════════════════════════════════════════════

describe('Proteção de rotas — autenticação', () => {
  it('deve retornar 401 em rota protegida sem token', async () => {
    const res = await request(app).get('/api/v1/users');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('deve retornar 401 com token malformado', async () => {
    const res = await request(app)
      .get('/api/v1/users')
      .set('Authorization', 'Bearer token.invalido.aqui');
    expect(res.status).toBe(401);
  });

  it('deve retornar 401 com Authorization sem Bearer prefix', async () => {
    const token = await loginAs('admin@test.ao');
    const res = await request(app)
      .get('/api/v1/users')
      .set('Authorization', token); // sem "Bearer "
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Proteção de rotas — RBAC (controlo de perfis)', () => {
  it('Técnico não deve conseguir listar todos os utilizadores → 403', async () => {
    const token = await loginAs('tecnico@test.ao');
    const res = await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('Técnico não deve conseguir criar utilizadores → 403', async () => {
    const token = await loginAs('tecnico@test.ao');
    const res = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Novo', email: 'novo@test.ao', password: 'Senha@123', role: 'Assistente' });
    expect(res.status).toBe(403);
  });

  it('Gestor deve conseguir listar utilizadores → 200', async () => {
    const token = await loginAs('gestor@test.ao');
    const res = await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// TESTES DE CRIAÇÃO DE UTILIZADORES (Admin only)
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/v1/users — Gestão de utilizadores', () => {
  let adminToken;

  beforeAll(async () => {
    adminToken = await loginAs('admin@test.ao');
  });

  it('Admin deve criar utilizador com sucesso → 201', async () => {
    const res = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name:     'Novo Assistente',
        email:    'novassistente@test.ao',
        password: 'Senha@1234',
        role:     'Assistente',
        phone:    '+244922000100',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.role).toBe('Assistente');
    expect(res.body.data).not.toHaveProperty('password_hash');
  });

  it('Deve retornar 409 ao criar utilizador com email duplicado → UNIQUE_VIOLATION', async () => {
    // Tenta criar com o mesmo email do Admin de teste
    const res = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name:     'Admin Duplicado',
        email:    'admin@test.ao', // email já existe
        password: 'Senha@1234',
        role:     'Assistente',
      });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('UNIQUE_VIOLATION');
    expect(res.body.error).toMatch(/email/i);
  });

  it('Deve retornar 400 para role inválido', async () => {
    const res = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name:     'Role Errado',
        email:    'roleerrado@test.ao',
        password: 'Senha@1234',
        role:     'SuperAdmin', // inválido
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('Deve retornar 400 para password curta (< 8 chars)', async () => {
    const res = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name:     'Curto',
        email:    'curto@test.ao',
        password: '123',
        role:     'Tecnico',
      });

    expect(res.status).toBe(400);
  });

  it('Admin não deve poder desativar a si próprio → 403', async () => {
    const res = await request(app)
      .delete('/api/v1/users/test-admin-uuid-0001')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(403);
  });
});
