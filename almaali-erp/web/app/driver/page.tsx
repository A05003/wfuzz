import { requireRole } from "@/lib/session";
import Bar from "@/components/Bar";
import ActionForm from "@/components/ActionForm";
import StatusButton from "@/components/StatusButton";
import { confirmReturn, sendAsset } from "@/app/actions";
import { STATUS_AR } from "@/lib/format";

const NEXT: Record<string, [string, string]> = {
  cooking: ["out_for_delivery", "انطلقت للتوصيل"], out_for_delivery: ["delivered", "تم التسليم"], delivered: ["completed", "إنهاء الحجز"],
};

export default async function Driver() {
  const { sb, name, role } = await requireRole(["driver", "admin"]);
  const [bookings, assets, tracking] = await Promise.all([
    sb.from("booking_cards").select("id, event_date, guest_count, status, delivery_location, customer_name")
      .in("status", ["cooking", "out_for_delivery", "delivered"]).order("event_date"),
    sb.from("catering_assets").select("id, asset_name, available_stock").order("asset_name"),
    sb.from("asset_tracking").select("id, booking_id, quantity_sent, quantity_returned, inbound_confirmed, status, catering_assets(asset_name)"),
  ]);
  return (<><Bar name={name} role={role} /><main>
    <h1>التوصيل</h1>
    {(bookings.data ?? []).map((b: any) => {
      const rows = (tracking.data ?? []).filter((t: any) => t.booking_id === b.id);
      return (<div className="card" key={b.id} style={{ marginBottom: 12 }}>
        <strong>{b.customer_name}</strong> · {b.event_date} · {b.guest_count} ضيف · <span className="badge">{STATUS_AR[b.status]}</span>
        {b.delivery_location && <div><a href={b.delivery_location} target="_blank" rel="noopener noreferrer">فتح الموقع على الخريطة</a></div>}

        <h2>قائمة الأصول</h2>
        {rows.map((t: any) => (<div key={t.id} className={t.status === "lost_discrepancy" ? "bad" : ""} style={{ marginBottom: 6 }}>
          {t.catering_assets?.asset_name}: أُرسل {t.quantity_sent} · عاد {t.quantity_returned} {t.status === "lost_discrepancy" && "⚠ فرق"}
          {!t.inbound_confirmed && b.status === "delivered" && (
            <ActionForm action={confirmReturn} submit="تأكيد الاستلام"><input type="hidden" name="id" value={t.id} />
              <input name="returned" type="number" min="0" max={t.quantity_sent} required style={{ width: 80 }} /></ActionForm>)}
        </div>))}
        {b.status === "cooking" && (
          <ActionForm action={sendAsset} submit="إضافة للقائمة"><input type="hidden" name="booking_id" value={b.id} />
            <select name="asset_id">{(assets.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.asset_name} (متاح {a.available_stock})</option>)}</select>
            <input name="quantity" type="number" min="1" required style={{ width: 80 }} /></ActionForm>)}
        <div style={{ marginTop: 8 }}>{NEXT[b.status] && <StatusButton id={b.id} to={NEXT[b.status][0]} label={NEXT[b.status][1]} />}</div>
      </div>);
    })}
    {!bookings.data?.length && <div className="muted">لا توجد توصيلات حالياً.</div>}
  </main></>);
}
