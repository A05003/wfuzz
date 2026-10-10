import { supabaseServer } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

const ROLE_AR: Record<string, string> = { admin: "المدير", sales: "المبيعات", kitchen: "المطبخ", driver: "السائق", pending: "بانتظار التفعيل" };

export default function Bar({ name, role }: { name: string; role: string }) {
  async function logout() { "use server"; await supabaseServer().auth.signOut(); redirect("/login"); }
  return (
    <header className="bar">
      <strong>المعالي كيترنق · {ROLE_AR[role]}</strong>
      <form action={logout}><span className="muted">{name} </span><button className="ghost">خروج</button></form>
    </header>
  );
}
