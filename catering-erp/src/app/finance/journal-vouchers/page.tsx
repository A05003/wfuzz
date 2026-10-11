import { prisma } from "@/lib/prisma";
import { fmt } from "@/lib/money";
import { fmtDate } from "@/lib/utils";
import { JournalForm } from "@/components/journal-form";
import { PrintButton } from "@/components/print-button";

export const dynamic = "force-dynamic";

export default async function Page() {
  const [accounts, vouchers] = await Promise.all([
    prisma.chartOfAccount.findMany({ orderBy: { code: "asc" } }),
    prisma.journalVoucher.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { entries: { include: { account: true } } },
    }),
  ]);

  const parents = new Set(accounts.map((a) => a.parentId).filter(Boolean));
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">سندات اليومية</h1>
      <JournalForm accounts={accounts.filter((a) => !parents.has(a.id)).map(({ id, code, nameAr }) => ({ id, code, nameAr }))} />
      {vouchers.map((v) => (
        <section key={v.id} id={`v-${v.id}`} className="card print-area space-y-3">
          <header className="flex items-start justify-between border-b pb-3">
            <div>
              <h2 className="font-bold text-navy">ذا سلكشن للحفلات الخارجية</h2>
              <p className="text-sm">سند يومية رقم <b>{v.voucherNo}</b></p>
              <p className="text-xs text-gray-500">{fmtDate(v.date)} — {v.description}</p>
            </div>
            <PrintButton targetId={`v-${v.id}`} />
          </header>
          <table className="w-full text-sm">
            <thead className="bg-navy text-white">
              <tr><th className="p-2 text-right">الحساب</th><th className="p-2">مدين</th><th className="p-2">دائن</th></tr>
            </thead>
            <tbody>
              {v.entries.map((e) => (
                <tr key={e.id} className="border-b">
                  <td className="p-2">{e.account.code} - {e.account.nameAr}{e.memo && <span className="text-gray-500"> ({e.memo})</span>}</td>
                  <td className="p-2 text-center">{Number(e.debit) ? fmt(e.debit) : ""}</td>
                  <td className="p-2 text-center">{Number(e.credit) ? fmt(e.credit) : ""}</td>
                </tr>
              ))}
              <tr className="bg-gold-100 font-bold">
                <td className="p-2">الإجمالي</td>
                <td className="p-2 text-center">{fmt(v.totalAmount)}</td>
                <td className="p-2 text-center">{fmt(v.totalAmount)}</td>
              </tr>
            </tbody>
          </table>
          <footer className="grid grid-cols-3 pt-8 text-center text-xs text-gray-500">
            <span>المحاسب</span><span>المراجع</span><span>المدير المالي</span>
          </footer>
        </section>
      ))}
    </div>
  );
}
