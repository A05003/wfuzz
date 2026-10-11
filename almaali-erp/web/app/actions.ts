"use server";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";

export type Result = { error?: string };
const fail = (e: { message: string } | null): Result => (e ? { error: e.message } : {});

export async function setStatus(bookingId: string, status: string) {
  const { error } = await supabaseServer().rpc("set_booking_status", { p_booking: bookingId, p_status: status });
  revalidatePath("/", "layout"); return fail(error);
}

export async function createHall(f: FormData) {
  const { error } = await supabaseServer().from("customers_halls").insert({
    name: String(f.get("name")), type: String(f.get("type")), payment_method: String(f.get("payment_method")),
    credit_limit: Number(f.get("credit_limit") || 0),
  });
  revalidatePath("/sales"); return fail(error);
}

export async function createBooking(f: FormData) {
  const sb = supabaseServer();
  const { data: b, error } = await sb.from("bookings").insert({
    customer_id: String(f.get("customer_id")), event_date: String(f.get("event_date")),
    event_time: String(f.get("event_time")), guest_count: Number(f.get("guest_count")),
    delivery_location: String(f.get("delivery_location") || "") || null,
  }).select("id").single();
  if (error) return fail(error);
  const recipe = String(f.get("recipe_id") || "");
  if (recipe) {
    const { error: e2 } = await sb.from("booking_dishes").insert({ booking_id: b.id, recipe_id: recipe });
    if (e2) return fail(e2);
  }
  revalidatePath("/sales"); return {};
}

export async function recordPayment(f: FormData) {
  const { error } = await supabaseServer().from("payments").insert({
    invoice_id: String(f.get("invoice_id")), amount: Number(f.get("amount")), method: String(f.get("method")),
  });
  revalidatePath("/sales"); return fail(error);
}

export async function sendAsset(f: FormData) {
  const { error } = await supabaseServer().from("asset_tracking").insert({
    booking_id: String(f.get("booking_id")), asset_id: String(f.get("asset_id")), quantity_sent: Number(f.get("quantity")),
  });
  revalidatePath("/driver"); return fail(error);
}

export async function confirmReturn(f: FormData) {
  const { error } = await supabaseServer().from("asset_tracking").update({
    quantity_returned: Number(f.get("returned")), inbound_confirmed: true,
  }).eq("id", String(f.get("id")));
  revalidatePath("/driver"); return fail(error);
}
