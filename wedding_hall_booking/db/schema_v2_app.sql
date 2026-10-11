-- =====================================================================
-- Application tables layered on schema_v2.sql (apply AFTER it):
--   * users: contact details for password recovery, preferred language, lockout counters
--   * sessions (token hashes only), password_resets (code hashes only)
--   * login_logs / security_events: append-only security journals (Super Admin dashboard)
--   * venue_settings: the brand shown on the login page
-- =====================================================================

ALTER TABLE users
    ADD COLUMN email      TEXT,
    ADD COLUMN phone      TEXT,
    ADD COLUMN phone_norm TEXT,                              -- digits only, used for lookup
    ADD COLUMN lang       TEXT NOT NULL DEFAULT 'ar' CHECK (lang IN ('ar','en')),
    ADD COLUMN failed_logins INT NOT NULL DEFAULT 0,
    ADD COLUMN locked_until  TIMESTAMPTZ;
CREATE UNIQUE INDEX uq_users_email ON users (lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX uq_users_phone ON users (phone_norm)   WHERE phone_norm IS NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_has_contact CHECK (email IS NOT NULL OR phone IS NOT NULL);

CREATE TABLE sessions (
    id           BIGSERIAL PRIMARY KEY,
    token_hash   TEXT NOT NULL UNIQUE,                       -- sha256 of the JWT id (jti); the JWT itself is never stored
    user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    branch_id    BIGINT REFERENCES branches(id),             -- scope granted at login (NULL = ALL, owner only)
    ip_address   TEXT,
    device_info  TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions (user_id);

CREATE TABLE password_resets (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash  TEXT NOT NULL,                                -- sha256(user_id:code)
    channel    TEXT NOT NULL CHECK (channel IN ('email','sms')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    attempts   INT NOT NULL DEFAULT 0,
    used_at    TIMESTAMPTZ
);
CREATE INDEX idx_resets_user ON password_resets (user_id, created_at DESC);

-- ---------------------------------------------------------------------
-- Security journals (append-only; written by the API's inspection layer, read by the owner only)
-- ---------------------------------------------------------------------
CREATE TABLE login_logs (
    id                 BIGSERIAL PRIMARY KEY,
    user_id            BIGINT REFERENCES users(id),           -- NULL when the username does not exist
    username_attempted TEXT,
    event_type         TEXT NOT NULL DEFAULT 'login' CHECK (event_type IN ('login','logout','recovery_request','password_reset')),
    success            BOOLEAN NOT NULL,
    failure_reason     TEXT,                                  -- bad_credentials | locked | inactive | branch_mismatch | rate_limited
    ip_address         TEXT,
    device_info        TEXT,
    assigned_branch_id BIGINT REFERENCES branches(id),        -- the user's branch (NULL = global owner)
    requested_branch   TEXT,                                  -- what the login form asked for ('ALL' or a branch id)
    "timestamp"        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_login_time ON login_logs ("timestamp" DESC);
CREATE INDEX idx_login_user ON login_logs (user_id, "timestamp" DESC);

CREATE TABLE security_events (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT REFERENCES users(id),
    event_type  TEXT NOT NULL,                                -- PERMISSION_DENIED | BRANCH_VIOLATION | UNAUTHENTICATED_ACCESS | SESSION_REVOKED ...
    method      TEXT,
    path        TEXT,
    ip_address  TEXT,
    branch_id   BIGINT,
    detail      TEXT,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_secev_time ON security_events ("timestamp" DESC);

CREATE FUNCTION journal_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only (% rejected)', tg_table_name, tg_op USING ERRCODE = '42501'; END $$;
CREATE TRIGGER trg_login_logs_immutable BEFORE UPDATE OR DELETE ON login_logs FOR EACH ROW EXECUTE FUNCTION journal_immutable();
CREATE TRIGGER trg_login_logs_trunc     BEFORE TRUNCATE ON login_logs FOR EACH STATEMENT EXECUTE FUNCTION journal_immutable();
CREATE TRIGGER trg_secev_immutable      BEFORE UPDATE OR DELETE ON security_events FOR EACH ROW EXECUTE FUNCTION journal_immutable();
CREATE TRIGGER trg_secev_trunc          BEFORE TRUNCATE ON security_events FOR EACH STATEMENT EXECUTE FUNCTION journal_immutable();

CREATE FUNCTION owner_login_history(p_limit int DEFAULT 200, p_user bigint DEFAULT NULL, p_only_failed boolean DEFAULT false)
RETURNS TABLE (id bigint, user_id bigint, username text, full_name text, event_type text, success boolean, failure_reason text,
               ip_address text, device_info text, assigned_branch_id bigint, requested_branch text, "timestamp" timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    PERFORM assert_owner();
    RETURN QUERY SELECT l.id, l.user_id, COALESCE(u.username, l.username_attempted), u.full_name, l.event_type, l.success, l.failure_reason,
                        l.ip_address, l.device_info, l.assigned_branch_id, l.requested_branch, l."timestamp"
                 FROM login_logs l LEFT JOIN users u ON u.id = l.user_id
                 WHERE (p_user IS NULL OR l.user_id = p_user) AND (NOT p_only_failed OR NOT l.success)
                 ORDER BY l."timestamp" DESC, l.id DESC LIMIT p_limit;
END $$;

CREATE FUNCTION owner_security_events(p_limit int DEFAULT 200)
RETURNS TABLE (id bigint, user_id bigint, full_name text, event_type text, method text, path text, ip_address text, branch_id bigint, detail text, "timestamp" timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    PERFORM assert_owner();
    RETURN QUERY SELECT e.id, e.user_id, u.full_name, e.event_type, e.method, e.path, e.ip_address, e.branch_id, e.detail, e."timestamp"
                 FROM security_events e LEFT JOIN users u ON u.id = e.user_id ORDER BY e."timestamp" DESC, e.id DESC LIMIT p_limit;
END $$;

CREATE FUNCTION owner_active_sessions()
RETURNS TABLE (id bigint, user_id bigint, username text, full_name text, role user_role, branch_id bigint, ip_address text, device_info text,
               created_at timestamptz, last_seen_at timestamptz, expires_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    PERFORM assert_owner();
    RETURN QUERY SELECT s.id, s.user_id, u.username, u.full_name, u.role, u.branch_id, s.ip_address, s.device_info, s.created_at, s.last_seen_at, s.expires_at
                 FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.expires_at > now() ORDER BY s.last_seen_at DESC;
END $$;

CREATE FUNCTION owner_security_overview()
RETURNS TABLE (critical_7d bigint, warnings_7d bigint, failed_logins_24h bigint, logins_24h bigint, soft_deleted bigint, active_sessions bigint,
               security_events_7d bigint, branch_violations_7d bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    PERFORM assert_owner();
    RETURN QUERY SELECT
        (SELECT count(*) FROM audit_logs a WHERE a.severity = 'critical' AND a."timestamp" > now() - interval '7 days'),
        (SELECT count(*) FROM audit_logs a WHERE a.severity = 'warning'  AND a."timestamp" > now() - interval '7 days'),
        (SELECT count(*) FROM login_logs l WHERE l.event_type = 'login' AND NOT l.success AND l."timestamp" > now() - interval '24 hours'),
        (SELECT count(*) FROM login_logs l WHERE l.event_type = 'login' AND l.success AND l."timestamp" > now() - interval '24 hours'),
        (SELECT count(*) FROM owner_deleted_items(100000)),
        (SELECT count(*) FROM sessions s WHERE s.expires_at > now()),
        (SELECT count(*) FROM security_events e WHERE e."timestamp" > now() - interval '7 days'),
        (SELECT count(*) FROM security_events e WHERE e.event_type = 'BRANCH_VIOLATION' AND e."timestamp" > now() - interval '7 days');
END $$;

-- ---------------------------------------------------------------------
-- The venue this installation belongs to (exactly one row). Shown on the login page. Owner only; audited.
-- ---------------------------------------------------------------------
CREATE TABLE venue_settings (
    id          INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    name_ar     TEXT NOT NULL,
    name_en     TEXT NOT NULL,
    tagline_ar  TEXT NOT NULL DEFAULT '',
    tagline_en  TEXT NOT NULL DEFAULT '',
    logo_text   TEXT NOT NULL DEFAULT '♛',                   -- a short glyph/initial shown as the logo
    phone       TEXT NOT NULL DEFAULT '',
    email       TEXT NOT NULL DEFAULT '',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE FUNCTION venue_settings_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF tg_op = 'DELETE' THEN RAISE EXCEPTION 'venue settings cannot be deleted' USING ERRCODE = '42501'; END IF;
    IF NOT is_owner() THEN RAISE EXCEPTION 'only the owner may change venue settings' USING ERRCODE = '42501'; END IF;
    NEW.updated_at := now();
    RETURN NEW;
END $$;
CREATE TRIGGER trg_venue_guard BEFORE INSERT OR UPDATE OR DELETE ON venue_settings FOR EACH ROW EXECUTE FUNCTION venue_settings_guard();
CREATE TRIGGER trg_venue_audit AFTER INSERT OR UPDATE ON venue_settings FOR EACH ROW EXECUTE FUNCTION audit_row('updated_at');
CREATE TRIGGER trg_venue_trunc BEFORE TRUNCATE ON venue_settings FOR EACH STATEMENT EXECUTE FUNCTION no_truncate();

/* Public (pre-login) branding for the login page — nothing sensitive. */
CREATE VIEW v_public_venue AS
SELECT name_ar, name_en, tagline_ar, tagline_en, logo_text FROM venue_settings WHERE id = 1;

-- ---------------------------------------------------------------------
-- Privileges for the application role (see schema_v2.sql section 12)
-- ---------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON venue_settings TO qasr_app;
REVOKE SELECT ON users FROM qasr_app;
GRANT SELECT (id, username, full_name, role, branch_id, is_active, created_at, email, phone, lang) ON users TO qasr_app;   -- never password_hash
REVOKE ALL ON sessions, password_resets, login_logs, security_events FROM PUBLIC, qasr_app;                                -- only the API's system connection touches these
REVOKE EXECUTE ON FUNCTION owner_login_history(int, bigint, boolean), owner_security_events(int), owner_active_sessions(), owner_security_overview() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION owner_login_history(int, bigint, boolean), owner_security_events(int), owner_active_sessions(), owner_security_overview() TO qasr_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO qasr_app;
