-- =============================================================================
-- CleanXhedule Manager - Sistema de Higienização de Móveis (Angola)
-- Schema SQLite - Versão 1.0
-- =============================================================================
-- Regras aplicadas:
--   * UUID armazenado como TEXT
--   * DECIMAL/MONEY armazenado como REAL
--   * BOOLEAN armazenado como INTEGER (0 = false, 1 = true)
--   * GEOGRAPHY(POINT) dividido em dois campos REAL: latitude / longitude
--   * JSONB armazenado como TEXT (JSON serializado)
--   * ENUMs implementados via restrições CHECK
--   * FOREIGN KEYs explícitas em todas as tabelas dependentes
--   * PRAGMA foreign_keys deve ser ativado na camada de aplicação
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. USERS (Funcionários)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id              TEXT    NOT NULL PRIMARY KEY,               -- UUID v4
    name            TEXT    NOT NULL,                          -- VARCHAR(100)
    email           TEXT    NOT NULL UNIQUE,                   -- VARCHAR(100)
    phone           TEXT,                                      -- VARCHAR(20) opcional
    password_hash   TEXT    NOT NULL,                          -- bcrypt hash
    role            TEXT    NOT NULL                           -- ENUM
                    CHECK (role IN ('Admin', 'GestorComercial', 'Assistente', 'Tecnico')),
    active          INTEGER NOT NULL DEFAULT 1                 -- BOOLEAN
                    CHECK (active IN (0, 1)),
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_users_role   ON users (role);
CREATE INDEX IF NOT EXISTS idx_users_active ON users (active);

-- -----------------------------------------------------------------------------
-- 2. CLIENTS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clients (
    id          TEXT    NOT NULL PRIMARY KEY,                   -- UUID v4
    name        TEXT    NOT NULL,                              -- VARCHAR(100)
    phone       TEXT    NOT NULL UNIQUE,                       -- Identificador principal
    email       TEXT,
    address     TEXT    NOT NULL,
    tax_id      TEXT,                                          -- NIF (empresas)
    type        TEXT    NOT NULL DEFAULT 'Particular'          -- ENUM
                CHECK (type IN ('Particular', 'Empresa')),
    notes       TEXT,                                          -- Observações gerais
    created_by  TEXT    NOT NULL,                              -- FK -> users
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

    FOREIGN KEY (created_by) REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_clients_created_by ON clients (created_by);
CREATE INDEX IF NOT EXISTS idx_clients_type       ON clients (type);

-- -----------------------------------------------------------------------------
-- 3. SERVICE_TYPES (Catálogo de Serviços)
-- Nota: checklist_template_id é uma referência opcional futura; pode ficar NULL
--       se a tabela checklists ainda não existir nesta versão do schema.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_types (
    id                      TEXT    NOT NULL PRIMARY KEY,      -- UUID v4
    name                    TEXT    NOT NULL,                  -- VARCHAR(100)
    description             TEXT,
    base_price              REAL    NOT NULL DEFAULT 0.0,      -- DECIMAL(10,2) em AOA
    price_medium_multiplier REAL    NOT NULL DEFAULT 1.0,      -- ex: 1.5
    price_large_multiplier  REAL    NOT NULL DEFAULT 1.0,      -- ex: 2.0
    duration_minutes        INTEGER NOT NULL DEFAULT 60,
    checklist_template_id   TEXT,                              -- UUID (referência futura)
    is_active               INTEGER NOT NULL DEFAULT 1         -- BOOLEAN
                            CHECK (is_active IN (0, 1)),
    created_at              TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at              TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_service_types_active ON service_types (is_active);

-- -----------------------------------------------------------------------------
-- 4. BOOKINGS (Agendamentos)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bookings (
    id                    TEXT    NOT NULL PRIMARY KEY,         -- UUID v4
    client_id             TEXT    NOT NULL,                    -- FK -> clients
    service_type_id       TEXT    NOT NULL,                    -- FK -> service_types
    item_size             TEXT    NOT NULL                     -- ENUM
                          CHECK (item_size IN ('Pequeno', 'Médio', 'Grande')),
    item_quantity         INTEGER NOT NULL DEFAULT 1,
    item_material         TEXT,                                -- VARCHAR(50)
    item_notes            TEXT,                                -- Observações do cliente
    secondary_service_type_id TEXT,                            -- FK -> service_types (opcional)
    secondary_item_size       TEXT                             -- ENUM opcional
                              CHECK (secondary_item_size IS NULL OR secondary_item_size IN ('Pequeno', 'Médio', 'Grande')),
    secondary_item_quantity   INTEGER DEFAULT 1,
    scheduled_date        TEXT    NOT NULL,                    -- DATE (YYYY-MM-DD)
    scheduled_time        TEXT    NOT NULL,                    -- TIME (HH:MM)
    technician_id         TEXT,                                -- FK -> users (pode ser atribuído depois)
    registered_by         TEXT    NOT NULL,                    -- FK -> users (Assistente/Gestor)
    origin_channel        TEXT    NOT NULL                     -- ENUM
                          CHECK (origin_channel IN ('Telefone', 'WhatsApp')),
    address               TEXT    NOT NULL,
    travel_fee            REAL    NOT NULL DEFAULT 0.0,        -- DECIMAL(10,2) em AOA
    base_service_price    REAL,                                -- DECIMAL(10,2)
    discount              REAL    NOT NULL DEFAULT 0.0,        -- DECIMAL(10,2)
    final_amount          REAL,                                -- DECIMAL(10,2)
    status                TEXT    NOT NULL DEFAULT 'Pendente'  -- ENUM
                          CHECK (status IN ('Pendente', 'Confirmado', 'Rejeitado', 'Em Execução', 'Concluído', 'Cancelado')),
    payment_status        TEXT    NOT NULL DEFAULT 'Pendente'  -- ENUM
                          CHECK (payment_status IN ('Pendente', 'Pago', 'Faturado')),
    payment_method        TEXT    NOT NULL DEFAULT 'Dinheiro'  -- ENUM
                          CHECK (payment_method IN ('Dinheiro', 'Transferencia')),
    payment_confirmed_by  TEXT,                                -- FK -> users
    payment_confirmed_at  TEXT,                                -- TIMESTAMP
    rating                INTEGER                              -- TINYINT 0-5
                          CHECK (rating IS NULL OR (rating >= 0 AND rating <= 5)),
    feedback              TEXT,
    created_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

    FOREIGN KEY (client_id)                 REFERENCES clients      (id) ON UPDATE CASCADE ON DELETE RESTRICT,
    FOREIGN KEY (service_type_id)           REFERENCES service_types(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    FOREIGN KEY (secondary_service_type_id) REFERENCES service_types(id) ON UPDATE CASCADE ON DELETE SET NULL,
    FOREIGN KEY (technician_id)             REFERENCES users        (id) ON UPDATE CASCADE ON DELETE SET NULL,
    FOREIGN KEY (registered_by)             REFERENCES users        (id) ON UPDATE CASCADE ON DELETE RESTRICT,
    FOREIGN KEY (payment_confirmed_by)      REFERENCES users        (id) ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_bookings_client_id       ON bookings (client_id);
CREATE INDEX IF NOT EXISTS idx_bookings_service_type_id ON bookings (service_type_id);
CREATE INDEX IF NOT EXISTS idx_bookings_technician_id   ON bookings (technician_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status          ON bookings (status);
CREATE INDEX IF NOT EXISTS idx_bookings_scheduled_date  ON bookings (scheduled_date);
CREATE INDEX IF NOT EXISTS idx_bookings_payment_status  ON bookings (payment_status);

-- -----------------------------------------------------------------------------
-- 5. TECHNICIAN_AVAILABILITY (Disponibilidade dos Técnicos)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS technician_availability (
    id             TEXT    NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),                -- UUID v4
    technician_id  TEXT    NOT NULL,                           -- FK -> users
    date           TEXT    NOT NULL,                           -- DATE (YYYY-MM-DD)
    shift          TEXT    NOT NULL                            -- ENUM
                   CHECK (shift IN ('Manhã', 'Tarde', 'Noite')),
    is_available   INTEGER NOT NULL DEFAULT 1                  -- BOOLEAN
                   CHECK (is_available IN (0, 1)),

    FOREIGN KEY (technician_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE CASCADE,

    -- Unicidade: um técnico não pode ter dois registos para o mesmo turno/dia
    UNIQUE (technician_id, date, shift)
);

CREATE INDEX IF NOT EXISTS idx_tech_avail_technician_id ON technician_availability (technician_id);
CREATE INDEX IF NOT EXISTS idx_tech_avail_date          ON technician_availability (date);

-- -----------------------------------------------------------------------------
-- 6. WORK_LOGS (Execução do Técnico no Local)
-- GEOGRAPHY(POINT) convertido para latitude + longitude (REAL)
-- JSONB convertido para TEXT (JSON serializado)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS work_logs (
    id                    TEXT    NOT NULL PRIMARY KEY,         -- UUID v4
    booking_id            TEXT    NOT NULL,                    -- FK -> bookings
    technician_id         TEXT    NOT NULL,                    -- FK -> users
    check_in_time         TEXT,                                -- TIMESTAMP
    check_in_latitude     REAL,                                -- GPS (GEOGRAPHY -> REAL)
    check_in_longitude    REAL,                                -- GPS (GEOGRAPHY -> REAL)
    check_out_time        TEXT,                                -- TIMESTAMP
    check_out_latitude    REAL,                                -- GPS (GEOGRAPHY -> REAL)
    check_out_longitude   REAL,                                -- GPS (GEOGRAPHY -> REAL)
    checklist_completed   TEXT,                                -- JSONB -> TEXT (JSON serializado)
    status                TEXT    NOT NULL DEFAULT 'Em Execução' -- ENUM
                          CHECK (status IN ('Em Execução', 'Concluído')),
    created_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

    FOREIGN KEY (booking_id)    REFERENCES bookings (id) ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (technician_id) REFERENCES users    (id) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_work_logs_booking_id    ON work_logs (booking_id);
CREATE INDEX IF NOT EXISTS idx_work_logs_technician_id ON work_logs (technician_id);
CREATE INDEX IF NOT EXISTS idx_work_logs_status        ON work_logs (status);

-- -----------------------------------------------------------------------------
-- 7. PHOTOS (Antes / Depois)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS photos (
    id                TEXT    NOT NULL PRIMARY KEY,             -- UUID v4
    booking_id        TEXT    NOT NULL,                        -- FK -> bookings
    technician_id     TEXT    NOT NULL,                        -- FK -> users
    photo_type        TEXT    NOT NULL                         -- ENUM
                      CHECK (photo_type IN ('Antes', 'Depois')),
    file_url          TEXT    NOT NULL,                        -- URL S3/Spaces
    checklist_task_id TEXT,                                    -- Referência à tarefa
    uploaded_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

    FOREIGN KEY (booking_id)    REFERENCES bookings (id) ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (technician_id) REFERENCES users    (id) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_photos_booking_id    ON photos (booking_id);
CREATE INDEX IF NOT EXISTS idx_photos_technician_id ON photos (technician_id);
CREATE INDEX IF NOT EXISTS idx_photos_photo_type    ON photos (photo_type);

-- -----------------------------------------------------------------------------
-- 8. DOCUMENTS (Orçamentos, Faturas, Recibos, Relatórios)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS documents (
    id                  TEXT    NOT NULL PRIMARY KEY,           -- UUID v4
    booking_id          TEXT    NOT NULL,                      -- FK -> bookings
    type                TEXT    NOT NULL                       -- ENUM
                        CHECK (type IN ('Orcamento', 'Fatura', 'Recibo', 'RelatorioServico')),
    document_number     TEXT    NOT NULL UNIQUE,               -- VARCHAR(50)
    file_url            TEXT    NOT NULL,                      -- VARCHAR(255)
    issued_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    sent_via_whatsapp   INTEGER NOT NULL DEFAULT 0             -- BOOLEAN
                        CHECK (sent_via_whatsapp IN (0, 1)),

    FOREIGN KEY (booking_id) REFERENCES bookings (id) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_documents_booking_id ON documents (booking_id);
CREATE INDEX IF NOT EXISTS idx_documents_type       ON documents (type);

-- -----------------------------------------------------------------------------
-- 9. COMMISSIONS (Comissões por Agendamento)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS commissions (
    id                TEXT    NOT NULL PRIMARY KEY,             -- UUID v4
    booking_id        TEXT    NOT NULL,                        -- FK -> bookings
    user_id           TEXT    NOT NULL,                        -- FK -> users
    role              TEXT    NOT NULL                         -- ENUM
                      CHECK (role IN ('Tecnico', 'GestorComercial', 'Assistente')),
    percentage        REAL    NOT NULL DEFAULT 0.0,            -- DECIMAL(5,2)
    base_amount       REAL    NOT NULL DEFAULT 0.0,            -- DECIMAL(10,2) em AOA
    commission_amount REAL    NOT NULL DEFAULT 0.0,            -- DECIMAL(10,2) em AOA
    paid              INTEGER NOT NULL DEFAULT 0               -- BOOLEAN
                      CHECK (paid IN (0, 1)),
    paid_at           TEXT,                                    -- TIMESTAMP
    created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

    FOREIGN KEY (booking_id) REFERENCES bookings (id) ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (user_id)    REFERENCES users    (id) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_commissions_booking_id ON commissions (booking_id);
CREATE INDEX IF NOT EXISTS idx_commissions_user_id    ON commissions (user_id);
CREATE INDEX IF NOT EXISTS idx_commissions_paid       ON commissions (paid);

-- -----------------------------------------------------------------------------
-- 10. COMMUNICATION_LOGS (Registo de Comunicações)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS communication_logs (
    id               TEXT    NOT NULL PRIMARY KEY,              -- UUID v4
    booking_id       TEXT,                                     -- FK -> bookings (opcional)
    client_id        TEXT    NOT NULL,                         -- FK -> clients
    agent_id         TEXT    NOT NULL,                         -- FK -> users (Quem comunicou)
    channel          TEXT    NOT NULL                          -- ENUM
                     CHECK (channel IN ('Telefone', 'WhatsApp', 'SMS')),
    direction        TEXT    NOT NULL                          -- ENUM
                     CHECK (direction IN ('Inbound', 'Outbound')),
    summary          TEXT,
    duration_seconds INTEGER,                                  -- Para chamadas telefónicas
    sent_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    delivered_at     TEXT,                                     -- Para mensagens

    FOREIGN KEY (booking_id) REFERENCES bookings (id) ON UPDATE CASCADE ON DELETE SET NULL,
    FOREIGN KEY (client_id)  REFERENCES clients  (id) ON UPDATE CASCADE ON DELETE RESTRICT,
    FOREIGN KEY (agent_id)   REFERENCES users    (id) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_comm_logs_booking_id ON communication_logs (booking_id);
CREATE INDEX IF NOT EXISTS idx_comm_logs_client_id  ON communication_logs (client_id);
CREATE INDEX IF NOT EXISTS idx_comm_logs_agent_id   ON communication_logs (agent_id);
CREATE INDEX IF NOT EXISTS idx_comm_logs_channel    ON communication_logs (channel);

-- -----------------------------------------------------------------------------
-- 11. MESSAGE_TEMPLATES (Templates WhatsApp/SMS)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS message_templates (
    id            TEXT    NOT NULL PRIMARY KEY,                 -- UUID v4
    name          TEXT    NOT NULL,                            -- VARCHAR(100)
    channel       TEXT    NOT NULL                             -- ENUM
                  CHECK (channel IN ('WhatsApp', 'SMS')),
    type          TEXT    NOT NULL                             -- ENUM
                  CHECK (type IN (
                      'Confirmation', 'Reminder', 'OnWay',
                      'RatingRequest', 'Quote', 'Invoice', 'PaymentReminder'
                  )),
    body_template TEXT    NOT NULL,                            -- Placeholders: {{client_name}}, {{service}}, etc.
    is_active     INTEGER NOT NULL DEFAULT 1                   -- BOOLEAN
                  CHECK (is_active IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_msg_templates_channel ON message_templates (channel);
CREATE INDEX IF NOT EXISTS idx_msg_templates_type    ON message_templates (type);
CREATE INDEX IF NOT EXISTS idx_msg_templates_active  ON message_templates (is_active);

-- -----------------------------------------------------------------------------
-- 12. PAYMENTS (Registo de Pagamentos)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
    id                  TEXT    NOT NULL PRIMARY KEY,           -- UUID v4
    booking_id          TEXT    NOT NULL,                      -- FK -> bookings
    amount              REAL    NOT NULL DEFAULT 0.0,          -- DECIMAL(10,2) em AOA
    method              TEXT    NOT NULL                       -- ENUM
                        CHECK (method IN ('Dinheiro', 'Transferencia')),
    reference           TEXT,                                  -- Nº de operação (transferência)
    proof_url           TEXT,                                  -- URL do comprovativo
    confirmed_by        TEXT,                                  -- FK -> users
    confirmed_at        TEXT,                                  -- TIMESTAMP
    deposited_to_bank   INTEGER NOT NULL DEFAULT 0             -- BOOLEAN
                        CHECK (deposited_to_bank IN (0, 1)),
    deposited_at        TEXT,                                  -- TIMESTAMP

    FOREIGN KEY (booking_id)   REFERENCES bookings (id) ON UPDATE CASCADE ON DELETE RESTRICT,
    FOREIGN KEY (confirmed_by) REFERENCES users    (id) ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_payments_booking_id       ON payments (booking_id);
CREATE INDEX IF NOT EXISTS idx_payments_method           ON payments (method);
CREATE INDEX IF NOT EXISTS idx_payments_deposited_bank   ON payments (deposited_to_bank);

-- -----------------------------------------------------------------------------
-- 13. COMPANY_PROFILE (Dados da Empresa — Singleton)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS company_profile (
    id         INTEGER NOT NULL PRIMARY KEY DEFAULT 1,   -- Singleton: apenas id=1
    name       TEXT    NOT NULL DEFAULT 'CleanXhedule Manager',
    nif        TEXT,
    location   TEXT,
    slogan     TEXT,
    bank_name  TEXT,
    bank_account TEXT,
    iban       TEXT,
    updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (id = 1)
);

-- Insere o registo padrão se ainda não existir
INSERT OR IGNORE INTO company_profile (id, name, nif, location, slogan, iban)
VALUES (1, 'CleanXhedule Manager', '5417088921', 'Luanda, Angola',
        'Serviços Profissionais de Higienização de Estofos', '');

-- =============================================================================
-- FIM DO SCHEMA
-- =============================================================================
