import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const roles = [
  { name: "ADMIN", label: "مدير النظام" },
  { name: "ACCOUNTANT", label: "محاسب" },
  { name: "SALES", label: "موظف مبيعات" },
];

// كلمات مرور للتجربة المحلية فقط — غيّرها قبل أي نشر.
const users = [
  { name: "مدير النظام", email: "admin@hall.test", password: "Admin@12345", role: "ADMIN" },
  { name: "المحاسب", email: "accountant@hall.test", password: "Account@12345", role: "ACCOUNTANT" },
  { name: "موظف المبيعات", email: "sales@hall.test", password: "Sales@12345", role: "SALES" },
];

async function main() {
  for (const r of roles) {
    await prisma.role.upsert({ where: { name: r.name }, update: { label: r.label }, create: r });
  }
  for (const u of users) {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: u.role } });
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { name: u.name, email: u.email, roleId: role.id, passwordHash: await bcrypt.hash(u.password, 12) },
    });
  }
  console.log("✅ seed done:", users.map((u) => `${u.email} / ${u.password}`).join("\n   "));
}

main().finally(() => prisma.$disconnect());
