import { requireRole } from "@/lib/session";
import Bar from "@/components/Bar";
import { sar, STATUS_AR } from "@/lib/format";

export default async function Admin() {
  const { sb, name, role } = await requireRole(["admin"]);
  const [inv, halls, bookings, alerts, assets] = await Promise.all([
    sb.from("invoices").select("total_amount, paid_amount, status").neq("status", "void"),
    sb.from("customers_halls").select("id, current_balance"),
    sb.from("bookings").select("id, event_date, event_time, guest_count, status, total_amount, customers_halls(name)").order("event_date").limit(30),
    sb.from("inventory_alerts").select("id, message").eq("resolved", false),
    sb.from("asset_tracking").select("id").eq("status", "lost_discrepancy"),
  ]);
  const invoiced = (inv.data ?? []).reduce((s, i) => s + Number(i.total_amount), 0);
  const paid = (inv.data ?? []).reduce((s, i) => s + Number(i.paid_amount), 0);
  return (<><Bar name={name} role={role} /><main>
    <h1>لوحة المدير</h1>
    <div className="grid">
      <div className="card kpi"><span className="muted">إجمالي الفواتير</span><b>{sar(invoiced)}</b></div>
      <div className="card kpi"><span className="muted">المحصّل</span><b>{sar(paid)}</b></div>
      <div className="card kpi"><span className="muted">المتبقي</span><b>{sar(invoiced - paid)}</b></div>
      <div className="card kpi"><span className="muted">القاعات</span><b>{halls.data?.length ?? 0}</b></div>
      <div className="card kpi"><span className="muted">فروقات الأصول</span><b className={assets.data?.length ? "bad" : ""}>{assets.data?.length ?? 0}</b></div>
    </div>
    {!!alerts.data?.length && (<><h2>تنبيهات المخزون</h2>
      {alerts.data.map((a) => <div key={a.id} className="card bad" style={{ marginBottom: 8 }}>{a.message}</div>)}</>)}
    <h2>الحجوزات القادمة</h2>
    <div className="scroll"><table><thead><tr><th>التاريخ</th><th>العميل</th><th>الضيوف</th><th>الحالة</th><th>الإجمالي</th></tr></thead><tbody>
      {(bookings.data ?? []).map((b: any) => (<tr key={b.id}><td>{b.event_date}</td><td>{b.customers_halls?.name}</td>
        <td>{b.guest_count}</td><td><span className="badge">{STATUS_AR[b.status]}</span></td><td>{sar(b.total_amount)}</td></tr>))}
    </tbody></table></div>
  </main></>);
}
