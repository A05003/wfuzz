"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { createBooking, type BookingInput } from "@/actions/bookings";

export function BookingForm({ customers }: { customers: { id: string; nameAr: string }[] }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const { register, handleSubmit, reset } = useForm<BookingInput>();
  return (
    <form
      className="card no-print grid gap-3 sm:grid-cols-3"
      onSubmit={handleSubmit((v) =>
        start(async () => {
          const r = await createBooking(v);
          setMsg(r.ok ? `تم إنشاء ${r.data?.bookingNumber}` : r.error);
          if (r.ok) reset();
        }),
      )}
    >
      <select className="input" {...register("customerId")}>
        <option value="">العميل</option>
        {customers.map((c) => <option key={c.id} value={c.id}>{c.nameAr}</option>)}
      </select>
      <input className="input" placeholder="نوع المناسبة" {...register("eventType")} />
      <input className="input" type="date" {...register("eventDate")} />
      <input className="input" placeholder="الباقة" {...register("menuPackage")} />
      <input className="input" type="number" placeholder="عدد الضيوف" {...register("guestCount")} />
      <input className="input" placeholder="سعر الفرد (قبل الضريبة)" {...register("pricePerGuest")} />
      <div className="sm:col-span-3">
        <button className="btn" disabled={pending}>حجز جديد</button>
        {msg && <span className="ms-3 text-sm">{msg}</span>}
      </div>
    </form>
  );
}
