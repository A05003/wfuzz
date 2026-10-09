"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { D, vat } from "@/lib/money";
import type { ActionResult } from "./journal";
import { bookingSchema, type BookingInput } from "@/lib/schemas";


export async function createBooking(input: BookingInput): Promise<ActionResult<{ bookingNumber: string }>> {
  const p = bookingSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "بيانات غير صالحة" };
  const v = p.data;
  const total = vat(D(v.pricePerGuest).times(v.guestCount)).gross.toFixed(2); // incl. 15% VAT
  const row = await prisma.$transaction(async (tx) => {
    const n = await tx.cateringBooking.count();
    return tx.cateringBooking.create({
      data: {
        bookingNumber: `BK-${String(n + 1).padStart(5, "0")}`,
        eventType: v.eventType,
        eventDate: new Date(v.eventDate),
        customerId: v.customerId,
        menuPackage: v.menuPackage,
        guestCount: v.guestCount,
        totalAmount: total,
        seatingList: JSON.stringify([]),
      },
    });
  });
  revalidatePath("/catering/bookings");
  return { ok: true, data: { bookingNumber: row.bookingNumber } };
}

export async function setBookingStatus(id: string, status: "PENDING" | "CONFIRMED" | "COMPLETED" | "CANCELLED") {
  await prisma.cateringBooking.update({ where: { id }, data: { status } });
  revalidatePath("/catering/bookings");
}
