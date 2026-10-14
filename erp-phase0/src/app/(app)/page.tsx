import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <div className="max-w-xl">
      <h1 className="text-3xl font-bold">نظام إدارة قاعة الأفراح</h1>
      <p className="mt-3 text-muted-foreground">
        مرحباً بك. المرحلة 0 (التأسيس) جاهزة — اختر قسماً من القائمة الجانبية.
      </p>
      <Button asChild className="mt-6">
        <Link href="/dashboard">الذهاب للوحة التحكم</Link>
      </Button>
    </div>
  );
}
