"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { customerSchema, type CustomerInput } from "@/lib/schemas";
import type { ActionResult } from "./journal";

export async function createCustomer(input: CustomerInput): Promise<ActionResult<{ id: string }>> {
  const parsed = customerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  const d = parsed.data;
  const row = await prisma.customerVendor.create({
    data: { ...d, nameEn: d.nameEn || null, vatNumber: d.vatNumber || null, phone: d.phone || null, address: d.address || null },
  });
  revalidatePath("/catering/bookings");
  return { ok: true, data: { id: row.id } };
}
