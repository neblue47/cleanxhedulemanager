/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  // Variável de ambiente para os testes usarem banco em memória
  setupFiles: ['<rootDir>/tests/setup.js'],
  // Timeout maior para operações de I/O
  testTimeout: 15000,
  // Limpa mocks entre testes
  clearMocks: true,
  // Relatório legível no terminal
  verbose: true,
};
