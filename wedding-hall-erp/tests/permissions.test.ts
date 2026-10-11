import test from "node:test";
import assert from "node:assert/strict";
import { canAccess, navFor } from "../src/lib/permissions";
import { createUserSchema, loginSchema } from "../src/lib/validators";

test("ADMIN يصل لكل الصفحات", () => {
  for (const p of ["/dashboard", "/bookings", "/packages", "/invoices", "/reports", "/users"]) {
    assert.ok(canAccess("ADMIN", p), p);
  }
});

test("ACCOUNTANT: فواتير وتقارير فقط، لا حجوزات ولا مستخدمين", () => {
  assert.ok(canAccess("ACCOUNTANT", "/invoices"));
  assert.ok(canAccess("ACCOUNTANT", "/reports/monthly"));
  assert.ok(!canAccess("ACCOUNTANT", "/bookings"));
  assert.ok(!canAccess("ACCOUNTANT", "/users"));
});

test("SALES: حجوزات وباقات فقط", () => {
  assert.ok(canAccess("SALES", "/bookings/new"));
  assert.ok(canAccess("SALES", "/packages"));
  assert.ok(!canAccess("SALES", "/invoices"));
  assert.ok(!canAccess("SALES", "/reports"));
  assert.ok(!canAccess("SALES", "/users"));
});

test("المسارات غير المعرّفة ومحاولات التمويه تُرفض", () => {
  assert.ok(!canAccess("ADMIN", "/secret"));
  assert.ok(!canAccess("ADMIN", "/usersX"));
  assert.ok(!canAccess("SALES", "/usersfoo"));
});

test("القائمة الجانبية تتبع الدور", () => {
  assert.deepEqual(navFor("SALES").map((i) => i.href), ["/dashboard", "/bookings", "/packages"]);
});

test("Zod: التحقق من المدخلات", () => {
  assert.ok(!createUserSchema.safeParse({ name: "a", email: "x", password: "1", role: "ROOT" }).success);
  assert.ok(createUserSchema.safeParse({ name: "علي", email: "A@B.com", password: "12345678", role: "SALES" }).success);
  assert.equal(loginSchema.parse({ email: " A@B.com ", password: "x" }).email, "a@b.com");
});
