"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function Login() {
  const router = useRouter();
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setErr("");
    const f = new FormData(e.currentTarget);
    const { error } = await supabaseBrowser().auth.signInWithPassword({ email: String(f.get("email")), password: String(f.get("password")) });
    setBusy(false);
    if (error) return setErr("البريد أو كلمة المرور غير صحيحة");
    router.replace("/"); router.refresh();
  }
  return (
    <main style={{ maxWidth: 380, marginTop: "12vh" }}>
      <div className="card">
        <h1>تسجيل دخول الموظفين</h1>
        <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
          <label>البريد الإلكتروني<input name="email" type="email" required autoComplete="username" dir="ltr" /></label>
          <label>كلمة المرور<input name="password" type="password" required autoComplete="current-password" dir="ltr" /></label>
          {err && <div className="err" role="alert">{err}</div>}
          <button disabled={busy}>{busy ? "..." : "دخول"}</button>
        </form>
      </div>
    </main>
  );
}
