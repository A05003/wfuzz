import Link from "next/link";

export default function Forbidden() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="card max-w-sm space-y-3 text-center">
        <h1 className="text-xl font-bold">⛔ غير مسموح</h1>
        <p className="text-sm">ليست لديك صلاحية لفتح هذه الصفحة.</p>
        <Link href="/dashboard" className="btn inline-block">العودة للرئيسية</Link>
      </div>
    </main>
  );
}
