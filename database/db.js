/**
 * CleanXhedule Manager — Inicialização da Conexão SQLite
 * -------------------------------------------------------
 * Driver: better-sqlite3 (síncrono, recomendado para Node.js)
 *
 * Instalação:
 *   npm install better-sqlite3
 *   npm install --save-dev @types/better-sqlite3   (se usar TypeScript)
 *
 * Alternativa com driver assíncrono (sqlite3):
 *   npm install sqlite3 sqlite
 *   Ver comentários no final do ficheiro.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
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

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------
const DB_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = process.env.NODE_ENV === 'test' ? ':memory:' : path.join(DB_DIR, 'cleanxhedule.db');
const lockFilePath = path.join(__dirname, 'clean schedule.db.lock');

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');
const SEED_PATH = path.join(__dirname, 'seed.sql');

// Garante que o diretório de dados existe
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

// ---------------------------------------------------------------------------
// Abre a conexão e ativa PRAGMAs essenciais
// ---------------------------------------------------------------------------
/**
 * Cria e configura a instância do banco de dados SQLite.
 *
 * PRAGMAs aplicados:
 *   foreign_keys = ON  — Ativa validação de chaves estrangeiras (OBRIGATÓRIO)
 *   journal_mode = WAL — Write-Ahead Logging: melhor performance em leituras concorrentes
 *   synchronous  = NORMAL — Balanço entre segurança e velocidade
 *   cache_size   = -32000 — Cache de 32 MB (valor negativo = kibibytes)
 *   temp_store   = MEMORY — Tabelas temporárias em memória
 *
 * @returns {import('better-sqlite3').Database}
 */
function createConnection() {
  let db;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      db = new Database(DB_PATH);

      if (typeof db.pragma === 'function') {
        try { db.pragma('busy_timeout = 5000'); } catch (_) { }
        try { db.pragma('foreign_keys = ON'); } catch (_) { }
        try { db.pragma('journal_mode = WAL'); } catch (_) { }
        try { db.pragma('synchronous = NORMAL'); } catch (_) { }
        try { db.pragma('cache_size = -32000'); } catch (_) { }
        try { db.pragma('temp_store = MEMORY'); } catch (_) { }
      } else {
        try { db.exec('PRAGMA busy_timeout = 5000;'); } catch (_) { }
        try { db.exec('PRAGMA foreign_keys = ON;'); } catch (_) { }
        try { db.exec('PRAGMA journal_mode = WAL;'); } catch (_) { }
        try { db.exec('PRAGMA synchronous = NORMAL;'); } catch (_) { }
      }

      return db;
    } catch (err) {
      if (err.message && err.message.includes('locked') && attempt < 5) {
        const waitTill = Date.now() + 300;
        while (Date.now() < waitTill) { }
        continue;
      }
      throw err;
    }
  }
  return db;
}


/**
 * Garante que os utilizadores de demonstração tenham senhas bcrypt válidas.
 *
 * @param {import('better-sqlite3').Database} db
 */
function seedDemoUsers(db) {
  try {
    const demoUsers = [
      {
        id: 'bk-admin-001',
        name: 'Administrador CleanX',
        email: 'admin@bk.ao',
        phone: '+244930100001',
        password: 'Admin@1234',
        role: 'Admin'
      },
      {
        id: 'a1b2c3d4-0001-4000-8000-000000000001',
        name: 'Administrador Geral',
        email: 'admin@cleanxhedule.ao',
        phone: '+244923000001',
        password: 'Admin@1234',
        role: 'Admin'
      },
      {
        id: 'bk-gestor-003',
        name: 'Gestor Comercial',
        email: 'gestor@bk.ao',
        phone: '+244930100003',
        password: 'Gestor@1234',
        role: 'GestorComercial'
      },
      {
        id: 'bk-atend-002',
        name: 'Assistente Atendimento',
        email: 'atendente@bk.ao',
        phone: '+244930100012',
        password: 'Atendente@1234',
        role: 'Assistente'
      },
      {
        id: 'bk-assist-002',
        name: 'Assistente Teste',
        email: 'assist@bk.ao',
        phone: '+244930100002',
        password: 'Atendente@1234',
        role: 'Assistente'
      },
      {
        id: 'bk-tecnico-001',
        name: 'Técnico Especialista',
        email: 'tecnico@bk.ao',
        phone: '+244930100044',
        password: 'Tecnico@1234',
        role: 'Tecnico'
      },
      {
        id: 'bk-tech-005',
        name: 'Técnico Operacional B',
        email: 'tec-b@bk.ao',
        phone: '+244930100005',
        password: 'Tecnico@1234',
        role: 'Tecnico'
      },
      {
        id: 'bk-tech-004',
        name: 'Técnico Operacional A',
        email: 'tec-a@bk.ao',
        phone: '+244930100004',
        password: 'Tecnico@1234',
        role: 'Tecnico'
      }
    ];

    const now = new Date().toISOString();
    const findByEmail = db.prepare('SELECT id FROM users WHERE email = ?');
    const findById = db.prepare('SELECT id FROM users WHERE id = ?');
    const updateStmt = db.prepare(`
      UPDATE users
      SET password_hash = @password_hash, role = @role, active = 1, updated_at = @now
      WHERE email = @email
    `);
    const insertStmt = db.prepare(`
      INSERT INTO users (id, name, email, phone, password_hash, role, active, created_at, updated_at)
      VALUES (@id, @name, @email, @phone, @password_hash, @role, 1, @now, @now)
    `);

    for (const u of demoUsers) {
      const password_hash = bcrypt.hashSync(u.password, 10);
      const existingByEmail = findByEmail.get(u.email);
      if (existingByEmail) {
        updateStmt.run({ email: u.email, password_hash, role: u.role, now });
      } else {
        const existingById = findById.get(u.id);
        const finalId = existingById
          ? `demo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
          : u.id;
        insertStmt.run({ id: finalId, name: u.name, email: u.email, phone: u.phone, password_hash, role: u.role, now });
      }
    }
    console.log('[DB] Utilizadores demo sincronizados com sucesso.');
  } catch (err) {
    console.warn('[DB] Erro ao sincronizar utilizadores demo:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Inicialização do schema e seed (executa apenas na primeira vez)
// ---------------------------------------------------------------------------
/**
 * Aplica o schema e os dados iniciais (seed) ao banco de dados.
 * Usa `CREATE TABLE IF NOT EXISTS` e `INSERT OR IGNORE` para ser idempotente.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} [options]
 * @param {boolean} [options.runSeed=false] - Executa o seed de dados iniciais
 */
function initializeDatabase(db, { runSeed = false } = {}) {
  let attempts = 0;
  while (attempts < 5) {
    try {
      // Aplica o schema
      if (fs.existsSync(SCHEMA_PATH)) {
        const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
        db.exec(schema);
        // Migration: ensure bank columns exist in company_profile
        const colInfo = db.prepare("PRAGMA table_info('company_profile');").all();
        if (!colInfo.some(col => col.name === 'iban')) {
          db.exec('ALTER TABLE company_profile ADD COLUMN iban TEXT;');
          console.log('[DB] Migration: added missing column "iban" to company_profile');
        }
        if (!colInfo.some(col => col.name === 'bank_name')) {
          db.exec('ALTER TABLE company_profile ADD COLUMN bank_name TEXT;');
          console.log('[DB] Migration: added missing column "bank_name" to company_profile');
        }
        if (!colInfo.some(col => col.name === 'bank_account')) {
          db.exec('ALTER TABLE company_profile ADD COLUMN bank_account TEXT;');
          console.log('[DB] Migration: added missing column "bank_account" to company_profile');
        }
        const companyRow = db.prepare('SELECT * FROM company_profile WHERE id = 1').get();
        if (companyRow && (!companyRow.iban || companyRow.iban.trim() === '')) {
          db.prepare('UPDATE company_profile SET iban = ? WHERE id = 1').run(
            'AO06005100000833202210182\nAO06005100002089848310183'
          );
        }
        // Migration: ensure secondary service columns exist in bookings
        const bookingCols = db.prepare("PRAGMA table_info('bookings');").all();
        if (!bookingCols.some(col => col.name === 'secondary_service_type_id')) {
          db.exec('ALTER TABLE bookings ADD COLUMN secondary_service_type_id TEXT;');
          console.log('[DB] Migration: added missing column "secondary_service_type_id" to bookings');
        }
        if (!bookingCols.some(col => col.name === 'secondary_item_size')) {
          db.exec('ALTER TABLE bookings ADD COLUMN secondary_item_size TEXT;');
          console.log('[DB] Migration: added missing column "secondary_item_size" to bookings');
        }
        if (!bookingCols.some(col => col.name === 'secondary_item_quantity')) {
          db.exec('ALTER TABLE bookings ADD COLUMN secondary_item_quantity INTEGER DEFAULT 1;');
          console.log('[DB] Migration: added missing column "secondary_item_quantity" to bookings');
        }

        console.log('[DB] Schema aplicado com sucesso.');
      } else {
        console.warn('[DB] AVISO: schema.sql não encontrado em', SCHEMA_PATH);
      }

      // Aplica o seed (opcional, geralmente apenas uma vez)
      if (runSeed && fs.existsSync(SEED_PATH)) {
        const seed = fs.readFileSync(SEED_PATH, 'utf8');
        const runSeedTransaction = db.transaction(() => {
          db.exec(seed);
        });
        runSeedTransaction();
        console.log('[DB] Seed de dados aplicado com sucesso.');
      }

      // Sempre sincroniza as credenciais dos utilizadores de demonstração
      seedDemoUsers(db);
      break;
    } catch (err) {
      if (err.message && err.message.includes('locked') && attempts < 20) {
        attempts++;
        const waitTill = Date.now() + 400;
        while (Date.now() < waitTill) { }
        continue;
      }
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton da conexão (reutiliza a mesma instância em toda a aplicação)
// ---------------------------------------------------------------------------
let _db = null;

/**
 * Retorna a instância singleton da conexão com o banco de dados.
 * Inicializa o schema automaticamente na primeira chamada.
 *
 * @param {object} [options]
 * @param {boolean} [options.runSeed=false] - Executa o seed na primeira inicialização
 * @returns {import('better-sqlite3').Database}
 */
function getDb({ runSeed = false } = {}) {
  if (!_db) {

    _db = createConnection();
    initializeDatabase(_db, { runSeed });
    console.log(`[DB] Conexão SQLite estabelecida: ${DB_PATH}`);
  }
  return _db;
}

// Função para limpar o ficheiro de lock de forma segura
function removerLockFile() {
  try {
    if (fs.existsSync(lockFilePath)) {
      fs.unlinkSync(lockFilePath);
      console.log('Ficheiro .lock antigo removido com sucesso.');
    }
  } catch (error) {
    console.error('Erro ao remover o ficheiro .lock:', error.message);
  }
}
/**
 * Fecha a conexão com o banco de dados de forma segura.
 * Útil em testes ou ao encerrar o processo.
 */
function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
    console.log('[DB] Conexão SQLite encerrada.');
  }
}

// Fecha a conexão automaticamente ao encerrar o processo
process.on('exit', closeDb);
process.on('SIGINT', () => { closeDb(); process.exit(0); });
process.on('SIGTERM', () => { closeDb(); process.exit(0); });

// ---------------------------------------------------------------------------
// Exportações
// ---------------------------------------------------------------------------
module.exports = { getDb, closeDb, createConnection, removerLockFile };

// ---------------------------------------------------------------------------
// Uso básico (exemplo):
// ---------------------------------------------------------------------------
// const { getDb } = require('./database/db');
//
// // Inicializa e aplica seed apenas na primeira execução:
// const db = getDb({ runSeed: true });
//
// // Query síncrona (better-sqlite3):
// const users = db.prepare('SELECT id, name, role FROM users WHERE active = 1').all();
// console.log(users);
//
// // Insert com parâmetros nomeados:
// const insert = db.prepare(`
//     INSERT INTO clients (id, name, phone, address, created_by)
//     VALUES (@id, @name, @phone, @address, @created_by)
// `);
// insert.run({
//     id: crypto.randomUUID(),
//     name: 'Maria Cliente',
//     phone: '+244 911 222 333',
//     address: 'Rua da Samba, Luanda',
//     created_by: 'a1b2c3d4-0003-4000-8000-000000000003'
// });

// ===========================================================================
// ALTERNATIVA: driver assíncrono sqlite3 + sqlite (wrapper de Promises)
// ===========================================================================
// npm install sqlite3 sqlite
//
// const sqlite3 = require('sqlite3');
// const { open } = require('sqlite');
//
// async function getDbAsync() {
//     const db = await open({
//         filename: DB_PATH,
//         driver: sqlite3.Database,
//     });
//
//     // OBRIGATÓRIO: ativar suporte a chaves estrangeiras
//     await db.run('PRAGMA foreign_keys = ON');
//     await db.run('PRAGMA journal_mode = WAL');
//     await db.run('PRAGMA synchronous  = NORMAL');
//
//     return db;
// }
// ===========================================================================
