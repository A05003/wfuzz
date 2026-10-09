"use client";

import { useState, useTransition } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { journalVoucherSchema, totals, type JournalVoucherInput } from "@/lib/journal";
import { fmt } from "@/lib/money";
import { postJournalVoucher } from "@/actions/journal";

type Account = { id: string; code: string; nameAr: string };
const emptyLine = { accountId: "", debit: "", credit: "", memo: "" };

export function JournalForm({ accounts }: { accounts: Account[] }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const { register, control, handleSubmit, reset, formState: { errors } } = useForm<JournalVoucherInput>({
    resolver: zodResolver(journalVoucherSchema),
    defaultValues: { date: new Date().toISOString().slice(0, 10), description: "", lines: [emptyLine, emptyLine] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: "lines" });
  const lines = useWatch({ control, name: "lines" }) ?? [];
  const t = totals(lines.map((l) => ({ debit: l?.debit || "0", credit: l?.credit || "0" })));

  const onSubmit = (v: JournalVoucherInput) =>
    start(async () => {
      const r = await postJournalVoucher(v);
      if (r.ok) {
        setMsg({ ok: true, text: `تم ترحيل السند ${r.data?.voucherNo}` });
        reset({ date: v.date, description: "", lines: [emptyLine, emptyLine] });
      } else setMsg({ ok: false, text: r.error });
    });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="card no-print space-y-4">
      <h2 className="font-bold">سند يومية جديد</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <input type="date" className="input" {...register("date")} />
          {errors.date && <p className="err">{errors.date.message}</p>}
        </div>
        <div className="sm:col-span-2">
          <input className="input" placeholder="البيان" {...register("description")} />
          {errors.description && <p className="err">{errors.description.message}</p>}
        </div>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-right text-xs text-gray-500">
            <th className="w-2/5">الحساب</th><th>مدين</th><th>دائن</th><th>ملاحظة</th><th />
          </tr>
        </thead>
        <tbody>
          {fields.map((f, i) => (
            <tr key={f.id}>
              <td className="p-1">
                <select className="input" {...register(`lines.${i}.accountId`)}>
                  <option value="">— اختر —</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} - {a.nameAr}</option>)}
                </select>
              </td>
              <td className="p-1"><input inputMode="decimal" className="input" {...register(`lines.${i}.debit`)} /></td>
              <td className="p-1"><input inputMode="decimal" className="input" {...register(`lines.${i}.credit`)} /></td>
              <td className="p-1"><input className="input" {...register(`lines.${i}.memo`)} /></td>
              <td className="p-1">
                <button type="button" aria-label="حذف" onClick={() => fields.length > 2 && remove(i)} className="text-red-500">
                  <Trash2 size={16} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {errors.lines?.root?.message && <p className="err">{errors.lines.root.message}</p>}
      {errors.lines?.message && <p className="err">{errors.lines.message}</p>}
      {Array.isArray(errors.lines) && errors.lines.map((e, i) => e?.message && <p key={i} className="err">سطر {i + 1}: {e.message}</p>)}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" className="btn-gold" onClick={() => append(emptyLine)}><Plus size={14} /> سطر</button>
        <div className="flex gap-4 text-sm">
          <span>مدين: <b>{fmt(t.debit)}</b></span>
          <span>دائن: <b>{fmt(t.credit)}</b></span>
          <span className={t.balanced ? "text-green-600" : "text-red-600"}>
            {t.balanced ? "متوازن ✓" : `فرق: ${fmt(t.diff.abs())}`}
          </span>
        </div>
        <button className="btn" disabled={pending || !t.balanced}>ترحيل السند</button>
      </div>
      {msg && <p className={msg.ok ? "text-sm text-green-600" : "err"}>{msg.text}</p>}
    </form>
  );
}
