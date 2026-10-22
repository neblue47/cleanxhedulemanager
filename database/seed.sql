-- =============================================================================
-- CleanXhedule Manager - Seed de Dados Iniciais
-- Compatível com SQLite
-- =============================================================================
-- Executar APÓS o schema.sql
-- PRAGMA foreign_keys deve estar ON antes de correr este seed
-- =============================================================================

PRAGMA foreign_keys = ON;

-- -----------------------------------------------------------------------------
-- USERS — 4 perfis de utilizador (um de cada role)
-- Passwords: todas definidas como 'changeme123' (hash bcrypt de exemplo)
-- Hash real deve ser gerado na aplicação; este é apenas placeholder para seed.
-- -----------------------------------------------------------------------------
INSERT OR IGNORE INTO users (id, name, email, phone, password_hash, role, active, created_at, updated_at) VALUES
(
    'a1b2c3d4-0001-4000-8000-000000000001',
    'Administrador CleanX',
    'admin@cleanxhedule.ao',
    '+244 923 000 001',
    '$2a$10$gV2.i7uEaL99T/xQYx/Kze8.u00D4FjF3x3x.u00D4FjF3x3x.u0',
    'Admin',
    1,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
),
(
    'bk-admin-001',
    'Admin Teste',
    'admin@bk.ao',
    '+244930100001',
    '$2a$10$x7qR1hM91zJ/4m1xZ2vY3.1Q8wX9yZ0a1b2c3d4e5f6g7h8i9j0k1',
    'Admin',
    1,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
),
(
    'bk-assist-002',
    'Assistente Teste',
    'assist@bk.ao',
    '+244930100002',
    '$2a$10$x7qR1hM91zJ/4m1xZ2vY3.1Q8wX9yZ0a1b2c3d4e5f6g7h8i9j0k1',
    'Assistente',
    1,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
),
(
    'bk-gestor-003',
    'Gestor Teste',
    'gestor@bk.ao',
    '+244930100003',
    '$2a$10$x7qR1hM91zJ/4m1xZ2vY3.1Q8wX9yZ0a1b2c3d4e5f6g7h8i9j0k1',
    'GestorComercial',
    1,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
),
(
    'bk-tech-004',
    'Tecnico A',
    'tec-a@bk.ao',
    '+244930100004',
    '$2a$10$x7qR1hM91zJ/4m1xZ2vY3.1Q8wX9yZ0a1b2c3d4e5f6g7h8i9j0k1',
    'Tecnico',
    1,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
),
(
    'bk-tech-005',
    'Tecnico B',
    'tec-b@bk.ao',
    '+244930100005',
    '$2a$10$x7qR1hM91zJ/4m1xZ2vY3.1Q8wX9yZ0a1b2c3d4e5f6g7h8i9j0k1',
    'Tecnico',
    1,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

-- -----------------------------------------------------------------------------
-- SERVICE_TYPES — 3 serviços do catálogo com preços em Kwanza (AOA)
-- Multiplicadores: Médio = 1.50x | Grande = 2.00x
-- -----------------------------------------------------------------------------

-- 1. Higienização de Sofá
--    Pequeno (2 lug.) → 15.000 AOA
--    Médio   (3 lug.) → 22.500 AOA  (x1.5)
--    Grande  (4+ lug.)→ 30.000 AOA  (x2.0)
INSERT OR IGNORE INTO service_types (
    id, name, description,
    base_price, price_medium_multiplier, price_large_multiplier,
    duration_minutes, checklist_template_id, is_active
) VALUES (
    'b1b2c3d4-0001-4000-8000-100000000001',
    'Higienização de Sofá',
    'Limpeza profunda de sofás em tecido, couro ou microfibra. Inclui remoção de manchas, odores e ácaros.',
    15000.00, 1.50, 2.00,
    90, NULL, 1
);

-- 2. Higienização de Colchão
--    Pequeno (solteiro)  → 12.000 AOA
--    Médio   (casal)     → 18.000 AOA  (x1.5)
--    Grande  (king/queen)→ 24.000 AOA  (x2.0)
INSERT OR IGNORE INTO service_types (
    id, name, description,
    base_price, price_medium_multiplier, price_large_multiplier,
    duration_minutes, checklist_template_id, is_active
) VALUES (
    'b1b2c3d4-0002-4000-8000-100000000002',
    'Higienização de Colchão',
    'Limpeza e sanitização de colchões com extração a seco ou vapor. Elimina ácaros, bactérias e fungos.',
    12000.00, 1.50, 2.00,
    60, NULL, 1
);

-- 3. Higienização de Cadeira/Poltrona
--    Pequena (cadeira escritório) → 5.000 AOA
--    Média   (poltrona simples)   → 7.500 AOA  (x1.5)
--    Grande  (poltrona king)      → 10.000 AOA (x2.0)
INSERT OR IGNORE INTO service_types (
    id, name, description,
    base_price, price_medium_multiplier, price_large_multiplier,
    duration_minutes, checklist_template_id, is_active
) VALUES (
    'b1b2c3d4-0003-4000-8000-100000000003',
    'Higienização de Cadeira/Poltrona',
    'Limpeza e desinfecção de cadeiras de escritório, poltronas e cadeiras de jantar em tecido ou couro.',
    5000.00, 1.50, 2.00,
    45, NULL, 1
);

-- =============================================================================
-- FIM DO SEED
-- =============================================================================
