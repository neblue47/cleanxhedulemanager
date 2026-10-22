/**
 * CleanXhedule Manager — Ponto de Entrada do Servidor
 *
 * Inicializa a BD (schema + seed opcional) e inicia o servidor HTTP.
 *
 * Flags:
 *   --seed  Executa o seed de dados iniciais (apenas na primeira vez)
 *
 * Exemplos:
 *   node src/server.js              → Inicia sem seed
 *   node src/server.js --seed       → Inicia e aplica seed
 *   npm run dev                     → nodemon sem seed
 *   npm run seed                    → nodemon com seed
 */
'use strict';

require('dotenv').config();

const { createApp } = require('./app');
const { getDb, closeDb, removerLockFile } = require('../database/db');
const config = require('./config');

// Verifica se foi passado o flag --seed
const runSeed = process.argv.includes('--seed');

// ── Inicialização da BD ───────────────────────────────────────────────────────
try {
  //removerLockFile();
  getDb({ runSeed });
} catch (err) {
  console.error('[FATAL] Falha ao inicializar a base de dados:', err.message);
  process.exit(1);
}

// ── Inicialização do Servidor HTTP ────────────────────────────────────────────
const app = createApp();
const server = app.listen(config.port, () => {
  console.log('');
  console.log('╔═════════════════════════════════════════════════════════════════════════════╗');
  console.log('║     CleanXhedule Manager API — v1.0.0                                       ║');
  console.log('╠═════════════════════════════════════════════════════════════════════════════╣');
  console.log(`║  Ambiente : ${config.nodeEnv.padEnd(37)}                                    ║`);
  console.log(`║  Porta    : ${String(config.port).padEnd(37)}                               ║`);
  console.log(`║  URL      : http://localhost:${config.port}/api/v1${''.padEnd(19)}          ║`);
  console.log(`║  Health   : http://localhost:${config.port}/api/v1/health${''.padEnd(13)}   ║`);
  console.log('╚═════════════════════════════════════════════════════════════════════════════╝');
  console.log('');
});

// ── Encerramento Gracioso ─────────────────────────────────────────────────────
function shutdown(signal) {
  console.log(`\n[SERVER] Sinal ${signal} recebido. A encerrar...`);
  try { closeDb(); } catch (_) { }
  server.close(() => {
    console.log('[SERVER] Servidor HTTP encerrado.');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.once('SIGUSR2', () => {
  try { closeDb(); } catch (_) { }
  server.close(() => {
    process.kill(process.pid, 'SIGUSR2');
  });
});

// Captura exceções não tratadas para evitar crash silencioso
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Exceção não tratada:', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Promise rejeitada não tratada:', reason);
  process.exit(1);
});

module.exports = server; // Exportado para testes
