import { prisma } from "@/lib/prisma";
import { BookingsTable } from "@/components/bookings-table";
import { BookingForm } from "@/components/booking-form";

export const dynamic = "force-dynamic";

export default async function Page() {
  const [bookings, customers] = await Promise.all([
    prisma.cateringBooking.findMany({ orderBy: { eventDate: "desc" }, include: { customer: true } }),
    prisma.customerVendor.findMany({ where: { kind: "CUSTOMER" }, orderBy: { nameAr: "asc" } }),
  ]);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">حجوزات الحفلات الخارجية</h1>
      <BookingForm customers={customers.map((c) => ({ id: c.id, nameAr: c.nameAr }))} />
      <BookingsTable
        data={bookings.map((b) => ({
          id: b.id, bookingNumber: b.bookingNumber, eventType: b.eventType, eventDate: b.eventDate.toISOString(),
          customer: b.customer.nameAr, status: b.status, guestCount: b.guestCount, menuPackage: b.menuPackage, totalAmount: b.totalAmount,
        }))}
      />
    </div>
  );
}
