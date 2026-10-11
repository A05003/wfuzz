import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { Sidebar } from "@/components/sidebar";
import { navFor, ROLE_LABELS } from "@/lib/permissions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { name, role } = session.user;

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 flex-col border-l border-brand-100 bg-white">
        <div className="border-b border-brand-100 p-4 font-bold">🏛️ قاعة الأفراح</div>
        <Sidebar items={navFor(role).map(({ href, label }) => ({ href, label }))} />
        <div className="space-y-2 border-t border-brand-100 p-4 text-sm">
          <div>{name}</div>
          <div className="text-xs text-brand-700">{ROLE_LABELS[role]}</div>
          <form action={async () => { "use server"; await signOut({ redirectTo: "/login" }); }}>
            <button className="text-red-600 hover:underline">تسجيل الخروج</button>
          </form>
        </div>
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
