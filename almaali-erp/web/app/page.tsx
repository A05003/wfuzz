import { redirect } from "next/navigation";
import { requireRole, type Role } from "@/lib/session";
import Bar from "@/components/Bar";

export default async function Home() {
  const { role, name } = await requireRole(["admin", "sales", "kitchen", "driver", "pending"]);
  if (role !== "pending") redirect(`/${role}`);
  return (<><Bar name={name} role={role} /><main><div className="card"><h1>حسابك بانتظار التفعيل</h1>
    <p>تواصل مع المدير ليحدد لك صلاحيتك ثم حدّث الصفحة.</p></div></main></>);
}
