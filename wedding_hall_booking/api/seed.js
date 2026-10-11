'use strict';
/* First-run seed: the owner (global), two branches with their managers and a supervisor, the venue profile,
   halls, the service catalogue and (optionally) demo contracts. */
const db = require('./kernel/db');
const { hashPassword, passwordOk, normPhone, generatePassword } = require('./modules/rbac/crypto');

async function seed({ demo = process.env.SEED_DEMO !== '0' } = {}) {
  const password = process.env.SEED_PASSWORD || generatePassword();
  if (!passwordOk(password)) throw new Error('SEED_PASSWORD must have 8+ characters including a letter and a digit');
  const hash = await hashPassword(password);
  const contact = (name, email, phone) => ({ email: process.env[`SEED_${name}_EMAIL`] || email, phone: process.env[`SEED_${name}_PHONE`] || phone || null });

  const owner = { id: (await db.systemTx((q) => q(
    `INSERT INTO users (username, full_name, role, password_hash, email, phone, phone_norm) VALUES ('owner','المالك','owner',$1,$2,$3,$4) RETURNING id`,
    [hash, contact('OWNER', 'owner@example.com').email, contact('OWNER').phone, contact('OWNER').phone ? normPhone(contact('OWNER').phone) : null])))[0].id, role: 'owner', scopeBranch: null };

  const ids = {};
  await db.tx(owner, async (q) => {
    ids.main = (await q(`INSERT INTO branches (code, name_ar, name_en, city) VALUES ('MAIN','الفرع الرئيسي','Main Branch','الرياض') RETURNING id`))[0].id;
    ids.north = (await q(`INSERT INTO branches (code, name_ar, name_en, city) VALUES ('NORTH','فرع الشمال','North Branch','حائل') RETURNING id`))[0].id;
    const user = async (username, name, role, branch, email, phone) => (await q(
      `INSERT INTO users (username, full_name, role, branch_id, password_hash, email, phone, phone_norm) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [username, name, role, branch, hash, email, phone || null, phone ? normPhone(phone) : null]))[0].id;
    const m = contact('MANAGER', 'manager@example.com', process.env.SEED_MANAGER_PHONE);
    ids.manager = await user('manager', 'مدير الفرع الرئيسي', 'manager', ids.main, m.email, m.phone);
    ids.northManager = await user('manager.north', 'مدير فرع الشمال', 'manager', ids.north, 'north@example.com');
    ids.supervisor = await user('supervisor', 'مشرف ميداني', 'supervisor', ids.main, 'supervisor@example.com');

    await q(`INSERT INTO venue_settings (name_ar, name_en, tagline_ar, tagline_en, logo_text, phone, email) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [
      process.env.VENUE_NAME_AR || 'قصر الأفراح', process.env.VENUE_NAME_EN || 'Al-Afrah Wedding Palace',
      process.env.VENUE_TAGLINE_AR || 'نظام إدارة العقود وتصفية المناسبات', process.env.VENUE_TAGLINE_EN || 'Contracts & event settlement management',
      process.env.VENUE_LOGO || '♛', process.env.VENUE_PHONE || '', process.env.VENUE_EMAIL || '']);
    const hall = async (branch, ar, en, men, women, price) => (await q(`INSERT INTO halls (branch_id, name_ar, name_en, capacity_men, capacity_women, base_price) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [branch, ar, en, men, women, price]))[0].id;
    ids.grand = await hall(ids.main, 'القاعة الكبرى', 'Grand Hall', 400, 350, 20000);
    ids.small = await hall(ids.main, 'القاعة الصغرى', 'Small Hall', 150, 120, 9000);
    ids.northHall = await hall(ids.north, 'قاعة الشمال', 'North Hall', 300, 300, 15000);
    for (const [name, price] of [['كوشة', 2500], ['تنسيق ورد', 3000], ['إضاءة خاصة', 1200], ['ضيافة إضافية', 400], ['زفّة', 1500], ['تصوير', 2200], ['نظافة إضافية', 600]]) {
      await q(`INSERT INTO services (name, default_price) VALUES ($1,$2)`, [name, price]);
    }
  });
  if (!demo) return { password, demo };

  const booking = (q) => async (hallId, offset, section, client, phone, base, discount) => (await q(
    `INSERT INTO bookings (hall_id, event_date, section, client_name, client_phone, base_amount, discount) VALUES ($1, venue_today() + $2::int, $3, $4, $5, $6, $7) RETURNING id`,
    [hallId, offset, section, client, phone, base, discount]))[0].id;
  const service = (q) => (id, name, qty, price) => q(`INSERT INTO booking_services (booking_id, name, quantity, unit_price) VALUES ($1,$2,$3,$4)`, [id, name, qty, price]);
  const pay = (q) => (id, amount, method, note) => q(`INSERT INTO payments (booking_id, amount, method, note) VALUES ($1,$2,$3,$4)`, [id, amount, method, note]);

  await db.tx(owner, async (q) => {
    await q(`INSERT INTO profit_split_settings (rental_pct, marketing_pct, note) VALUES (60, 40, 'demo default')`);
  });

  // ---- MAIN branch (as its manager) ----
  const mgr = { id: ids.manager, role: 'manager', scopeBranch: ids.main };
  await db.tx(mgr, async (q) => {
    const b = booking(q), s = service(q), p = pay(q);
    // today: the women's section still owes money; the men's section is fully settled
    const women = await b(ids.grand, 0, 'women', 'عائلة السالم', '0501112233', 14000, 0);
    await s(women, 'كوشة', 1, 2500); await s(women, 'تنسيق ورد', 1, 3000); await p(women, 9000, 'transfer', 'عربون');
    const men = await b(ids.grand, 0, 'men', 'عائلة الحربي', '0533344556', 9000, 0);
    await s(men, 'ضيافة إضافية', 5, 400); await p(men, 11000, 'cash', 'سداد كامل');
    const st = (await q(`INSERT INTO event_settlements (booking_id) VALUES ($1) RETURNING id`, [men]))[0].id;
    await q(`INSERT INTO event_expenses (settlement_id, category, description, amount) VALUES ($1,'labor','أجور 8 عمال',1600), ($1,'cleaning','نظافة وتعقيم',500)`, [st]);
    const wrong = (await q(`INSERT INTO event_expenses (settlement_id, category, description, amount) VALUES ($1,'other','إدخال خاطئ',9999) RETURNING id`, [st]))[0].id;
    await q(`UPDATE event_expenses SET deleted_at = now(), deleted_by = app_user_id() WHERE id = $1`, [wrong]);      // a voided entry for the security dashboard
    await q(`UPDATE event_settlements SET status = 'finalized' WHERE id = $1`, [st]);
    // an overdue contract, and two upcoming ones
    const late = await b(ids.small, 1, 'both', 'شركة النور للتجارة', '0555556677', 12000, 500);
    await s(late, 'كوشة', 1, 2500); await p(late, 5000, 'cash', 'عربون');
    await q(`UPDATE bookings SET event_date = venue_today() - 2 WHERE id = $1`, [late]);      // the event day passed without a settlement
    const next = await b(ids.small, 9, 'men', 'عائلة العتيبي', '0540001122', 9000, 0); await p(next, 3000, 'card', 'عربون');
    const later = await b(ids.grand, 21, 'both', 'عائلة القحطاني', '0566677889', 26000, 1000); await p(later, 8000, 'transfer', 'عربون');
  });

  // ---- NORTH branch (as its manager) ----
  await db.tx({ id: ids.northManager, role: 'manager', scopeBranch: ids.north }, async (q) => {
    const b = booking(q), s = service(q), p = pay(q);
    const today = await b(ids.northHall, 0, 'both', 'عائلة الشمري', '0511122233', 18000, 0);
    await s(today, 'زفّة', 1, 1500); await p(today, 6000, 'cash', 'عربون');
    const later = await b(ids.northHall, 6, 'both', 'عائلة الرشيدي', '0522233344', 15000, 0); await p(later, 4000, 'transfer', 'عربون');
  });
  return { password, demo };
}

module.exports = { seed, generatePassword };
