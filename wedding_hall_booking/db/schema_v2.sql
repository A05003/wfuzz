-- =====================================================================
-- نظام إدارة قاعات الأفراح وتصفية المناسبات — PostgreSQL 14+
-- Wedding & Event Venue Management: bookings, services, receipts,
-- post-event settlement, role-based access and a permanent audit trail.
--
-- Conventions
--   * Every write must run in a transaction that first identifies the user:
--       SELECT set_config('app.user_id', '<users.id>', true);
--     The user's ROLE is always looked up from the users table (never taken
--     from the client), so a client cannot claim to be the owner.
--   * HARD DELETE IS IMPOSSIBLE: a DELETE on any business table is turned
--     into a soft delete (deleted_at / deleted_by) and archived in audit_logs.
--   * audit_logs is append-only (UPDATE / DELETE / TRUNCATE are rejected).
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;   -- double-booking exclusion constraint

-- ---------------------------------------------------------------------
-- 0. Users & roles
-- ---------------------------------------------------------------------
CREATE TYPE user_role AS ENUM ('owner', 'manager');   -- المالك | مدير القصر

CREATE TABLE users (
    id            BIGSERIAL PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    full_name     TEXT NOT NULL,
    role          user_role NOT NULL,
    password_hash TEXT NOT NULL,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 1. Helper functions
-- ---------------------------------------------------------------------
-- "Today" in the venue's time zone (change the zone here if needed).
CREATE FUNCTION venue_today() RETURNS date LANGUAGE sql STABLE AS
$$ SELECT (now() AT TIME ZONE 'Asia/Riyadh')::date $$;

CREATE FUNCTION app_user_id() RETURNS bigint LANGUAGE plpgsql STABLE AS $$
DECLARE v text := nullif(current_setting('app.user_id', true), '');
BEGIN
    IF v IS NULL THEN
        RAISE EXCEPTION 'app.user_id is not set: every write must be attributed to a user' USING ERRCODE = '28000';
    END IF;
    RETURN v::bigint;
END $$;

CREATE FUNCTION app_role() RETURNS user_role LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r user_role;
BEGIN
    SELECT role INTO r FROM users WHERE id = app_user_id() AND is_active;
    IF r IS NULL THEN RAISE EXCEPTION 'unknown or inactive user' USING ERRCODE = '28000'; END IF;
    RETURN r;
END $$;

CREATE FUNCTION is_owner() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT app_role() = 'owner' $$;

-- ---------------------------------------------------------------------
-- 2. Audit log (permanent archive)
-- ---------------------------------------------------------------------
CREATE TABLE audit_logs (
    id            BIGSERIAL PRIMARY KEY,
    user_id       BIGINT NOT NULL REFERENCES users(id),
    action_type   TEXT NOT NULL CHECK (action_type IN ('CREATE','UPDATE','SOFT_DELETE','RESTORE')),
    "timestamp"   TIMESTAMPTZ NOT NULL DEFAULT now(),
    table_name    TEXT NOT NULL,
    record_id     BIGINT NOT NULL,
    contract_number TEXT,                 -- convenience for review/search
    original_data JSONB,                  -- row before the change (NULL on CREATE)
    new_data      JSONB                   -- row after the change
);
CREATE INDEX idx_audit_record   ON audit_logs (table_name, record_id);
CREATE INDEX idx_audit_contract ON audit_logs (contract_number);
CREATE INDEX idx_audit_time     ON audit_logs ("timestamp" DESC);

CREATE FUNCTION audit_logs_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit_logs is append-only (% rejected)', tg_op USING ERRCODE = '42501'; END $$;
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
CREATE TRIGGER trg_audit_no_truncate BEFORE TRUNCATE ON audit_logs FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_immutable();

/* Generic row auditor. Trigger args = columns to ignore when deciding whether
   an UPDATE is a real change (derived totals recalculated by other triggers). */
CREATE FUNCTION audit_row() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    ign   text[] := COALESCE(tg_argv, ARRAY[]::text[]);
    o     jsonb; n jsonb; act text; rid bigint; cn text;
BEGIN
    IF tg_op = 'INSERT' THEN
        act := 'CREATE'; n := to_jsonb(NEW); rid := (n->>'id')::bigint; cn := n->>'contract_number';
    ELSE
        o := to_jsonb(OLD); n := to_jsonb(NEW);
        IF (o - ign) = (n - ign) THEN RETURN NEW; END IF;   -- derived-only change: not an audit event
        rid := (n->>'id')::bigint; cn := n->>'contract_number';
        act := CASE WHEN o->>'deleted_at' IS NULL AND n->>'deleted_at' IS NOT NULL THEN 'SOFT_DELETE'
                    WHEN o->>'deleted_at' IS NOT NULL AND n->>'deleted_at' IS NULL THEN 'RESTORE'
                    ELSE 'UPDATE' END;
    END IF;
    INSERT INTO audit_logs (user_id, action_type, table_name, record_id, contract_number, original_data, new_data)
    VALUES (app_user_id(), act, tg_table_name, rid, cn, o, n);
    RETURN NEW;
END $$;

/* DELETE never removes a row: it becomes a soft delete (which the audit trigger archives). */
CREATE FUNCTION soft_delete_instead() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE format('UPDATE %I.%I SET deleted_at = COALESCE(deleted_at, now()), deleted_by = COALESCE(deleted_by, $1) WHERE id = $2',
                   tg_table_schema, tg_table_name) USING app_user_id(), OLD.id;
    RETURN NULL;                                           -- cancel the physical delete
END $$;

CREATE FUNCTION no_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'TRUNCATE is forbidden on %', tg_table_name USING ERRCODE = '42501'; END $$;

-- ---------------------------------------------------------------------
-- 3. Profit-split settings (OWNER ONLY, append-only history)
-- ---------------------------------------------------------------------
CREATE TABLE profit_split_settings (
    id            BIGSERIAL PRIMARY KEY,
    rental_pct    NUMERIC(5,2) NOT NULL CHECK (rental_pct BETWEEN 0 AND 100),     -- عقد إيجار القاعة
    marketing_pct NUMERIC(5,2) NOT NULL CHECK (marketing_pct BETWEEN 0 AND 100),  -- عقد التسويق والإدارة
    effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
    set_by        BIGINT NOT NULL REFERENCES users(id),
    note          TEXT,
    CONSTRAINT split_sums_to_100 CHECK (rental_pct + marketing_pct = 100)
);
CREATE FUNCTION split_settings_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF tg_op <> 'INSERT' THEN RAISE EXCEPTION 'profit_split_settings is append-only: insert a new version instead' USING ERRCODE = '42501'; END IF;
    IF NOT is_owner() THEN RAISE EXCEPTION 'only the owner may change profit-split percentages' USING ERRCODE = '42501'; END IF;
    NEW.set_by := app_user_id(); NEW.effective_from := now();
    RETURN NEW;
END $$;
CREATE TRIGGER trg_split_guard BEFORE INSERT OR UPDATE OR DELETE ON profit_split_settings FOR EACH ROW EXECUTE FUNCTION split_settings_guard();
CREATE TRIGGER trg_split_no_truncate BEFORE TRUNCATE ON profit_split_settings FOR EACH STATEMENT EXECUTE FUNCTION no_truncate();
CREATE FUNCTION active_split() RETURNS profit_split_settings LANGUAGE sql STABLE AS
$$ SELECT * FROM profit_split_settings ORDER BY effective_from DESC, id DESC LIMIT 1 $$;

-- ---------------------------------------------------------------------
-- 4. Service catalogue (optional price list)
-- ---------------------------------------------------------------------
CREATE TABLE services (
    id            BIGSERIAL PRIMARY KEY,
    name          TEXT NOT NULL UNIQUE,
    default_price NUMERIC(12,2) NOT NULL CHECK (default_price >= 0),
    is_active     BOOLEAN NOT NULL DEFAULT TRUE
);

-- ---------------------------------------------------------------------
-- 5. Bookings (contracts)
-- ---------------------------------------------------------------------
CREATE SEQUENCE contract_seq START 1001;
CREATE SEQUENCE receipt_seq  START 1;

CREATE TABLE bookings (
    id              BIGSERIAL PRIMARY KEY,
    contract_number TEXT NOT NULL UNIQUE
        DEFAULT ('C-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('contract_seq')::text, 5, '0')),
    event_date      DATE NOT NULL,
    section         TEXT NOT NULL CHECK (section IN ('women','men','both')),
    client_name     TEXT NOT NULL,
    client_phone    TEXT NOT NULL,
    base_amount     NUMERIC(12,2) NOT NULL CHECK (base_amount >= 0),          -- قيمة القاعة الأساسية
    discount        NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
    -- derived, maintained by triggers on booking_services / payments:
    services_total  NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (services_total >= 0),
    paid_total      NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (paid_total >= 0),
    -- auto-calculated on every change of the columns above:
    total_amount    NUMERIC(12,2) GENERATED ALWAYS AS (base_amount - discount + services_total) STORED,
    balance_due     NUMERIC(12,2) GENERATED ALWAYS AS (base_amount - discount + services_total - paid_total) STORED,
    status          TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','closed','cancelled')),
    closed_at       TIMESTAMPTZ,
    closed_by       BIGINT REFERENCES users(id),
    created_by      BIGINT NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,
    deleted_by      BIGINT REFERENCES users(id),
    -- section occupancy as a range so that "both" overlaps with women and men
    section_range   INT4RANGE GENERATED ALWAYS AS (
        CASE section WHEN 'women' THEN int4range(1, 2) WHEN 'men' THEN int4range(2, 3) ELSE int4range(1, 3) END) STORED,
    CONSTRAINT discount_le_base      CHECK (discount <= base_amount),
    CONSTRAINT never_overpaid        CHECK (paid_total <= base_amount - discount + services_total),
    CONSTRAINT closed_has_timestamp  CHECK ((status = 'closed') = (closed_at IS NOT NULL)),
    -- no double booking of the same section on the same day (soft-deleted / cancelled free the slot)
    CONSTRAINT no_double_booking EXCLUDE USING gist (event_date WITH =, section_range WITH &&)
        WHERE (status <> 'cancelled' AND deleted_at IS NULL)
);
CREATE INDEX idx_bookings_date   ON bookings (event_date) WHERE deleted_at IS NULL;
CREATE INDEX idx_bookings_client ON bookings (lower(client_name) text_pattern_ops);
CREATE INDEX idx_bookings_phone  ON bookings (client_phone);

CREATE FUNCTION bookings_biu() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF tg_op = 'INSERT' THEN
        NEW.created_by := app_user_id(); NEW.services_total := 0; NEW.paid_total := 0;
        NEW.status := 'confirmed'; NEW.closed_at := NULL; NEW.closed_by := NULL;
        IF NEW.event_date < venue_today() THEN RAISE EXCEPTION 'cannot create a contract for a past date'; END IF;
        RETURN NEW;
    END IF;

    IF NEW.contract_number <> OLD.contract_number THEN RAISE EXCEPTION 'contract_number is immutable'; END IF;
    NEW.updated_at := now();
    -- derived totals are always recomputed from the child rows; a client-supplied value is ignored
    NEW.services_total := COALESCE((SELECT sum(line_total) FROM booking_services s WHERE s.booking_id = OLD.id AND s.deleted_at IS NULL), 0);
    NEW.paid_total     := COALESCE((SELECT sum(amount)     FROM payments p        WHERE p.booking_id = OLD.id AND p.deleted_at IS NULL), 0);
    IF OLD.status IN ('closed','cancelled') AND NOT is_owner() THEN
        RAISE EXCEPTION 'contract % is % and frozen: only the owner may change it', OLD.contract_number, OLD.status USING ERRCODE = '42501';
    END IF;
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL AND NOT is_owner()
       AND EXISTS (SELECT 1 FROM payments p WHERE p.booking_id = OLD.id AND p.deleted_at IS NULL) THEN
        RAISE EXCEPTION 'contract % has receipts; cancel it instead of deleting', OLD.contract_number USING ERRCODE = '42501';
    END IF;
    -- same-day financial settlement: closing needs a zero balance and the event day reached
    IF NEW.status = 'closed' AND OLD.status <> 'closed' THEN
        IF NEW.base_amount - NEW.discount + NEW.services_total - NEW.paid_total <> 0 THEN
            RAISE EXCEPTION 'cannot close contract %: balance due is not zero', OLD.contract_number;
        END IF;
        IF NEW.event_date > venue_today() THEN RAISE EXCEPTION 'cannot close contract % before its event day', OLD.contract_number; END IF;
        NEW.closed_at := now(); NEW.closed_by := app_user_id();
    END IF;
    IF NEW.status <> 'closed' AND OLD.status = 'closed' THEN NEW.closed_at := NULL; NEW.closed_by := NULL; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER trg_bookings_biu BEFORE INSERT OR UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION bookings_biu();
CREATE TRIGGER trg_bookings_del BEFORE DELETE ON bookings FOR EACH ROW EXECUTE FUNCTION soft_delete_instead();
CREATE TRIGGER trg_bookings_trunc BEFORE TRUNCATE ON bookings FOR EACH STATEMENT EXECUTE FUNCTION no_truncate();
CREATE TRIGGER trg_bookings_audit AFTER INSERT OR UPDATE ON bookings
    FOR EACH ROW EXECUTE FUNCTION audit_row('services_total','paid_total','total_amount','balance_due','updated_at');

-- ---------------------------------------------------------------------
-- 6. Booking services (can be added at any time while the contract is open)
-- ---------------------------------------------------------------------
CREATE TABLE booking_services (
    id              BIGSERIAL PRIMARY KEY,
    booking_id      BIGINT NOT NULL REFERENCES bookings(id),
    contract_number TEXT NOT NULL,                       -- auto-bound to the booking
    service_id      BIGINT REFERENCES services(id),
    name            TEXT NOT NULL,
    quantity        NUMERIC(10,2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_price      NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
    line_total      NUMERIC(12,2) GENERATED ALWAYS AS (round(quantity * unit_price, 2)) STORED,
    added_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    added_by        BIGINT NOT NULL REFERENCES users(id),
    deleted_at      TIMESTAMPTZ,
    deleted_by      BIGINT REFERENCES users(id)
);
CREATE INDEX idx_bs_booking ON booking_services (booking_id) WHERE deleted_at IS NULL;

/* Recalculate a contract's derived totals (and any settlement that depends on them).
   The BEFORE UPDATE trigger does the arithmetic; touching the row is enough. */
CREATE FUNCTION recalc_booking(p_booking bigint) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    UPDATE bookings SET id = id WHERE id = p_booking;
    PERFORM recalc_settlement(id) FROM event_settlements WHERE booking_id = p_booking AND deleted_at IS NULL;
END $$;

CREATE FUNCTION booking_services_biu() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b bookings;
BEGIN
    SELECT * INTO b FROM bookings WHERE id = NEW.booking_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'contract not found'; END IF;
    IF tg_op = 'UPDATE' THEN
        IF NEW.booking_id <> OLD.booking_id OR NEW.contract_number <> OLD.contract_number THEN
            RAISE EXCEPTION 'a service cannot be moved to another contract';
        END IF;
    ELSE
        NEW.contract_number := b.contract_number; NEW.added_by := app_user_id(); NEW.added_at := now();
        IF NEW.service_id IS NOT NULL AND NEW.name IS NULL THEN SELECT name INTO NEW.name FROM services WHERE id = NEW.service_id; END IF;
    END IF;
    IF b.status <> 'confirmed' AND NOT is_owner() THEN
        RAISE EXCEPTION 'contract % is %: services can no longer be changed', b.contract_number, b.status USING ERRCODE = '42501';
    END IF;
    -- after the event day the account must be settled, not extended
    IF b.event_date < venue_today() AND NOT is_owner() THEN
        RAISE EXCEPTION 'event day of contract % has passed: services can no longer be changed', b.contract_number USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END $$;
CREATE FUNCTION booking_services_aiu() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM recalc_booking(NEW.booking_id); RETURN NULL; END $$;

CREATE TRIGGER trg_bs_biu   BEFORE INSERT OR UPDATE ON booking_services FOR EACH ROW EXECUTE FUNCTION booking_services_biu();
CREATE TRIGGER trg_bs_aiu   AFTER  INSERT OR UPDATE ON booking_services FOR EACH ROW EXECUTE FUNCTION booking_services_aiu();
CREATE TRIGGER trg_bs_del   BEFORE DELETE ON booking_services FOR EACH ROW EXECUTE FUNCTION soft_delete_instead();
CREATE TRIGGER trg_bs_trunc BEFORE TRUNCATE ON booking_services FOR EACH STATEMENT EXECUTE FUNCTION no_truncate();
CREATE TRIGGER trg_bs_audit AFTER INSERT OR UPDATE ON booking_services FOR EACH ROW EXECUTE FUNCTION audit_row();

-- ---------------------------------------------------------------------
-- 7. Payments / receipts (سندات القبض) — always mapped to a contract number
-- ---------------------------------------------------------------------
CREATE TABLE payments (
    id              BIGSERIAL PRIMARY KEY,
    receipt_number  TEXT NOT NULL UNIQUE
        DEFAULT ('R-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('receipt_seq')::text, 6, '0')),
    booking_id      BIGINT NOT NULL REFERENCES bookings(id),
    contract_number TEXT NOT NULL,                       -- auto-bound to the booking
    amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    method          TEXT NOT NULL CHECK (method IN ('cash','card','transfer')),
    note            TEXT NOT NULL DEFAULT '',
    received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    received_by     BIGINT NOT NULL REFERENCES users(id),
    deleted_at      TIMESTAMPTZ,
    deleted_by      BIGINT REFERENCES users(id)
);
CREATE INDEX idx_pay_booking ON payments (booking_id) WHERE deleted_at IS NULL;

CREATE FUNCTION payments_biu() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b bookings; due numeric;
BEGIN
    SELECT * INTO b FROM bookings WHERE id = NEW.booking_id AND deleted_at IS NULL FOR UPDATE;   -- serialises concurrent receipts
    IF NOT FOUND THEN RAISE EXCEPTION 'contract not found'; END IF;
    IF tg_op = 'UPDATE' THEN
        IF NEW.booking_id <> OLD.booking_id OR NEW.contract_number <> OLD.contract_number OR NEW.receipt_number <> OLD.receipt_number THEN
            RAISE EXCEPTION 'receipt number, contract and contract number are immutable';
        END IF;
    ELSE
        NEW.contract_number := b.contract_number; NEW.received_by := app_user_id(); NEW.received_at := now();
    END IF;
    IF b.status <> 'confirmed' AND NOT is_owner() THEN
        RAISE EXCEPTION 'contract % is %: receipts can no longer be changed', b.contract_number, b.status USING ERRCODE = '42501';
    END IF;
    IF NEW.deleted_at IS NULL THEN
        due := b.total_amount - (b.paid_total - CASE WHEN tg_op = 'UPDATE' AND OLD.deleted_at IS NULL THEN OLD.amount ELSE 0 END);
        IF NEW.amount > due THEN RAISE EXCEPTION 'receipt amount % exceeds the balance due % on contract %', NEW.amount, due, b.contract_number; END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE FUNCTION payments_aiu() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM recalc_booking(NEW.booking_id); RETURN NULL; END $$;

CREATE TRIGGER trg_pay_biu   BEFORE INSERT OR UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION payments_biu();
CREATE TRIGGER trg_pay_aiu   AFTER  INSERT OR UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION payments_aiu();
CREATE TRIGGER trg_pay_del   BEFORE DELETE ON payments FOR EACH ROW EXECUTE FUNCTION soft_delete_instead();
CREATE TRIGGER trg_pay_trunc BEFORE TRUNCATE ON payments FOR EACH STATEMENT EXECUTE FUNCTION no_truncate();
CREATE TRIGGER trg_pay_audit AFTER INSERT OR UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION audit_row();

-- ---------------------------------------------------------------------
-- 8. Post-event settlement (تصفية المناسبة)
-- ---------------------------------------------------------------------
CREATE TABLE event_settlements (
    id               BIGSERIAL PRIMARY KEY,
    booking_id       BIGINT NOT NULL REFERENCES bookings(id),
    contract_number  TEXT NOT NULL,
    total_revenue    NUMERIC(12,2) NOT NULL DEFAULT 0,          -- = booking total, unless the owner overrides
    revenue_override NUMERIC(12,2) CHECK (revenue_override >= 0),   -- owner only
    override_reason  TEXT,
    total_expenses   NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total_expenses >= 0),   -- sum of event_expenses
    rental_pct       NUMERIC(5,2) NOT NULL,                     -- snapshot of the split in force at creation
    marketing_pct    NUMERIC(5,2) NOT NULL,
    -- auto-calculated:
    net_profit       NUMERIC(12,2) GENERATED ALWAYS AS (total_revenue - total_expenses) STORED,
    rental_share     NUMERIC(12,2) GENERATED ALWAYS AS (round((total_revenue - total_expenses) * rental_pct / 100, 2)) STORED,
    marketing_share  NUMERIC(12,2) GENERATED ALWAYS AS ((total_revenue - total_expenses) - round((total_revenue - total_expenses) * rental_pct / 100, 2)) STORED,
    status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','finalized')),
    settled_on_event_day BOOLEAN,
    notes            TEXT NOT NULL DEFAULT '',
    finalized_at     TIMESTAMPTZ,
    finalized_by     BIGINT REFERENCES users(id),
    created_by       BIGINT NOT NULL REFERENCES users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at       TIMESTAMPTZ,
    deleted_by       BIGINT REFERENCES users(id),
    CONSTRAINT split_sums_to_100 CHECK (rental_pct + marketing_pct = 100),
    CONSTRAINT override_needs_reason CHECK (revenue_override IS NULL OR length(btrim(coalesce(override_reason, ''))) > 0)
);
CREATE UNIQUE INDEX uq_settlement_per_booking ON event_settlements (booking_id) WHERE deleted_at IS NULL;

CREATE TABLE event_expenses (
    id              BIGSERIAL PRIMARY KEY,
    settlement_id   BIGINT NOT NULL REFERENCES event_settlements(id),
    booking_id      BIGINT NOT NULL REFERENCES bookings(id),
    contract_number TEXT NOT NULL,
    category        TEXT NOT NULL CHECK (category IN ('labor','cleaning','consumables','other')),  -- عمالة | نظافة | مستهلكات | أخرى
    description     TEXT NOT NULL,
    amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    spent_on        DATE NOT NULL DEFAULT venue_today(),
    entered_by      BIGINT NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,
    deleted_by      BIGINT REFERENCES users(id)
);
CREATE INDEX idx_exp_settlement ON event_expenses (settlement_id) WHERE deleted_at IS NULL;

/* Totals are recomputed by settlements_biu (never client-writable); touching the row is enough. */
CREATE FUNCTION recalc_settlement(p_settlement bigint) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    UPDATE event_settlements SET id = id WHERE id = p_settlement;
END $$;

CREATE FUNCTION settlements_biu() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b bookings; sp profit_split_settings;
BEGIN
    SELECT * INTO b FROM bookings WHERE id = NEW.booking_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'contract not found'; END IF;

    IF tg_op = 'INSERT' THEN
        IF b.status = 'cancelled' THEN RAISE EXCEPTION 'contract % is cancelled', b.contract_number; END IF;
        IF b.event_date > venue_today() THEN RAISE EXCEPTION 'settlement opens on the event day (%), not before', b.event_date; END IF;
        sp := active_split();
        IF sp.id IS NULL THEN RAISE EXCEPTION 'no profit-split percentages configured: the owner must set them first'; END IF;
        -- percentages always come from the owner-controlled configuration, whatever the client sent
        NEW.rental_pct := sp.rental_pct; NEW.marketing_pct := sp.marketing_pct;
        NEW.contract_number := b.contract_number; NEW.created_by := app_user_id();
        NEW.status := 'draft'; NEW.finalized_at := NULL; NEW.finalized_by := NULL; NEW.settled_on_event_day := NULL;
        NEW.total_expenses := 0;
        IF NEW.revenue_override IS NOT NULL AND NOT is_owner() THEN RAISE EXCEPTION 'only the owner may override revenue' USING ERRCODE = '42501'; END IF;
        NEW.total_revenue := COALESCE(NEW.revenue_override, b.total_amount);
        RETURN NEW;
    END IF;

    -- UPDATE ------------------------------------------------------------
    NEW.updated_at := now();
    NEW.total_expenses := COALESCE((SELECT sum(amount) FROM event_expenses e WHERE e.settlement_id = OLD.id AND e.deleted_at IS NULL), 0);
    NEW.total_revenue  := COALESCE(NEW.revenue_override, b.total_amount);
    IF NEW.booking_id <> OLD.booking_id OR NEW.contract_number <> OLD.contract_number THEN RAISE EXCEPTION 'settlement cannot be moved to another contract'; END IF;
    IF NOT is_owner() THEN
        IF NEW.rental_pct IS DISTINCT FROM OLD.rental_pct OR NEW.marketing_pct IS DISTINCT FROM OLD.marketing_pct THEN
            RAISE EXCEPTION 'only the owner may modify profit-split percentages' USING ERRCODE = '42501';
        END IF;
        IF NEW.revenue_override IS DISTINCT FROM OLD.revenue_override OR NEW.override_reason IS DISTINCT FROM OLD.override_reason THEN
            RAISE EXCEPTION 'only the owner may override financial values' USING ERRCODE = '42501';
        END IF;
        IF OLD.status = 'finalized' THEN RAISE EXCEPTION 'settlement of % is finalized and frozen', OLD.contract_number USING ERRCODE = '42501'; END IF;
    END IF;
    IF NEW.status = 'finalized' AND OLD.status = 'draft' THEN
        IF b.balance_due <> 0 THEN RAISE EXCEPTION 'cannot finalize: contract % still has a balance due of %', b.contract_number, b.balance_due; END IF;
        IF b.event_date > venue_today() THEN RAISE EXCEPTION 'cannot finalize before the event day'; END IF;
        NEW.finalized_at := now(); NEW.finalized_by := app_user_id();
        NEW.settled_on_event_day := (b.event_date = venue_today());
    END IF;
    IF NEW.status = 'draft' AND OLD.status = 'finalized' THEN   -- reopening: owner only (checked above)
        NEW.finalized_at := NULL; NEW.finalized_by := NULL; NEW.settled_on_event_day := NULL;
    END IF;
    RETURN NEW;
END $$;
CREATE FUNCTION settlements_au_close_booking() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status = 'finalized' AND OLD.status = 'draft' THEN
        UPDATE bookings SET status = 'closed' WHERE id = NEW.booking_id AND status = 'confirmed';
    ELSIF NEW.status = 'draft' AND OLD.status = 'finalized' THEN
        UPDATE bookings SET status = 'confirmed' WHERE id = NEW.booking_id AND status = 'closed';
    END IF;
    RETURN NULL;
END $$;

CREATE TRIGGER trg_set_biu   BEFORE INSERT OR UPDATE ON event_settlements FOR EACH ROW EXECUTE FUNCTION settlements_biu();
CREATE TRIGGER trg_set_au    AFTER UPDATE OF status ON event_settlements FOR EACH ROW EXECUTE FUNCTION settlements_au_close_booking();
CREATE TRIGGER trg_set_del   BEFORE DELETE ON event_settlements FOR EACH ROW EXECUTE FUNCTION soft_delete_instead();
CREATE TRIGGER trg_set_trunc BEFORE TRUNCATE ON event_settlements FOR EACH STATEMENT EXECUTE FUNCTION no_truncate();
CREATE TRIGGER trg_set_audit AFTER INSERT OR UPDATE ON event_settlements FOR EACH ROW EXECUTE FUNCTION audit_row('updated_at','total_expenses','total_revenue','net_profit','rental_share','marketing_share');

CREATE FUNCTION expenses_biu() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s event_settlements;
BEGIN
    SELECT * INTO s FROM event_settlements WHERE id = NEW.settlement_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'settlement not found'; END IF;
    IF tg_op = 'UPDATE' THEN
        IF NEW.settlement_id <> OLD.settlement_id OR NEW.booking_id <> OLD.booking_id OR NEW.contract_number <> OLD.contract_number THEN
            RAISE EXCEPTION 'an expense cannot be moved to another settlement';
        END IF;
    ELSE
        NEW.booking_id := s.booking_id; NEW.contract_number := s.contract_number; NEW.entered_by := app_user_id();
    END IF;
    IF s.status = 'finalized' AND NOT is_owner() THEN
        RAISE EXCEPTION 'settlement of % is finalized: expenses are frozen', s.contract_number USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END $$;
CREATE FUNCTION expenses_aiu() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM recalc_settlement(NEW.settlement_id); RETURN NULL; END $$;

CREATE TRIGGER trg_exp_biu   BEFORE INSERT OR UPDATE ON event_expenses FOR EACH ROW EXECUTE FUNCTION expenses_biu();
CREATE TRIGGER trg_exp_aiu   AFTER  INSERT OR UPDATE ON event_expenses FOR EACH ROW EXECUTE FUNCTION expenses_aiu();
CREATE TRIGGER trg_exp_del   BEFORE DELETE ON event_expenses FOR EACH ROW EXECUTE FUNCTION soft_delete_instead();
CREATE TRIGGER trg_exp_trunc BEFORE TRUNCATE ON event_expenses FOR EACH STATEMENT EXECUTE FUNCTION no_truncate();
CREATE TRIGGER trg_exp_audit AFTER INSERT OR UPDATE ON event_expenses FOR EACH ROW EXECUTE FUNCTION audit_row();

-- ---------------------------------------------------------------------
-- 9. Views & functions used by the dashboard
-- ---------------------------------------------------------------------
CREATE VIEW v_contracts AS
SELECT b.id, b.contract_number, b.client_name, b.client_phone, b.event_date, b.section, b.status,
       b.base_amount, b.discount, b.services_total, b.total_amount, b.paid_total, b.balance_due,
       (b.status = 'confirmed' AND b.event_date = venue_today())  AS settlement_due_today,
       (b.status = 'confirmed' AND b.event_date <  venue_today())  AS settlement_overdue,
       s.id AS settlement_id, s.status AS settlement_status, s.net_profit
FROM bookings b
LEFT JOIN event_settlements s ON s.booking_id = b.id AND s.deleted_at IS NULL
WHERE b.deleted_at IS NULL;

/* Quick search by contract number, client name or phone */
CREATE FUNCTION search_contracts(q text, max_rows int DEFAULT 10) RETURNS SETOF v_contracts LANGUAGE sql STABLE AS $$
    SELECT * FROM v_contracts
    WHERE contract_number ILIKE '%' || btrim(q) || '%' OR client_name ILIKE '%' || btrim(q) || '%' OR client_phone LIKE '%' || btrim(q) || '%'
    ORDER BY event_date DESC LIMIT max_rows
$$;

/* Audit archive: readable by the owner only */
CREATE FUNCTION owner_audit_review(p_contract text DEFAULT NULL, p_limit int DEFAULT 200)
RETURNS SETOF audit_logs LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF app_role() <> 'owner' THEN RAISE EXCEPTION 'audit archive is restricted to the owner' USING ERRCODE = '42501'; END IF;
    RETURN QUERY SELECT * FROM audit_logs WHERE p_contract IS NULL OR contract_number = p_contract ORDER BY "timestamp" DESC, id DESC LIMIT p_limit;
END $$;

-- ---------------------------------------------------------------------
-- 10. Database privileges (run once, as the schema owner)
--     The application connects as qasr_app: it can read/insert/update business
--     tables, can NOT delete, and can NOT read audit_logs directly.
-- ---------------------------------------------------------------------
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qasr_app') THEN CREATE ROLE qasr_app NOLOGIN; END IF;
END $$;
GRANT SELECT, INSERT, UPDATE ON bookings, booking_services, payments, event_settlements, event_expenses, services TO qasr_app;
GRANT SELECT, INSERT ON profit_split_settings TO qasr_app;
GRANT SELECT ON users, v_contracts TO qasr_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO qasr_app;
GRANT EXECUTE ON FUNCTION search_contracts(text, int), owner_audit_review(text, int), active_split() TO qasr_app;
REVOKE ALL ON audit_logs FROM PUBLIC, qasr_app;
-- (DELETE / TRUNCATE are never granted; the triggers above enforce soft delete even for the table owner.)
