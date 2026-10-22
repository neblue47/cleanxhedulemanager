/**
 * CleanXhedule Manager — Setup de Testes Jest
 *
 * Define NODE_ENV=test antes de qualquer import.
 * O config/index.js usa NODE_ENV=test para apontar o DB para :memory:.
 */
'use strict';

process.env.NODE_ENV      = 'test';
process.env.JWT_SECRET    = 'test_jwt_secret_cleanxhedule_2024';
process.env.JWT_REFRESH_SECRET = 'test_refresh_secret_cleanxhedule_2024';
process.env.JWT_EXPIRES_IN     = '1h';
