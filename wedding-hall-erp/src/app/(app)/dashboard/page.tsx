import { auth } from "@/auth";
import { ROLE_LABELS } from "@/lib/permissions";

export default async function DashboardPage() {
  const session = await auth();
  const user = session!.user;
  return (
    <div className="card">
      <h1 className="mb-2 text-xl font-bold">أهلاً {user.name} 👋</h1>
      <p className="text-sm">صلاحيتك: <b>{ROLE_LABELS[user.role]}</b></p>
      <p className="mt-2 text-sm text-brand-700">مؤشرات الأداء ستظهر هنا في المرحلة 5.</p>
    </div>
  );
}
