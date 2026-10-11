-- =====================================================================
-- نظام إدارة قاعات الأفراح وتصفية المناسبات (متعدد الفروع) — PostgreSQL 15+
-- Multi-branch Venue & Event Management ERP
--
-- Security model (defence in depth)
--   1. Identity   : every transaction starts with set_config('app.user_id', ...). The user's ROLE and BRANCH are
--                   always looked up from the users table, never taken from the client.
--   2. Isolation  : row-level security. A branch manager / supervisor only ever sees rows of their own branch.
--                   The owner sees all branches, or one branch when 'app.scope_branch' is set (branch switcher).
--   3. Integrity  : HARD DELETE IS IMPOSSIBLE. DELETE becomes a soft delete; every create/update/soft-delete of a
--                   business row is archived in audit_logs (old/new values, severity). audit_logs is append-only.
--   4. Roles      : owner (المالك, global) | manager (مدير الفرع) | supervisor (مشرف ميداني / استقبال).
--   The application connects as a privileged login role and runs each request with `SET LOCAL ROLE qasr_app`,
--   so the grants and policies below really apply (superusers and table owners bypass RLS).
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;   -- double-booking exclusion constraint

-- ---------------------------------------------------------------------
-- 0. Branches, users, roles
-- ---------------------------------------------------------------------
CREATE TYPE user_role AS ENUM ('owner', 'manager', 'supervisor');

CREATE TABLE branches (
    id         BIGSERIAL PRIMARY KEY,
    code       TEXT NOT NULL UNIQUE,
    name_ar    TEXT NOT NULL,
    name_en    TEXT NOT NULL,
    city       TEXT NOT NULL DEFAULT '',
    phone      TEXT NOT NULL DEFAULT '',
    is_active  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    deleted_by BIGINT
);

CREATE TABLE users (
    id            BIGSERIAL PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    full_name     TEXT NOT NULL,
    role          user_role NOT NULL,
    branch_id     BIGINT REFERENCES branches(id),            -- NULL = global scope (owner only)
    password_hash TEXT NOT NULL,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT users_branch_scope CHECK ((role = 'owner') = (branch_id IS NULL))
);
ALTER TABLE branches ADD CONSTRAINT branches_deleted_by_fk FOREIGN KEY (deleted_by) REFERENCES users(id);

-- ---------------------------------------------------------------------
-- 1. Helper functions
-- ---------------------------------------------------------------------
CREATE FUNCTION venue_today() RETURNS date LANGUAGE sql STABLE AS
$$ SELECT (now() AT TIME ZONE 'Asia/Riyadh')::date $$;          -- "today" in the venue's time zone

CREATE FUNCTION app_user_id() RETURNS bigint LANGUAGE plpgsql STABLE AS $$
DECLARE v text := nullif(current_setting('app.user_id', true), '');
BEGIN
    IF v IS NULL THEN RAISE EXCEPTION 'app.user_id is not set: every write must be attributed to a user' USING ERRCODE = '28000'; END IF;
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

/* The branch the current request may see: the user's own branch, or — for the owner — the selected branch / NULL = all. */
CREATE FUNCTION app_scope_branch() RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE u users; s text := nullif(current_setting('app.scope_branch', true), '');
BEGIN
    SELECT * INTO u FROM users WHERE id = app_user_id() AND is_active;
    IF u.id IS NULL THEN RAISE EXCEPTION 'unknown or inactive user' USING ERRCODE = '28000'; END IF;
    IF u.role <> 'owner' THEN RETURN u.branch_id; END IF;
    RETURN CASE WHEN s IS NULL OR upper(s) = 'ALL' THEN NULL ELSE s::bigint END;
END $$;

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
    branch_id     BIGINT,
    contract_number TEXT,
    original_data JSONB,                  -- row before the change (NULL on CREATE)
    new_data      JSONB,                  -- row after the change
    severity      TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical'))
);
CREATE INDEX idx_audit_record   ON audit_logs (table_name, record_id);
CREATE INDEX idx_audit_contract ON audit_logs (contract_number);
CREATE INDEX idx_audit_time     ON audit_logs ("timestamp" DESC);
CREATE INDEX idx_audit_sev      ON audit_logs (severity, "timestamp" DESC) WHERE severity <> 'info';

CREATE FUNCTION audit_logs_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit_logs is append-only (% rejected)', tg_op USING ERRCODE = '42501'; END $$;
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
CREATE TRIGGER trg_audit_no_truncate BEFORE TRUNCATE ON audit_logs FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_immutable();

/* What deserves the Super Admin's attention: modifications/deletions of financial records, anything done to a
   closed contract or finalized settlement, owner overrides and split changes. */
CREATE FUNCTION audit_severity(tbl text, act text, o jsonb, n jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN tbl = 'profit_split_settings' THEN 'critical'
        WHEN tbl = 'event_settlements' AND act = 'UPDATE' AND (o->>'status' = 'finalized'
              OR o->>'revenue_override' IS DISTINCT FROM n->>'revenue_override' OR o->>'rental_pct' IS DISTINCT FROM n->>'rental_pct') THEN 'critical'
        WHEN tbl = 'bookings' AND act = 'UPDATE' AND o->>'status' = 'closed' THEN 'critical'
        -- the normal end of a contract's life (settlement finalized => status closed, nothing else touched) is not suspicious
        WHEN tbl = 'bookings' AND act = 'UPDATE' AND o->>'status' = 'confirmed' AND n->>'status' = 'closed'
              AND o->>'base_amount' = n->>'base_amount' AND o->>'discount' = n->>'discount' AND o->>'event_date' = n->>'event_date' AND o->>'hall_id' = n->>'hall_id' THEN 'info'
        WHEN act = 'SOFT_DELETE' AND tbl IN ('bookings','payments','event_expenses','booking_services','event_settlements') THEN 'warning'
        WHEN act = 'UPDATE' AND tbl IN ('bookings','payments','event_expenses','booking_services') THEN 'warning'
        WHEN act = 'RESTORE' THEN 'warning'
        ELSE 'info' END
$$;

/* Generic row auditor. Trigger args = columns ignored when deciding whether an UPDATE is a real change
   (derived totals recalculated by other triggers). Secrets are never copied into the archive. */
CREATE FUNCTION audit_row() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    ign  text[] := COALESCE(tg_argv, ARRAY[]::text[]);
    secret text[] := ARRAY['password_hash'];
    o jsonb; n jsonb; act text; rid bigint; cn text; bid bigint;
BEGIN
    IF tg_table_name = 'users' AND nullif(current_setting('app.user_id', true), '') IS NULL THEN RETURN NEW; END IF;   -- system maintenance (login counters, recovery)
    IF tg_op = 'INSERT' THEN
        act := 'CREATE'; n := to_jsonb(NEW) - secret;
    ELSE
        o := to_jsonb(OLD) - secret; n := to_jsonb(NEW) - secret;
        IF (o - ign) = (n - ign) THEN RETURN NEW; END IF;   -- derived-only change: not an audit event
        act := CASE WHEN o->>'deleted_at' IS NULL AND n->>'deleted_at' IS NOT NULL THEN 'SOFT_DELETE'
                    WHEN o->>'deleted_at' IS NOT NULL AND n->>'deleted_at' IS NULL THEN 'RESTORE' ELSE 'UPDATE' END;
    END IF;
    rid := (n->>'id')::bigint; cn := n->>'contract_number';
    bid := COALESCE((n->>'branch_id')::bigint, CASE WHEN tg_table_name = 'branches' THEN rid END);
    INSERT INTO audit_logs (user_id, action_type, table_name, record_id, branch_id, contract_number, original_data, new_data, severity)
    VALUES (app_user_id(), act, tg_table_name, rid, bid, cn, o, n, audit_severity(tg_table_name, act, o, n));
    RETURN NEW;
END $$;

/* DELETE never removes a row: it becomes a soft delete (which the audit trigger archives). */
CREATE FUNCTION soft_delete_instead() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE format('UPDATE %I.%I SET deleted_at = COALESCE(deleted_at, now()), deleted_by = COALESCE(deleted_by, $1) WHERE id = $2',
                   tg_table_schema, tg_table_name) USING app_user_id(), OLD.id;
    RETURN NULL;
END $$;
CREATE FUNCTION no_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'TRUNCATE is forbidden on %', tg_table_name USING ERRCODE = '42501'; END $$;
CREATE FUNCTION no_hard_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'hard delete is forbidden on % (deactivate instead)', tg_table_name USING ERRCODE = '42501'; END $$;

-- users: only the owner manages accounts (system maintenance without a user context — login counters, recovery — is allowed)
CREATE FUNCTION users_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF nullif(current_setting('app.user_id', true), '') IS NULL THEN RETURN NEW; END IF;
    IF NOT is_owner() THEN RAISE EXCEPTION 'only the owner may manage user accounts' USING ERRCODE = '42501'; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER trg_users_guard BEFORE INSERT OR UPDATE ON users FOR EACH ROW EXECUTE FUNCTION users_guard();
CREATE TRIGGER trg_users_nodel BEFORE DELETE ON users FOR EACH ROW EXECUTE FUNCTION no_hard_delete();
CREATE TRIGGER trg_users_trunc BEFORE TRUNCATE ON users FOR EACH STATEMENT EXECUTE FUNCTION no_truncate();
CREATE TRIGGER trg_users_audit AFTER INSERT OR UPDATE ON users FOR EACH ROW EXECUTE FUNCTION audit_row('failed_logins','locked_until','lang');

-- branches: owner only
CREATE FUNCTION branches_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NOT is_owner() THEN RAISE EXCEPTION 'only the owner may change branches' USING ERRCODE = '42501'; END IF; RETURN NEW; END $$;
CREATE TRIGGER trg_branches_guard BEFORE INSERT OR UPDATE ON branches FOR EACH ROW EXECUTE FUNCTION branches_guard();
CREATE TRIGGER trg_branches_del   BEFORE DELETE ON branches FOR EACH ROW EXECUTE FUNCTION soft_delete_instead();
CREATE TRIGGER trg_branches_trunc BEFORE TRUNCATE ON branches FOR EACH STATEMENT EXECUTE FUNCTION no_truncate();
CREATE TRIGGER trg_branches_audit AFTER INSERT OR UPDATE ON branches FOR EACH ROW EXECUTE FUNCTION audit_row();

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
CREATE TRIGGER trg_split_audit AFTER INSERT ON profit_split_settings FOR EACH ROW EXECUTE FUNCTION audit_row();
CREATE FUNCTION active_split() RETURNS profit_split_settings LANGUAGE sql STABLE AS
$$ SELECT * FROM profit_split_settings ORDER BY effective_from DESC, id DESC LIMIT 1 $$;

-- ---------------------------------------------------------------------
-- 4. Service catalogue (optional price list) and halls
-- ---------------------------------------------------------------------
CREATE TABLE services (
    id            BIGSERIAL PRIMARY KEY,
    name          TEXT NOT NULL UNIQUE,
    default_price NUMERIC(12,2) NOT NULL CHECK (default_price >= 0),
    is_active     BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE halls (
    id             BIGSERIAL PRIMARY KEY,
    branch_id      BIGINT NOT NULL REFERENCES branches(id),
    name_ar        TEXT NOT NULL,
    name_en        TEXT NOT NULL,
    capacity_men   INT NOT NULL DEFAULT 0 CHECK (capacity_men >= 0),
    capacity_women INT NOT NULL DEFAULT 0 CHECK (capacity_women >= 0),
    base_price     NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (base_price >= 0),
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at     TIMESTAMPTZ,
    deleted_by     BIGINT REFERENCES users(id)
);
CREATE FUNCTION halls_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NOT is_owner() THEN RAISE EXCEPTION 'only the owner may change halls' USING ERRCODE = '42501'; END IF; RETURN NEW; END $$;
CREATE TRIGGER trg_halls_guard BEFORE INSERT OR UPDATE ON halls FOR EACH ROW EXECUTE FUNCTION halls_guard();
CREATE TRIGGER trg_halls_del   BEFORE DELETE ON halls FOR EACH ROW EXECUTE FUNCTION soft_delete_instead();
CREATE TRIGGER trg_halls_trunc BEFORE TRUNCATE ON halls FOR EACH STATEMENT EXECUTE FUNCTION no_truncate();
CREATE TRIGGER trg_halls_audit AFTER INSERT OR UPDATE ON halls FOR EACH ROW EXECUTE FUNCTION audit_row();

-- ---------------------------------------------------------------------
-- 5. Bookings (contracts)
-- ---------------------------------------------------------------------
CREATE SEQUENCE contract_seq START 1001;
CREATE SEQUENCE receipt_seq  START 1;

CREATE TABLE bookings (
    id              BIGSERIAL PRIMARY KEY,
    branch_id       BIGINT NOT NULL REFERENCES branches(id),    -- always the hall's branch (set by trigger)
    hall_id         BIGINT NOT NULL REFERENCES halls(id),
    contract_number TEXT NOT NULL UNIQUE
        DEFAULT ('C-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('contract_seq')::text, 5, '0')),
    event_date      DATE NOT NULL,
    section         TEXT NOT NULL CHECK (section IN ('women','men','both')),
    client_name     TEXT NOT NULL,
    client_phone    TEXT NOT NULL,
    base_amount     NUMERIC(12,2) NOT NULL CHECK (base_amount >= 0),
    discount        NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
    -- derived, maintained from the child rows by trigger (client-supplied values are ignored):
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
    section_range   INT4RANGE GENERATED ALWAYS AS (
        CASE section WHEN 'women' THEN int4range(1, 2) WHEN 'men' THEN int4range(2, 3) ELSE int4range(1, 3) END) STORED,
    CONSTRAINT discount_le_base      CHECK (discount <= base_amount),
    CONSTRAINT never_overpaid        CHECK (paid_total <= base_amount - discount + services_total),
    CONSTRAINT closed_has_timestamp  CHECK ((status = 'closed') = (closed_at IS NOT NULL)),
    -- no double booking of the same hall section on the same day (soft-deleted / cancelled free the slot)
    CONSTRAINT no_double_booking EXCLUDE USING gist (hall_id WITH =, event_date WITH =, section_range WITH &&)
        WHERE (status <> 'cancelled' AND deleted_at IS NULL)
);
CREATE INDEX idx_bookings_date   ON bookings (event_date) WHERE deleted_at IS NULL;
CREATE INDEX idx_bookings_branch ON bookings (branch_id, event_date) WHERE deleted_at IS NULL;
CREATE INDEX idx_bookings_hall   ON bookings (hall_id, event_date) WHERE deleted_at IS NULL;
CREATE INDEX idx_bookings_client ON bookings (lower(client_name) text_pattern_ops);
CREATE INDEX idx_bookings_phone  ON bookings (client_phone);

/* Row-locking readers used by triggers. They run as the schema owner (so a supervisor's narrow row policies
   don't block the lock) but enforce the caller's branch scope themselves — they can never cross a branch boundary. */
CREATE FUNCTION lock_booking(p_id bigint) RETURNS bookings LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b bookings; sc bigint := app_scope_branch();
BEGIN
    SELECT * INTO b FROM bookings WHERE id = p_id AND deleted_at IS NULL AND (sc IS NULL OR branch_id = sc) FOR UPDATE;
    RETURN b;
END $$;

CREATE FUNCTION bookings_biu() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE h halls;
BEGIN
    SELECT * INTO h FROM halls WHERE id = NEW.hall_id AND deleted_at IS NULL AND is_active;       -- hidden by RLS when it belongs to another branch
    IF h.id IS NULL THEN RAISE EXCEPTION 'hall % is not available in this branch', NEW.hall_id USING ERRCODE = '42501'; END IF;
    IF tg_op = 'INSERT' THEN
        NEW.branch_id := h.branch_id;
        NEW.created_by := app_user_id(); NEW.services_total := 0; NEW.paid_total := 0;
        NEW.status := 'confirmed'; NEW.closed_at := NULL; NEW.closed_by := NULL;
        IF NEW.event_date < venue_today() THEN RAISE EXCEPTION 'cannot create a contract for a past date'; END IF;
        RETURN NEW;
    END IF;

    IF NEW.contract_number <> OLD.contract_number THEN RAISE EXCEPTION 'contract_number is immutable'; END IF;
    IF h.branch_id <> OLD.branch_id THEN RAISE EXCEPTION 'a contract cannot move to a hall of another branch' USING ERRCODE = '42501'; END IF;
    NEW.branch_id := OLD.branch_id;
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
    branch_id       BIGINT NOT NULL REFERENCES branches(id),
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
   Runs as the schema owner: it only does arithmetic on rows the caller has already been authorised to touch. */
CREATE FUNCTION recalc_booking(p_booking bigint) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE bookings SET id = id WHERE id = p_booking;       -- bookings_biu recomputes the derived totals
    PERFORM recalc_settlement(id) FROM event_settlements WHERE booking_id = p_booking AND deleted_at IS NULL;
END $$;

CREATE FUNCTION booking_services_biu() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b bookings;
BEGIN
    b := lock_booking(NEW.booking_id);
    IF b.id IS NULL THEN RAISE EXCEPTION 'contract not found'; END IF;
    IF tg_op = 'UPDATE' THEN
        IF NEW.booking_id <> OLD.booking_id OR NEW.contract_number <> OLD.contract_number THEN
            RAISE EXCEPTION 'a service cannot be moved to another contract';
        END IF;
        NEW.branch_id := OLD.branch_id;
    ELSE
        NEW.contract_number := b.contract_number; NEW.branch_id := b.branch_id; NEW.added_by := app_user_id(); NEW.added_at := now();
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
CREATE FUNCTION booking_services_aiu() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    branch_id       BIGINT NOT NULL REFERENCES branches(id),
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
    b := lock_booking(NEW.booking_id);                    -- serialises concurrent receipts on the same contract
    IF b.id IS NULL THEN RAISE EXCEPTION 'contract not found'; END IF;
    IF tg_op = 'UPDATE' THEN
        IF NEW.booking_id <> OLD.booking_id OR NEW.contract_number <> OLD.contract_number OR NEW.receipt_number <> OLD.receipt_number THEN
            RAISE EXCEPTION 'receipt number, contract and contract number are immutable';
        END IF;
        NEW.branch_id := OLD.branch_id;
    ELSE
        NEW.contract_number := b.contract_number; NEW.branch_id := b.branch_id; NEW.received_by := app_user_id(); NEW.received_at := now();
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
CREATE FUNCTION payments_aiu() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    branch_id        BIGINT NOT NULL REFERENCES branches(id),
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
    branch_id       BIGINT NOT NULL REFERENCES branches(id),
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

CREATE FUNCTION lock_settlement(p_id bigint) RETURNS event_settlements LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s event_settlements; sc bigint := app_scope_branch();
BEGIN
    SELECT * INTO s FROM event_settlements WHERE id = p_id AND deleted_at IS NULL AND (sc IS NULL OR branch_id = sc) FOR UPDATE;
    RETURN s;
END $$;

/* Totals are recomputed by settlements_biu (never client-writable); touching the row is enough. */
CREATE FUNCTION recalc_settlement(p_settlement bigint) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN UPDATE event_settlements SET id = id WHERE id = p_settlement; END $$;

CREATE FUNCTION settlements_biu() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b bookings; sp profit_split_settings;
BEGIN
    b := lock_booking(NEW.booking_id);
    IF b.id IS NULL THEN RAISE EXCEPTION 'contract not found'; END IF;

    IF tg_op = 'INSERT' THEN
        IF b.status = 'cancelled' THEN RAISE EXCEPTION 'contract % is cancelled', b.contract_number; END IF;
        IF b.event_date > venue_today() THEN RAISE EXCEPTION 'settlement opens on the event day (%), not before', b.event_date; END IF;
        sp := active_split();
        IF sp.id IS NULL THEN RAISE EXCEPTION 'no profit-split percentages configured: the owner must set them first'; END IF;
        -- percentages always come from the owner-controlled configuration, whatever the client sent
        NEW.rental_pct := sp.rental_pct; NEW.marketing_pct := sp.marketing_pct;
        NEW.branch_id := b.branch_id; NEW.contract_number := b.contract_number; NEW.created_by := app_user_id();
        NEW.status := 'draft'; NEW.finalized_at := NULL; NEW.finalized_by := NULL; NEW.settled_on_event_day := NULL;
        NEW.total_expenses := 0;
        IF NEW.revenue_override IS NOT NULL AND NOT is_owner() THEN RAISE EXCEPTION 'only the owner may override revenue' USING ERRCODE = '42501'; END IF;
        NEW.total_revenue := COALESCE(NEW.revenue_override, b.total_amount);
        RETURN NEW;
    END IF;

    -- UPDATE ------------------------------------------------------------
    NEW.updated_at := now(); NEW.branch_id := OLD.branch_id;
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
CREATE FUNCTION settlements_au_close_booking() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
CREATE TRIGGER trg_set_audit AFTER INSERT OR UPDATE ON event_settlements FOR EACH ROW
    EXECUTE FUNCTION audit_row('updated_at','total_expenses','total_revenue','net_profit','rental_share','marketing_share');

CREATE FUNCTION expenses_biu() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s event_settlements;
BEGIN
    s := lock_settlement(NEW.settlement_id);
    IF s.id IS NULL THEN RAISE EXCEPTION 'settlement not found'; END IF;
    IF tg_op = 'UPDATE' THEN
        IF NEW.settlement_id <> OLD.settlement_id OR NEW.booking_id <> OLD.booking_id OR NEW.contract_number <> OLD.contract_number THEN
            RAISE EXCEPTION 'an expense cannot be moved to another settlement';
        END IF;
        NEW.branch_id := OLD.branch_id;
    ELSE
        NEW.booking_id := s.booking_id; NEW.contract_number := s.contract_number; NEW.branch_id := s.branch_id; NEW.entered_by := app_user_id();
    END IF;
    IF s.status = 'finalized' AND NOT is_owner() THEN
        RAISE EXCEPTION 'settlement of % is finalized: expenses are frozen', s.contract_number USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END $$;
CREATE FUNCTION expenses_aiu() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN PERFORM recalc_settlement(NEW.settlement_id); RETURN NULL; END $$;

CREATE TRIGGER trg_exp_biu   BEFORE INSERT OR UPDATE ON event_expenses FOR EACH ROW EXECUTE FUNCTION expenses_biu();
CREATE TRIGGER trg_exp_aiu   AFTER  INSERT OR UPDATE ON event_expenses FOR EACH ROW EXECUTE FUNCTION expenses_aiu();
CREATE TRIGGER trg_exp_del   BEFORE DELETE ON event_expenses FOR EACH ROW EXECUTE FUNCTION soft_delete_instead();
CREATE TRIGGER trg_exp_trunc BEFORE TRUNCATE ON event_expenses FOR EACH STATEMENT EXECUTE FUNCTION no_truncate();
CREATE TRIGGER trg_exp_audit AFTER INSERT OR UPDATE ON event_expenses FOR EACH ROW EXECUTE FUNCTION audit_row();

-- ---------------------------------------------------------------------
-- 9. Event-day operations checklist (catering / screens / sound ...) — used by field supervisors
-- ---------------------------------------------------------------------
CREATE TABLE event_checklist_items (
    id              BIGSERIAL PRIMARY KEY,
    branch_id       BIGINT NOT NULL REFERENCES branches(id),
    booking_id      BIGINT NOT NULL REFERENCES bookings(id),
    contract_number TEXT NOT NULL,
    category        TEXT NOT NULL CHECK (category IN ('catering','screens','sound','seating','cleaning','other')),
    title           TEXT NOT NULL,
    is_done         BOOLEAN NOT NULL DEFAULT FALSE,
    note            TEXT NOT NULL DEFAULT '',
    done_by         BIGINT REFERENCES users(id),
    done_at         TIMESTAMPTZ,
    created_by      BIGINT NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,
    deleted_by      BIGINT REFERENCES users(id)
);
CREATE INDEX idx_checklist_booking ON event_checklist_items (booking_id) WHERE deleted_at IS NULL;
CREATE FUNCTION checklist_biu() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b bookings;
BEGIN
    IF tg_op = 'INSERT' THEN
        b := lock_booking(NEW.booking_id);
        IF b.id IS NULL THEN RAISE EXCEPTION 'contract not found'; END IF;
        NEW.contract_number := b.contract_number; NEW.branch_id := b.branch_id; NEW.created_by := app_user_id();
        IF NEW.is_done THEN NEW.done_by := app_user_id(); NEW.done_at := now(); END IF;
    ELSE
        NEW.booking_id := OLD.booking_id; NEW.contract_number := OLD.contract_number; NEW.branch_id := OLD.branch_id;
        IF NEW.is_done AND NOT OLD.is_done THEN NEW.done_by := app_user_id(); NEW.done_at := now();
        ELSIF NOT NEW.is_done AND OLD.is_done THEN NEW.done_by := NULL; NEW.done_at := NULL; END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER trg_chk_biu   BEFORE INSERT OR UPDATE ON event_checklist_items FOR EACH ROW EXECUTE FUNCTION checklist_biu();
CREATE TRIGGER trg_chk_del   BEFORE DELETE ON event_checklist_items FOR EACH ROW EXECUTE FUNCTION soft_delete_instead();
CREATE TRIGGER trg_chk_trunc BEFORE TRUNCATE ON event_checklist_items FOR EACH STATEMENT EXECUTE FUNCTION no_truncate();

-- ---------------------------------------------------------------------
-- 10. Views & functions used by the dashboards
-- ---------------------------------------------------------------------
CREATE VIEW v_contracts WITH (security_invoker = true) AS
SELECT b.id, b.contract_number, b.branch_id, br.name_ar AS branch_name_ar, br.name_en AS branch_name_en,
       b.hall_id, h.name_ar AS hall_name_ar, h.name_en AS hall_name_en,
       b.client_name, b.client_phone, b.event_date, b.section, b.status,
       b.base_amount, b.discount, b.services_total, b.total_amount, b.paid_total, b.balance_due,
       (b.status = 'confirmed' AND b.event_date = venue_today())  AS settlement_due_today,
       (b.status = 'confirmed' AND b.event_date <  venue_today())  AS settlement_overdue,
       s.id AS settlement_id, s.status AS settlement_status, s.net_profit
FROM bookings b
JOIN halls h ON h.id = b.hall_id
JOIN branches br ON br.id = b.branch_id
LEFT JOIN event_settlements s ON s.booking_id = b.id AND s.deleted_at IS NULL
WHERE b.deleted_at IS NULL;

/* Quick search by contract number, client name or phone (runs under the caller's branch scope) */
CREATE FUNCTION search_contracts(q text, max_rows int DEFAULT 10) RETURNS SETOF v_contracts LANGUAGE sql STABLE AS $$
    SELECT * FROM v_contracts
    WHERE contract_number ILIKE '%' || btrim(q) || '%' OR client_name ILIKE '%' || btrim(q) || '%' OR client_phone LIKE '%' || btrim(q) || '%'
    ORDER BY event_date DESC LIMIT max_rows
$$;

/* Same archive with the (action / old_value / new_value) naming used by reporting tools. DBA use only. */
CREATE VIEW audit_trail AS
SELECT id, user_id, action_type AS action, "timestamp", table_name, record_id, branch_id, contract_number, severity,
       original_data AS old_value, new_data AS new_value
FROM audit_logs;

-- ---- owner-only security read models (SECURITY DEFINER: they deliberately see across branches) ----
CREATE FUNCTION assert_owner() RETURNS void LANGUAGE plpgsql STABLE AS $$
BEGIN IF app_role() <> 'owner' THEN RAISE EXCEPTION 'restricted to the owner' USING ERRCODE = '42501'; END IF; END $$;

CREATE FUNCTION owner_audit_review(p_contract text DEFAULT NULL, p_limit int DEFAULT 200, p_severity text DEFAULT NULL, p_branch bigint DEFAULT NULL)
RETURNS SETOF audit_logs LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    PERFORM assert_owner();
    RETURN QUERY SELECT * FROM audit_logs
        WHERE (p_contract IS NULL OR contract_number = p_contract)
          AND (p_severity IS NULL OR severity = p_severity OR (p_severity = 'flagged' AND severity <> 'info'))
          AND (p_branch IS NULL OR branch_id = p_branch)
        ORDER BY "timestamp" DESC, id DESC LIMIT p_limit;
END $$;

/* Everything that was "deleted" (soft) in financial records, across all branches */
CREATE FUNCTION owner_deleted_items(p_limit int DEFAULT 200)
RETURNS TABLE (table_name text, record_id bigint, branch_id bigint, contract_number text, description text, amount numeric,
               deleted_at timestamptz, deleted_by bigint, deleted_by_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    PERFORM assert_owner();
    RETURN QUERY
    SELECT x.t, x.id, x.bid, x.cn, x.descr, x.amt, x.dat, x.dby, u.full_name FROM (
        SELECT 'bookings'::text t, b.id, b.branch_id bid, b.contract_number cn, b.client_name descr, b.total_amount amt, b.deleted_at dat, b.deleted_by dby FROM bookings b WHERE b.deleted_at IS NOT NULL
        UNION ALL SELECT 'payments', p.id, p.branch_id, p.contract_number, p.receipt_number, p.amount, p.deleted_at, p.deleted_by FROM payments p WHERE p.deleted_at IS NOT NULL
        UNION ALL SELECT 'event_expenses', e.id, e.branch_id, e.contract_number, e.description, e.amount, e.deleted_at, e.deleted_by FROM event_expenses e WHERE e.deleted_at IS NOT NULL
        UNION ALL SELECT 'booking_services', s.id, s.branch_id, s.contract_number, s.name, s.line_total, s.deleted_at, s.deleted_by FROM booking_services s WHERE s.deleted_at IS NOT NULL
    ) x LEFT JOIN users u ON u.id = x.dby ORDER BY x.dat DESC LIMIT p_limit;
END $$;

/* Cross-branch financial inspection (ignores the branch switcher: always every branch) */
CREATE FUNCTION owner_branch_financials()
RETURNS TABLE (branch_id bigint, name_ar text, name_en text, contracts bigint, revenue numeric, paid numeric, outstanding numeric,
               expenses numeric, net_profit numeric, settled bigint, late_settlements bigint, deleted_items bigint, flagged_events bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    PERFORM assert_owner();
    RETURN QUERY
    SELECT br.id, br.name_ar, br.name_en,
        (SELECT count(*) FROM bookings b WHERE b.branch_id = br.id AND b.deleted_at IS NULL AND b.status <> 'cancelled'),
        COALESCE((SELECT sum(b.total_amount) FROM bookings b WHERE b.branch_id = br.id AND b.deleted_at IS NULL AND b.status <> 'cancelled'), 0),
        COALESCE((SELECT sum(b.paid_total) FROM bookings b WHERE b.branch_id = br.id AND b.deleted_at IS NULL AND b.status <> 'cancelled'), 0),
        COALESCE((SELECT sum(b.balance_due) FROM bookings b WHERE b.branch_id = br.id AND b.deleted_at IS NULL AND b.status = 'confirmed'), 0),
        COALESCE((SELECT sum(s.total_expenses) FROM event_settlements s WHERE s.branch_id = br.id AND s.deleted_at IS NULL), 0),
        COALESCE((SELECT sum(s.net_profit) FROM event_settlements s WHERE s.branch_id = br.id AND s.deleted_at IS NULL AND s.status = 'finalized'), 0),
        (SELECT count(*) FROM event_settlements s WHERE s.branch_id = br.id AND s.deleted_at IS NULL AND s.status = 'finalized'),
        (SELECT count(*) FROM bookings b WHERE b.branch_id = br.id AND b.deleted_at IS NULL AND b.status = 'confirmed' AND b.event_date < venue_today()),
        (SELECT count(*) FROM (SELECT 1 FROM bookings b WHERE b.branch_id = br.id AND b.deleted_at IS NOT NULL
                               UNION ALL SELECT 1 FROM payments p WHERE p.branch_id = br.id AND p.deleted_at IS NOT NULL
                               UNION ALL SELECT 1 FROM event_expenses e WHERE e.branch_id = br.id AND e.deleted_at IS NOT NULL
                               UNION ALL SELECT 1 FROM booking_services s WHERE s.branch_id = br.id AND s.deleted_at IS NOT NULL) d),
        (SELECT count(*) FROM audit_logs a WHERE a.branch_id = br.id AND a.severity <> 'info' AND a."timestamp" > now() - interval '30 days')
    FROM branches br WHERE br.deleted_at IS NULL ORDER BY br.id;
END $$;

-- ---------------------------------------------------------------------
-- 11. Row-level security: branch isolation + the supervisor's narrow view
-- ---------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['halls','bookings','booking_services','payments','event_settlements','event_expenses','event_checklist_items'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);   -- (not FORCE: the owner-run SECURITY DEFINER helpers must bypass)
        EXECUTE format($p$CREATE POLICY branch_scope ON %I
            USING ((SELECT app_scope_branch()) IS NULL OR branch_id = (SELECT app_scope_branch()))
            WITH CHECK ((SELECT app_scope_branch()) IS NULL OR branch_id = (SELECT app_scope_branch()))$p$, t);
    END LOOP;
END $$;
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
CREATE POLICY branch_scope ON branches USING ((SELECT app_scope_branch()) IS NULL OR id = (SELECT app_scope_branch()))
                                       WITH CHECK ((SELECT app_scope_branch()) IS NULL OR id = (SELECT app_scope_branch()));

-- Field supervisors: only today's active events, no contract money at all, expenses may be added but not changed.
CREATE POLICY sup_sel ON bookings AS RESTRICTIVE FOR SELECT
    USING ((SELECT app_role()) <> 'supervisor' OR (event_date = venue_today() AND status = 'confirmed' AND deleted_at IS NULL));
CREATE POLICY sup_ins ON bookings AS RESTRICTIVE FOR INSERT WITH CHECK ((SELECT app_role()) <> 'supervisor');
CREATE POLICY sup_upd ON bookings AS RESTRICTIVE FOR UPDATE USING ((SELECT app_role()) <> 'supervisor') WITH CHECK ((SELECT app_role()) <> 'supervisor');
CREATE POLICY sup_del ON bookings AS RESTRICTIVE FOR DELETE USING ((SELECT app_role()) <> 'supervisor');

CREATE POLICY sup_none ON booking_services AS RESTRICTIVE FOR ALL USING ((SELECT app_role()) <> 'supervisor') WITH CHECK ((SELECT app_role()) <> 'supervisor');
CREATE POLICY sup_none ON payments          AS RESTRICTIVE FOR ALL USING ((SELECT app_role()) <> 'supervisor') WITH CHECK ((SELECT app_role()) <> 'supervisor');

CREATE POLICY sup_ins ON event_settlements AS RESTRICTIVE FOR INSERT
    WITH CHECK ((SELECT app_role()) <> 'supervisor' OR EXISTS (SELECT 1 FROM bookings b WHERE b.id = booking_id));
CREATE POLICY sup_upd ON event_settlements AS RESTRICTIVE FOR UPDATE USING ((SELECT app_role()) <> 'supervisor') WITH CHECK ((SELECT app_role()) <> 'supervisor');
CREATE POLICY sup_del ON event_settlements AS RESTRICTIVE FOR DELETE USING ((SELECT app_role()) <> 'supervisor');

CREATE POLICY sup_sel ON event_expenses AS RESTRICTIVE FOR SELECT
    USING ((SELECT app_role()) <> 'supervisor' OR EXISTS (SELECT 1 FROM bookings b WHERE b.id = booking_id));
CREATE POLICY sup_ins ON event_expenses AS RESTRICTIVE FOR INSERT
    WITH CHECK ((SELECT app_role()) <> 'supervisor' OR EXISTS (SELECT 1 FROM bookings b WHERE b.id = booking_id));
CREATE POLICY sup_upd ON event_expenses AS RESTRICTIVE FOR UPDATE USING ((SELECT app_role()) <> 'supervisor') WITH CHECK ((SELECT app_role()) <> 'supervisor');
CREATE POLICY sup_del ON event_expenses AS RESTRICTIVE FOR DELETE USING ((SELECT app_role()) <> 'supervisor');

CREATE POLICY sup_visible ON event_checklist_items AS RESTRICTIVE FOR ALL
    USING ((SELECT app_role()) <> 'supervisor' OR EXISTS (SELECT 1 FROM bookings b WHERE b.id = booking_id))
    WITH CHECK ((SELECT app_role()) <> 'supervisor' OR EXISTS (SELECT 1 FROM bookings b WHERE b.id = booking_id));

-- ---------------------------------------------------------------------
-- 12. Database privileges. The application role can read/insert/update business tables, can NOT delete or truncate,
--     and can NOT read the security archives directly (only through the owner-checked functions above).
-- ---------------------------------------------------------------------
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qasr_app') THEN CREATE ROLE qasr_app NOLOGIN; END IF;
    BEGIN EXECUTE format('GRANT qasr_app TO %I', current_user); EXCEPTION WHEN OTHERS THEN NULL; END;   -- the login role must be allowed to SET ROLE qasr_app
END $$;
GRANT SELECT, INSERT, UPDATE ON branches, halls, bookings, booking_services, payments, event_settlements, event_expenses, event_checklist_items, services TO qasr_app;
GRANT SELECT, INSERT ON profit_split_settings TO qasr_app;
GRANT INSERT, UPDATE ON users TO qasr_app;                         -- guarded by users_guard (owner only)
GRANT SELECT ON v_contracts TO qasr_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO qasr_app;
REVOKE ALL ON audit_logs, audit_trail FROM PUBLIC, qasr_app;
REVOKE EXECUTE ON FUNCTION owner_audit_review(text, int, text, bigint), owner_deleted_items(int), owner_branch_financials() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION owner_audit_review(text, int, text, bigint), owner_deleted_items(int), owner_branch_financials() TO qasr_app;
-- (DELETE / TRUNCATE are never granted; the triggers above enforce soft delete even for the table owner.)
