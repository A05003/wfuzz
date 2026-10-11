"use client";

import { useActionState } from "react";
import { loginAction } from "./actions";

export function LoginForm() {
  const [error, action, pending] = useActionState(loginAction, undefined);
  return (
    <form action={action} className="space-y-3">
      <div>
        <label className="mb-1 block text-sm" htmlFor="email">البريد الإلكتروني</label>
        <input id="email" name="email" type="email" required dir="ltr" className="input" autoComplete="username" />
      </div>
      <div>
        <label className="mb-1 block text-sm" htmlFor="password">كلمة المرور</label>
        <input id="password" name="password" type="password" required dir="ltr" className="input" autoComplete="current-password" />
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <button className="btn w-full" disabled={pending}>{pending ? "جارٍ الدخول..." : "دخول"}</button>
    </form>
  );
}
