import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/guard";
import { createUserSchema } from "@/lib/validators";

const select = {
  id: true, name: true, email: true, isActive: true, createdAt: true,
  role: { select: { name: true, label: true } },
} as const;

export async function GET() {
  const g = await requireRole("ADMIN");
  if (g.error) return g.error;
  const users = await prisma.user.findMany({ select, orderBy: { createdAt: "asc" } });
  return NextResponse.json(users);
}

export async function POST(req: Request) {
  const g = await requireRole("ADMIN");
  if (g.error) return g.error;

  const body = await req.json().catch(() => null);
  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { name, email, password, role } = parsed.data;

  if (await prisma.user.findUnique({ where: { email } })) {
    return NextResponse.json({ error: "البريد مستخدم من قبل" }, { status: 409 });
  }
  const roleRow = await prisma.role.findUnique({ where: { name: role } });
  if (!roleRow) return NextResponse.json({ error: "الدور غير موجود" }, { status: 400 });

  const user = await prisma.user.create({
    data: { name, email, roleId: roleRow.id, passwordHash: await bcrypt.hash(password, 12) },
    select,
  });
  return NextResponse.json(user, { status: 201 });
}
