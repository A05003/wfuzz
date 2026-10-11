import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-sm space-y-4">
        <h1 className="text-center text-xl font-bold">🏛️ نظام إدارة قاعة الأفراح</h1>
        <p className="text-center text-sm text-brand-700">سجّل الدخول للمتابعة</p>
        <LoginForm />
      </div>
    </main>
  );
}
