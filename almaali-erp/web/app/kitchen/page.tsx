import { requireRole } from "@/lib/session";
import Bar from "@/components/Bar";
import StatusButton from "@/components/StatusButton";
import { STATUS_AR, SHIFT_AR } from "@/lib/format";

export default async function Kitchen() {
  const { sb, name, role } = await requireRole(["kitchen", "admin"]);
  const { data: cards } = await sb.from("booking_cards")
    .select("id, event_date, event_time, guest_count, status, customer_name")
    .in("status", ["confirmed", "cooking"]).order("event_date");
  const { data: mats } = await sb.from("booking_materials").select("booking_id, material_code, quantity");
  const bookings = (cards ?? []).map((b) => ({ ...b, booking_materials: (mats ?? []).filter((m) => m.booking_id === b.id) }));
  const { data: items } = await sb.from("inventory_items").select("code, name, unit");
  const meta = new Map((items ?? []).map((i) => [i.code, i]));

  const totals = new Map<string, number>();
  for (const b of bookings ?? []) for (const m of (b as any).booking_materials) totals.set(m.material_code, (totals.get(m.material_code) ?? 0) + Number(m.quantity));

  return (<><Bar name={name} role={role} /><main>
    <h1>شاشة المطبخ</h1>
    <h2>إجمالي المواد المطلوبة</h2>
    <div className="grid">
      {[...totals].map(([code, q]) => (<div className="card kpi" key={code}><span className="muted">{meta.get(code)?.name ?? code}</span><b>{q} {meta.get(code)?.unit}</b></div>))}
      {!totals.size && <div className="muted">لا توجد حجوزات مؤكدة.</div>}
    </div>
    <h2>الحجوزات</h2>
    {(bookings ?? []).map((b: any) => (
      <div className="card" key={b.id} style={{ marginBottom: 10 }}>
        <strong>{b.customer_name}</strong> · {b.event_date} · {SHIFT_AR[b.event_time]} · {b.guest_count} ضيف · <span className="badge">{STATUS_AR[b.status]}</span>
        <div className="muted">{b.booking_materials.map((m: any) => `${meta.get(m.material_code)?.name ?? m.material_code}: ${m.quantity} ${meta.get(m.material_code)?.unit ?? ""}`).join(" · ")}</div>
        {b.status === "confirmed" && <StatusButton id={b.id} to="cooking" label="بدء الطبخ" />}
      </div>))}
  </main></>);
}
