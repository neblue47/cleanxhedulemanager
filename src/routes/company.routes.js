/**
 * CleanXhedule Manager — Rotas: Perfil da Empresa
 * Base: /api/v1/company
 *
 * GET  /company  — Retorna os dados da empresa (público)
 * PUT  /company  — Actualiza os dados da empresa (apenas Admin)
 */
'use strict';

const express = require('express');
const router = express.Router();

const { verifyToken, requireRoles } = require('../middleware/auth');
const { getDb } = require('../../database/db');

/* ─────────────────────────────────────────────────────────────────────────────
   GET /company — Obter dados da empresa (público)
───────────────────────────────────────────────────────────────────────────── */
router.get('/', (req, res, next) => {
  try {
    const db = getDb();
    const profile = db.prepare('SELECT * FROM company_profile WHERE id = 1').get();
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Perfil da empresa não encontrado.' });
    }
    return res.status(200).json({ success: true, data: profile });
  } catch (err) {
    next(err);
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   PUT /company — Actualizar dados da empresa (Admin)
───────────────────────────────────────────────────────────────────────────── */
router.put('/', verifyToken, requireRoles('Admin'), (req, res, next) => {
  try {
    const { name, nif, location, slogan, bank_name, bank_account, iban } = req.body;
    if (!name || name.trim() === '') {
      return res.status(400).json({ success: false, message: 'O nome da empresa é obrigatório.' });
    }

    const db = getDb();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT OR IGNORE INTO company_profile (id, name, nif, location, slogan, bank_name, bank_account, iban, updated_at)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      name.trim(),
      nif || null,
      location || null,
      slogan || null,
      bank_name || null,
      bank_account || null,
      iban || null,
      now
    );

    db.prepare(`
      UPDATE company_profile
      SET name = ?, nif = ?, location = ?, slogan = ?, bank_name = ?, bank_account = ?, iban = ?, updated_at = ?
      WHERE id = 1
    `).run(
      name.trim(),
      nif ? nif.trim() : null,
      location ? location.trim() : null,
      slogan ? slogan.trim() : null,
      bank_name ? bank_name.trim() : null,
      bank_account ? bank_account.trim() : null,
      iban ? iban.trim() : null,
      now
    );

    const updated = db.prepare('SELECT * FROM company_profile WHERE id = 1').get();
    return res.status(200).json({ success: true, message: 'Dados da empresa actualizados com sucesso.', data: updated });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
