"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { D, sum } from "@/lib/money";
import { balanceDelta, journalVoucherSchema, type JournalVoucherInput } from "@/lib/journal";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

/** Posts a balanced voucher and updates account balances atomically. */
export async function postJournalVoucher(input: JournalVoucherInput): Promise<ActionResult<{ voucherNo: string }>> {
  const parsed = journalVoucherSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  const v = parsed.data;

  try {
    const voucher = await prisma.$transaction(async (tx) => {
      const ids = Array.from(new Set(v.lines.map((l) => l.accountId)));
      const accounts = await tx.chartOfAccount.findMany({ where: { id: { in: ids } } });
      if (accounts.length !== ids.length) throw new Error("حساب غير موجود");
      const parentCount = await tx.chartOfAccount.count({ where: { parentId: { in: ids } } });
      if (parentCount > 0) throw new Error("لا يمكن الترحيل على حساب رئيسي");
      const byId = new Map(accounts.map((a) => [a.id, a]));

      const count = await tx.journalVoucher.count();
      const voucherNo = `JV-${String(count + 1).padStart(6, "0")}`;

      const created = await tx.journalVoucher.create({
        data: {
          voucherNo,
          date: new Date(v.date),
          description: v.description,
          totalAmount: sum(v.lines.map((l) => l.debit)).toFixed(2),
          entries: {
            create: v.lines.map((l) => ({
              accountId: l.accountId,
              debit: D(l.debit).toFixed(2),
              credit: D(l.credit).toFixed(2),
              memo: l.memo || null,
            })),
          },
        },
      });

      // Aggregate deltas per account, then apply.
      const deltas = new Map<string, ReturnType<typeof D>>();
      for (const l of v.lines) {
        const acc = byId.get(l.accountId)!;
        deltas.set(acc.id, (deltas.get(acc.id) ?? D(0)).plus(balanceDelta(acc.type, l.debit, l.credit)));
      }
      for (const [id, delta] of Array.from(deltas)) {
        const acc = byId.get(id)!;
        await tx.chartOfAccount.update({ where: { id }, data: { balance: D(acc.balance).plus(delta).toFixed(2) } });
      }
      return created;
    });
    revalidatePath("/finance/journal-vouchers");
    revalidatePath("/finance/accounts-tree");
    return { ok: true, data: { voucherNo: voucher.voucherNo } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "فشل الترحيل" };
  }
}
