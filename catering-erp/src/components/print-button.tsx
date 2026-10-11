"use client";

import { Printer } from "lucide-react";

export function PrintButton({ targetId }: { targetId: string }) {
  return (
    <button
      className="btn-gold no-print"
      onClick={() => {
        document.querySelectorAll(".print-area").forEach((el) => el.classList.toggle("hidden", el.id !== targetId));
        window.print();
        document.querySelectorAll(".print-area").forEach((el) => el.classList.remove("hidden"));
      }}
    >
      <Printer size={14} /> طباعة
    </button>
  );
}
