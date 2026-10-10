"use client";
import { useState, useTransition } from "react";
import { setStatus } from "@/app/actions";

export default function StatusButton({ id, to, label }: { id: string; to: string; label: string }) {
  const [err, setErr] = useState(""); const [pending, start] = useTransition();
  return (
    <>
      <button disabled={pending} onClick={() => start(async () => setErr((await setStatus(id, to)).error ?? ""))}>{label}</button>
      {err && <div className="err" role="alert">{err}</div>}
    </>
  );
}
