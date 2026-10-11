import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/guard";
import { updateUserSchema } from "@/lib/validators";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireRole("ADMIN");
  if (g.error) return g.error;
  const { id } = await ctx.params;

  const parsed = updateUserSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { isActive, role } = parsed.data;

  // يمنع المدير من تعطيل نفسه أو إسقاط صلاحيته فيقفل النظام على نفسه.
  if (id === g.session.user.id && (isActive === false || (role && role !== "ADMIN"))) {
    return NextResponse.json({ error: "لا يمكنك تعطيل نفسك أو تغيير دورك" }, { status: 400 });
  }

  const data: { isActive?: boolean; roleId?: string } = {};
  if (isActive !== undefined) data.isActive = isActive;
  if (role) {
    const r = await prisma.role.findUnique({ where: { name: role } });
    if (!r) return NextResponse.json({ error: "الدور غير موجود" }, { status: 400 });
    data.roleId = r.id;
  }
  try {
    const user = await prisma.user.update({
      where: { id }, data,
      select: { id: true, name: true, email: true, isActive: true, role: { select: { name: true, label: true } } },
    });
    return NextResponse.json(user);
  } catch {
    return NextResponse.json({ error: "المستخدم غير موجود" }, { status: 404 });
  }
}
