"use client";
import { useState, useTransition } from "react";
import type { Result } from "@/app/actions";

export default function ActionForm({ action, children, submit }: {
  action: (f: FormData) => Promise<Result>; children: React.ReactNode; submit: string;
}) {
  const [err, setErr] = useState(""); const [pending, start] = useTransition();
  return (
    <form className="row" action={(f) => start(async () => setErr((await action(f)).error ?? ""))}>
      {children}<button disabled={pending}>{submit}</button>
      {err && <div className="err" role="alert" style={{ flexBasis: "100%" }}>{err}</div>}
    </form>
  );
}
