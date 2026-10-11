"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ROLES, ROLE_LABELS, type RoleName } from "@/lib/permissions";

type Row = { id: string; name: string; email: string; isActive: boolean; role: { name: string; label: string } };

export function UsersManager({ initial, meId }: { initial: Row[]; meId: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function call(url: string, method: string, body: unknown) {
    setBusy(true); setMsg(undefined);
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (!res.ok) { setMsg((await res.json().catch(() => ({}))).error ?? "حدث خطأ"); return false; }
    router.refresh();
    return true;
  }

  async function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = Object.fromEntries(new FormData(form));
    if (await call("/api/users", "POST", f)) form.reset();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">المستخدمون والصلاحيات</h1>

      <form onSubmit={onCreate} className="card grid gap-3 md:grid-cols-5">
        <input name="name" placeholder="الاسم" required className="input" />
        <input name="email" type="email" placeholder="البريد" required dir="ltr" className="input" />
        <input name="password" type="password" placeholder="كلمة المرور (8+)" required minLength={8} dir="ltr" className="input" />
        <select name="role" className="input" defaultValue="SALES">
          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </select>
        <button className="btn" disabled={busy}>إضافة مستخدم</button>
      </form>
      {msg && <p role="alert" className="text-sm text-red-600">{msg}</p>}

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-brand-100 text-right">
            <tr><th className="p-3">الاسم</th><th className="p-3">البريد</th><th className="p-3">الدور</th><th className="p-3">الحالة</th></tr>
          </thead>
          <tbody>
            {initial.map((u) => (
              <tr key={u.id} className="border-t border-brand-100">
                <td className="p-3">{u.name}</td>
                <td className="p-3" dir="ltr">{u.email}</td>
                <td className="p-3">
                  <select
                    className="input w-auto" value={u.role.name} disabled={busy || u.id === meId}
                    onChange={(e) => call(`/api/users/${u.id}`, "PATCH", { role: e.target.value as RoleName })}
                  >
                    {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>
                </td>
                <td className="p-3">
                  <button
                    disabled={busy || u.id === meId}
                    onClick={() => call(`/api/users/${u.id}`, "PATCH", { isActive: !u.isActive })}
                    className={u.isActive ? "text-green-700 hover:underline disabled:opacity-50" : "text-red-600 hover:underline disabled:opacity-50"}
                  >
                    {u.isActive ? "نشط (تعطيل)" : "معطّل (تفعيل)"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
