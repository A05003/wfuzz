import { requireRole } from "@/lib/session";
import Bar from "@/components/Bar";
import ActionForm from "@/components/ActionForm";
import StatusButton from "@/components/StatusButton";
import { createBooking, createHall, recordPayment } from "@/app/actions";
import { sar, STATUS_AR } from "@/lib/format";

export default async function Sales() {
  const { sb, name, role } = await requireRole(["sales", "admin"]);
  const [halls, recipes, bookings, invoices] = await Promise.all([
    sb.from("customers_halls").select("*").order("name"),
    sb.from("recipes_bom").select("id, dish_name, price_per_serving").order("dish_name"),
    sb.from("bookings").select("id, event_date, guest_count, status, total_amount, customers_halls(name)").order("event_date", { ascending: false }).limit(30),
    sb.from("invoices").select("id, invoice_no, total_amount, paid_amount, status, customers_halls(name)").neq("status", "void").order("issued_at", { ascending: false }).limit(30),
  ]);
  return (<><Bar name={name} role={role} /><main>
    <h1>بوابة المبيعات</h1>

    <h2>القاعات والحسابات</h2>
    <div className="scroll"><table><thead><tr><th>الاسم</th><th>الدفع</th><th>سقف الائتمان</th><th>الرصيد</th></tr></thead><tbody>
      {(halls.data ?? []).map((h) => (<tr key={h.id}><td>{h.name}</td><td>{h.payment_method}</td><td>{sar(h.credit_limit)}</td><td>{sar(h.current_balance)}</td></tr>))}
    </tbody></table></div>
    <div className="card" style={{ marginTop: 8 }}><ActionForm action={createHall} submit="إضافة قاعة">
      <label>الاسم<input name="name" required /></label>
      <label>النوع<select name="type"><option value="wedding_hall">قاعة أفراح</option><option value="corporate">شركة</option><option value="individual">فرد</option></select></label>
      <label>الدفع<select name="payment_method"><option value="cash">نقدي</option><option value="bank_transfer">تحويل</option><option value="deferred_credit">آجل</option></select></label>
      <label>سقف الائتمان<input name="credit_limit" type="number" min="0" step="0.01" defaultValue={0} /></label>
    </ActionForm></div>

    <h2>حجز جديد</h2>
    <div className="card"><ActionForm action={createBooking} submit="حفظ الحجز">
      <label>العميل<select name="customer_id" required>{(halls.data ?? []).map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select></label>
      <label>الطبق<select name="recipe_id">{(recipes.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.dish_name} ({sar(r.price_per_serving)})</option>)}</select></label>
      <label>التاريخ<input name="event_date" type="date" required /></label>
      <label>الفترة<select name="event_time"><option value="evening">مسائي</option><option value="morning">صباحي</option></select></label>
      <label>الضيوف<input name="guest_count" type="number" min="1" required /></label>
      <label>موقع التسليم<input name="delivery_location" placeholder="رابط خرائط قوقل" dir="ltr" /></label>
    </ActionForm></div>

    <h2>الحجوزات</h2>
    <div className="scroll"><table><thead><tr><th>التاريخ</th><th>العميل</th><th>الضيوف</th><th>الحالة</th><th>الإجمالي</th><th></th></tr></thead><tbody>
      {(bookings.data ?? []).map((b: any) => (<tr key={b.id}><td>{b.event_date}</td><td>{b.customers_halls?.name}</td><td>{b.guest_count}</td>
        <td><span className="badge">{STATUS_AR[b.status]}</span></td><td>{sar(b.total_amount)}</td>
        <td>{b.status === "pending" && <StatusButton id={b.id} to="confirmed" label="تأكيد" />}</td></tr>))}
    </tbody></table></div>

    <h2>الفواتير والدفعات</h2>
    <div className="scroll"><table><thead><tr><th>الرقم</th><th>العميل</th><th>الإجمالي</th><th>المدفوع</th><th>تسجيل دفعة</th></tr></thead><tbody>
      {(invoices.data ?? []).map((i: any) => (<tr key={i.id}><td dir="ltr">{i.invoice_no}</td><td>{i.customers_halls?.name}</td><td>{sar(i.total_amount)}</td><td>{sar(i.paid_amount)}</td>
        <td>{i.status !== "paid" && <ActionForm action={recordPayment} submit="حفظ"><input type="hidden" name="invoice_id" value={i.id} />
          <input name="amount" type="number" step="0.01" min="0.01" required style={{ width: 100 }} />
          <select name="method"><option value="cash">نقدي</option><option value="bank_transfer">تحويل</option></select></ActionForm>}</td></tr>))}
    </tbody></table></div>
  </main></>);
}
