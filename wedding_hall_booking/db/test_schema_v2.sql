-- Behavioural tests for schema_v2.sql. Run after the schema on an EMPTY database:
--   psql -v ON_ERROR_STOP=1 -f schema_v2.sql -f test_schema_v2.sql
-- Any failed assertion aborts with an error; success ends with "ALL TESTS PASSED".

CREATE FUNCTION test_fails(stmt text, needle text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        EXECUTE stmt;
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT ILIKE '%' || needle || '%' THEN
            RAISE EXCEPTION 'wrong error for [%]: got "%", expected to contain "%"', stmt, SQLERRM, needle;
        END IF;
        RETURN;
    END;
    RAISE EXCEPTION 'expected failure but statement succeeded: %', stmt;
END $$;
CREATE FUNCTION test_as(uid int) RETURNS void LANGUAGE sql AS $$ SELECT set_config('app.user_id', uid::text, false) $$;

INSERT INTO users (id, username, full_name, role, password_hash) VALUES (1,'owner','المالك','owner','x');
SELECT set_config('app.user_id', '1', false);
INSERT INTO branches (id, code, name_ar, name_en) VALUES (1,'MAIN','الفرع الرئيسي','Main Branch'), (2,'NORTH','فرع الشمال','North Branch');
SELECT setval('branches_id_seq', 2);
INSERT INTO users (id, username, full_name, role, branch_id, password_hash) VALUES
    (2,'manager','مدير الفرع الرئيسي','manager',1,'x'), (3,'supervisor','مشرف ميداني','supervisor',1,'x'), (4,'manager2','مدير فرع الشمال','manager',2,'x');
SELECT setval('users_id_seq', 4);
INSERT INTO halls (id, branch_id, name_ar, name_en) VALUES (1, 1, 'القاعة الكبرى', 'Grand Hall'), (2, 1, 'القاعة الصغرى', 'Small Hall'), (3, 2, 'قاعة الشمال', 'North Hall');
SELECT setval('halls_id_seq', 3);
SELECT set_config('app.user_id', '', false);   -- from here on every test must identify itself

DO $$
DECLARE
    today date := venue_today();
    b1 bigint; b2 bigint; b3 bigint; b4 bigint; b5 bigint; b6 bigint; b7 bigint; pay1 bigint; svc1 bigint; st bigint; r record; n int;
BEGIN
    -- ---- no user attribution => no writes
    PERFORM test_fails($q$INSERT INTO bookings (hall_id, event_date, section, client_name, client_phone, base_amount) VALUES (1, current_date + 400, 'men', 'x', '1', 10)$q$, 'app.user_id');

    -- ---- split percentages: owner only
    PERFORM test_as(2);
    PERFORM test_fails($q$INSERT INTO profit_split_settings (rental_pct, marketing_pct) VALUES (50, 50)$q$, 'only the owner');
    PERFORM test_as(1);
    PERFORM test_fails($q$INSERT INTO profit_split_settings (rental_pct, marketing_pct) VALUES (70, 40)$q$, 'split_sums_to_100');
    INSERT INTO profit_split_settings (rental_pct, marketing_pct, note) VALUES (60, 40, 'initial');
    PERFORM test_fails($q$UPDATE profit_split_settings SET rental_pct = 10, marketing_pct = 90$q$, 'append-only');

    -- ---- booking, contract number, double-booking rules
    PERFORM test_as(2);
    INSERT INTO bookings (hall_id, event_date, section, client_name, client_phone, base_amount) VALUES (1, today + 30, 'women', 'عائلة السالم', '0501', 10000) RETURNING id INTO b1;
    SELECT * INTO r FROM bookings WHERE id = b1;
    ASSERT r.contract_number ~ '^C-\d{4}-\d{5}$', 'contract number format';
    ASSERT r.total_amount = 10000 AND r.balance_due = 10000, 'initial totals';
    PERFORM test_fails(format($q$INSERT INTO bookings (hall_id, event_date, section, client_name, client_phone, base_amount) VALUES (1, %L, 'both', 'y', '2', 5)$q$, today + 30), 'no_double_booking');
    INSERT INTO bookings (hall_id, event_date, section, client_name, client_phone, base_amount) VALUES (1, today + 30, 'men', 'نفس اليوم قسم الرجال', '0502', 8000) RETURNING id INTO b2;
    PERFORM test_fails(format($q$INSERT INTO bookings (hall_id, event_date, section, client_name, client_phone, base_amount) VALUES (1, %L, 'men', 'z', '3', 5)$q$, today + 30), 'no_double_booking');
    PERFORM test_fails($q$INSERT INTO bookings (hall_id, event_date, section, client_name, client_phone, base_amount) VALUES (1, current_date - 3, 'men', 'past', '4', 5)$q$, 'past date');
    UPDATE bookings SET status = 'cancelled' WHERE id = b2;
    INSERT INTO bookings (hall_id, event_date, section, client_name, client_phone, base_amount) VALUES (1, today + 30, 'men', 'يحل محل الملغى', '0503', 8000);   -- slot freed

    -- ---- halls are independent calendars; only the owner manages halls
    INSERT INTO bookings (hall_id, event_date, section, client_name, client_phone, base_amount) VALUES (2, today + 30, 'both', 'القاعة الصغرى نفس اليوم', '0507', 100);
    PERFORM test_fails($q$INSERT INTO halls (branch_id, name_ar, name_en) VALUES (1, 'x', 'x')$q$, 'only the owner');
    PERFORM test_as(1); INSERT INTO halls (branch_id, name_ar, name_en) VALUES (1, 'قاعة ثالثة', 'Third Hall'); PERFORM test_as(2);

    -- ---- services added later bind to the contract and recalc totals instantly
    INSERT INTO booking_services (booking_id, name, quantity, unit_price) VALUES (b1, 'كوشة', 1, 2500) RETURNING id INTO svc1;
    INSERT INTO booking_services (booking_id, name, quantity, unit_price) VALUES (b1, 'ضيافة إضافية', 3, 400);
    SELECT * INTO r FROM bookings WHERE id = b1;
    ASSERT r.services_total = 3700 AND r.total_amount = 13700 AND r.balance_due = 13700, format('services recalculation: %s/%s', r.services_total, r.total_amount);
    ASSERT (SELECT bool_and(contract_number = r.contract_number) FROM booking_services WHERE booking_id = b1), 'service bound to contract number';

    -- ---- receipts: auto contract number, partial payments, no overpayment
    INSERT INTO payments (booking_id, amount, method, note) VALUES (b1, 5000, 'cash', 'عربون') RETURNING id INTO pay1;
    INSERT INTO payments (booking_id, amount, method) VALUES (b1, 2000, 'card');
    SELECT * INTO r FROM bookings WHERE id = b1;
    ASSERT r.paid_total = 7000 AND r.balance_due = 6700, 'partial payments';
    ASSERT (SELECT contract_number FROM payments WHERE id = pay1) = r.contract_number, 'receipt mapped to contract';
    ASSERT (SELECT receipt_number FROM payments WHERE id = pay1) ~ '^R-\d{4}-\d{6}$', 'receipt number format';
    PERFORM test_fails(format($q$INSERT INTO payments (booking_id, amount, method) VALUES (%s, 6700.01, 'cash')$q$, b1), 'exceeds the balance');
    PERFORM test_fails(format($q$UPDATE payments SET booking_id = %s WHERE id = %s$q$, b2, pay1), 'immutable');

    -- ---- hard delete is impossible: it becomes a soft delete + archive
    DELETE FROM payments WHERE id = pay1;
    ASSERT (SELECT deleted_at IS NOT NULL AND deleted_by = 2 FROM payments WHERE id = pay1), 'delete became soft delete';
    SELECT * INTO r FROM bookings WHERE id = b1;
    ASSERT r.paid_total = 2000, 'soft-deleted receipt no longer counted';
    SELECT * INTO r FROM audit_logs WHERE table_name = 'payments' AND record_id = pay1 AND action_type = 'SOFT_DELETE';
    ASSERT r.id IS NOT NULL AND r.user_id = 2 AND r.original_data->>'deleted_at' IS NULL AND r.new_data->>'deleted_at' IS NOT NULL, 'audit has original and new data';
    PERFORM test_fails(format($q$DELETE FROM bookings WHERE id = %s$q$, b2), 'frozen');   -- cancelled contracts are frozen for the manager
    INSERT INTO bookings (hall_id, event_date, section, client_name, client_phone, base_amount) VALUES (1, today + 90, 'men', 'سيُحذف', '0509', 1) RETURNING id INTO b5;
    DELETE FROM bookings WHERE id = b5;                                          -- manager "deletes" an open contract without receipts
    ASSERT (SELECT deleted_at IS NOT NULL FROM bookings WHERE id = b5), 'booking row survives DELETE as a soft delete';
    ASSERT (SELECT count(*) FROM audit_logs WHERE table_name = 'bookings' AND record_id = b5 AND action_type = 'SOFT_DELETE') = 1, 'contract deletion archived';
    ASSERT NOT EXISTS (SELECT 1 FROM v_contracts WHERE id = b5), 'soft-deleted contract hidden from dashboard view';
    PERFORM test_fails($q$TRUNCATE bookings$q$, 'foreign key');          -- blocked by Postgres itself (referenced table)
    PERFORM test_fails($q$TRUNCATE payments$q$, 'forbidden');            -- blocked by our trigger
    PERFORM test_fails($q$TRUNCATE audit_logs$q$, 'append-only');
    PERFORM test_fails($q$DELETE FROM audit_logs$q$, 'append-only');
    PERFORM test_fails($q$UPDATE audit_logs SET action_type = 'UPDATE'$q$, 'append-only');
    PERFORM test_fails(format($q$DELETE FROM bookings WHERE id = %s$q$, b1), 'receipts');   -- has live receipts: manager must cancel instead (raised inside the soft-delete UPDATE)
    -- derived-only changes must not flood the audit log
    SELECT count(*) INTO n FROM audit_logs WHERE table_name = 'bookings' AND record_id = b1 AND action_type = 'UPDATE';
    ASSERT n = 0, 'recalculation is not an audit event';
    UPDATE bookings SET discount = 700 WHERE id = b1;   -- real change
    SELECT count(*) INTO n FROM audit_logs WHERE table_name = 'bookings' AND record_id = b1 AND action_type = 'UPDATE';
    ASSERT n = 1, 'real change is logged';
    UPDATE bookings SET discount = 0 WHERE id = b1;

    -- ---- derived columns cannot be forged by a client
    UPDATE bookings SET paid_total = 0, services_total = 0 WHERE id = b1;
    SELECT * INTO r FROM bookings WHERE id = b1;
    ASSERT r.paid_total = 2000 AND r.services_total = 3700, 'forged totals are ignored';

    -- ---- audit review is owner-only
    PERFORM test_fails($q$SELECT * FROM owner_audit_review()$q$, 'restricted to the owner');
    PERFORM test_as(1);
    ASSERT (SELECT count(*) FROM owner_audit_review()) > 0, 'owner can review audit';
    PERFORM test_as(2);

    -- ---- event day: settlement can't open early, services frozen after the day
    PERFORM test_fails(format($q$INSERT INTO event_settlements (booking_id) VALUES (%s)$q$, b1), 'event day');
    INSERT INTO bookings (hall_id, event_date, section, client_name, client_phone, base_amount) VALUES (1, today, 'both', 'حفل اليوم', '0505', 20000) RETURNING id INTO b3;
    INSERT INTO booking_services (booking_id, name, quantity, unit_price) VALUES (b3, 'تنسيق ورد', 1, 3000);   -- allowed on the day
    SELECT * INTO r FROM v_contracts WHERE id = b3;
    ASSERT r.settlement_due_today AND NOT r.settlement_overdue, 'dashboard flags settlement due today';
    INSERT INTO payments (booking_id, amount, method) VALUES (b3, 10000, 'transfer');

    -- ---- settlement: percentages come from the owner's config, expenses -> net profit -> split
    INSERT INTO event_settlements (booking_id, rental_pct, marketing_pct) VALUES (b3, 1, 99) RETURNING id INTO st;   -- manager tries to inject 1/99
    SELECT * INTO r FROM event_settlements WHERE id = st;
    ASSERT r.rental_pct = 60 AND r.marketing_pct = 40, 'client-supplied percentages ignored';
    ASSERT r.total_revenue = 23000 AND r.net_profit = 23000, 'revenue snapshot';
    INSERT INTO event_expenses (settlement_id, category, description, amount) VALUES (st, 'labor', 'أجور 10 عمال', 2000);
    INSERT INTO event_expenses (settlement_id, category, description, amount) VALUES (st, 'cleaning', 'نظافة', 500.50);
    INSERT INTO event_expenses (settlement_id, category, description, amount) VALUES (st, 'consumables', 'مستهلكات', 499.50);
    SELECT * INTO r FROM event_settlements WHERE id = st;
    ASSERT r.total_expenses = 3000 AND r.net_profit = 20000 AND r.rental_share = 12000 AND r.marketing_share = 8000, format('profit split: %s %s %s', r.total_expenses, r.net_profit, r.rental_share);
    PERFORM test_fails(format($q$UPDATE event_settlements SET rental_pct = 90, marketing_pct = 10 WHERE id = %s$q$, st), 'only the owner');
    PERFORM test_fails(format($q$UPDATE event_settlements SET revenue_override = 99999, override_reason = 'x' WHERE id = %s$q$, st), 'only the owner');
    UPDATE event_settlements SET total_expenses = 0, total_revenue = 999999 WHERE id = st;   -- manager forging totals
    SELECT * INTO r FROM event_settlements WHERE id = st;
    ASSERT r.total_expenses = 3000 AND r.total_revenue = 23000, 'forged settlement totals are ignored';
    PERFORM test_fails(format($q$UPDATE event_settlements SET status = 'finalized' WHERE id = %s$q$, st), 'balance due');
    -- an expense entered by mistake: deleting archives it and the totals follow
    INSERT INTO event_expenses (settlement_id, category, description, amount) VALUES (st, 'other', 'خطأ إدخال', 777) RETURNING id INTO n;
    ASSERT (SELECT total_expenses FROM event_settlements WHERE id = st) = 3777, 'expense counted';
    DELETE FROM event_expenses WHERE id = n;
    ASSERT (SELECT total_expenses FROM event_settlements WHERE id = st) = 3000, 'soft-deleted expense not counted';
    ASSERT (SELECT count(*) FROM audit_logs WHERE table_name = 'event_expenses' AND record_id = n AND action_type = 'SOFT_DELETE') = 1, 'expense deletion archived';

    -- ---- same-day closure: full payment, then finalize closes the contract
    INSERT INTO payments (booking_id, amount, method) VALUES (b3, 13000, 'cash');
    UPDATE event_settlements SET status = 'finalized' WHERE id = st;
    SELECT * INTO r FROM event_settlements WHERE id = st;
    ASSERT r.status = 'finalized' AND r.settled_on_event_day AND r.finalized_by = 2, 'finalized on the event day';
    ASSERT (SELECT status FROM bookings WHERE id = b3) = 'closed', 'contract closed';
    PERFORM test_fails(format($q$INSERT INTO booking_services (booking_id, name, quantity, unit_price) VALUES (%s, 'متأخر', 1, 10)$q$, b3), 'can no longer be changed');
    PERFORM test_fails(format($q$INSERT INTO event_expenses (settlement_id, category, description, amount) VALUES (%s, 'other', 'متأخر', 10)$q$, st), 'frozen');
    PERFORM test_fails(format($q$UPDATE bookings SET base_amount = 1 WHERE id = %s$q$, b3), 'frozen');

    -- ---- owner: split changes apply to NEW settlements only; override needs a reason; everything audited
    PERFORM test_as(1);
    INSERT INTO profit_split_settings (rental_pct, marketing_pct) VALUES (50, 50);
    ASSERT (SELECT rental_pct FROM event_settlements WHERE id = st) = 60, 'history not rewritten by new split';
    PERFORM test_fails(format($q$UPDATE event_settlements SET revenue_override = 21000 WHERE id = %s$q$, st), 'override_needs_reason');
    UPDATE event_settlements SET revenue_override = 21000, override_reason = 'خصم متفق عليه' WHERE id = st;
    SELECT * INTO r FROM event_settlements WHERE id = st;
    ASSERT r.total_revenue = 21000 AND r.net_profit = 18000 AND r.rental_share = 10800, 'owner override recalculates';
    UPDATE event_settlements SET rental_pct = 70, marketing_pct = 30 WHERE id = st;   -- owner may adjust a settlement's percentages
    ASSERT (SELECT rental_share FROM event_settlements WHERE id = st) = 12600, 'owner edits split';
    ASSERT (SELECT count(*) FROM audit_logs WHERE table_name = 'event_settlements' AND action_type = 'UPDATE' AND user_id = 1) >= 2, 'owner overrides audited';

    -- ---- after the event day the manager can't extend an open contract
    PERFORM test_as(2);
    INSERT INTO bookings (hall_id, event_date, section, client_name, client_phone, base_amount) VALUES (1, today + 60, 'women', 'متأخر', '0506', 100) RETURNING id INTO b4;
    UPDATE bookings SET event_date = today - 1 WHERE id = b4;      -- simulate the day having passed
    PERFORM test_fails(format($q$INSERT INTO booking_services (booking_id, name, quantity, unit_price) VALUES (%s, 'x', 1, 1)$q$, b4), 'has passed');
    ASSERT (SELECT settlement_overdue FROM v_contracts WHERE id = b4), 'overdue flag';
    ASSERT (SELECT count(*) FROM search_contracts('C-')) > 0 AND (SELECT count(*) FROM search_contracts('حفل اليوم')) = 1, 'quick search';

    -- =================================================================
    -- Multi-branch isolation and the supervisor's narrow view (run as the application role so RLS applies)
    -- =================================================================
    PERFORM test_as(4);   -- manager of the NORTH branch
    INSERT INTO bookings (hall_id, event_date, section, client_name, client_phone, base_amount) VALUES (3, today + 30, 'both', 'عميل الشمال', '0601', 5000) RETURNING id INTO b6;
    ASSERT (SELECT branch_id FROM bookings WHERE id = b6) = 2, 'branch is taken from the hall';
    PERFORM test_as(2);   -- manager of the MAIN branch: today's second event in the small hall for the supervisor tests
    INSERT INTO bookings (hall_id, event_date, section, client_name, client_phone, base_amount) VALUES (2, today, 'both', 'حفل اليوم - الصغرى', '0602', 3000) RETURNING id INTO b7;
    INSERT INTO booking_services (booking_id, name, quantity, unit_price) VALUES (b7, 'خدمة', 1, 100);

    SET ROLE qasr_app;
    PERFORM test_as(2);
    ASSERT (SELECT count(*) FROM bookings WHERE id = b6) = 0, 'branch manager cannot see another branch''s contract';
    ASSERT (SELECT count(*) FROM bookings WHERE branch_id <> 1) = 0 AND (SELECT count(*) FROM halls WHERE branch_id <> 1) = 0, 'only own branch rows are visible';
    ASSERT (SELECT count(*) FROM branches) = 1, 'only own branch is visible';
    PERFORM test_fails(format($q$INSERT INTO bookings (hall_id, event_date, section, client_name, client_phone, base_amount) VALUES (3, %L, 'men', 'x', '1', 1)$q$, today + 70), 'not available in this branch');
    PERFORM test_fails(format($q$INSERT INTO payments (booking_id, amount, method) VALUES (%s, 1, 'cash')$q$, b6), 'contract not found');
    PERFORM test_fails(format($q$INSERT INTO booking_services (booking_id, name, quantity, unit_price) VALUES (%s, 'x', 1, 1)$q$, b6), 'contract not found');
    PERFORM test_fails(format($q$INSERT INTO event_settlements (booking_id) VALUES (%s)$q$, b6), 'contract not found');
    UPDATE bookings SET client_name = 'محاولة تعديل' WHERE id = b6; GET DIAGNOSTICS n = ROW_COUNT;
    ASSERT n = 0, 'cannot modify another branch''s contract';
    ASSERT (SELECT count(*) FROM v_contracts WHERE branch_id <> 1) = 0 AND (SELECT count(*) FROM search_contracts('الشمال')) = 0, 'views and search respect the branch scope';
    PERFORM test_fails($q$SELECT * FROM audit_logs$q$, 'permission denied');
    PERFORM test_fails($q$SELECT password_hash FROM users$q$, 'permission denied');
    PERFORM test_fails($q$DELETE FROM payments$q$, 'permission denied');

    PERFORM test_as(4);   -- the other branch's manager sees only theirs
    ASSERT (SELECT count(*) FROM bookings) = 1 AND (SELECT branch_id FROM bookings LIMIT 1) = 2, 'north manager sees only north';

    PERFORM test_as(1);   -- owner: all branches, or one via the switcher
    ASSERT (SELECT count(DISTINCT branch_id) FROM bookings) = 2, 'owner sees all branches';
    PERFORM set_config('app.scope_branch', '2', false);
    ASSERT (SELECT count(DISTINCT branch_id) FROM bookings) = 1 AND (SELECT count(*) FROM halls) = 1, 'owner can scope to one branch';
    PERFORM set_config('app.scope_branch', 'ALL', false);
    ASSERT (SELECT count(*) FROM owner_branch_financials()) = 2, 'owner inspects every branch';
    ASSERT (SELECT count(*) FROM owner_deleted_items()) > 0 AND (SELECT count(*) FROM owner_audit_review(NULL, 50, 'flagged')) > 0, 'flagged items + soft-deleted items are reviewable';
    PERFORM set_config('app.scope_branch', '', false);

    -- field supervisor (branch MAIN): only today's active events, no money, can add expenses but not change them
    PERFORM test_as(3);
    ASSERT (SELECT count(*) FROM bookings) = 1 AND (SELECT id FROM bookings LIMIT 1) = b7, 'supervisor sees only today''s active events of own branch';
    ASSERT (SELECT count(*) FROM payments) = 0 AND (SELECT count(*) FROM booking_services) = 0, 'supervisor sees no payments or priced services';
    PERFORM test_fails(format($q$INSERT INTO payments (booking_id, amount, method) VALUES (%s, 1, 'cash')$q$, b7), 'row-level security');
    PERFORM test_fails(format($q$INSERT INTO bookings (hall_id, event_date, section, client_name, client_phone, base_amount) VALUES (1, %L, 'men', 'x', '1', 1)$q$, today + 80), 'row-level security');
    UPDATE bookings SET client_name = 'x' WHERE id = b7; GET DIAGNOSTICS n = ROW_COUNT; ASSERT n = 0, 'supervisor cannot edit contracts';
    INSERT INTO event_settlements (booking_id) VALUES (b7) RETURNING id INTO st;
    INSERT INTO event_expenses (settlement_id, category, description, amount) VALUES (st, 'labor', 'أجور اليوم', 700) RETURNING id INTO pay1;
    ASSERT (SELECT total_expenses FROM event_settlements WHERE id = st) = 700, 'supervisor expense is totalled';
    UPDATE event_expenses SET amount = 1 WHERE id = pay1; GET DIAGNOSTICS n = ROW_COUNT; ASSERT n = 0, 'supervisor cannot change an entered expense';
    UPDATE event_settlements SET status = 'finalized' WHERE id = st; GET DIAGNOSTICS n = ROW_COUNT; ASSERT n = 0, 'supervisor cannot finalize';
    INSERT INTO event_checklist_items (booking_id, category, title) VALUES (b7, 'catering', 'تجهيز البوفيه') RETURNING id INTO n;
    UPDATE event_checklist_items SET is_done = true WHERE id = n;
    ASSERT (SELECT done_by FROM event_checklist_items WHERE id = n) = 3, 'checklist records who ticked it';
    PERFORM test_fails($q$SELECT * FROM owner_audit_review()$q$, 'restricted to the owner');
    RESET ROLE;
END $$;

DROP FUNCTION test_fails(text, text);
DROP FUNCTION test_as(int);
SELECT 'ALL TESTS PASSED' AS result;
