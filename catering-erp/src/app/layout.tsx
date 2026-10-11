import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, CalendarDays, FolderTree, UserPlus } from "lucide-react";
import "./globals.css";

export const metadata: Metadata = {
  title: "ذا سلكشن للحفلات الخارجية | ERP",
  description: "نظام إدارة الحسابات والحجوزات",
};

const nav = [
  { href: "/finance/journal-vouchers", label: "سندات اليومية", icon: BookOpen },
  { href: "/finance/accounts-tree", label: "شجرة الحسابات", icon: FolderTree },
  { href: "/catering/bookings", label: "حجوزات التموين", icon: CalendarDays },
  { href: "/finance/customers/new", label: "عميل / مورد جديد", icon: UserPlus },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className="antialiased">
        <div className="flex min-h-screen">
          <aside className="no-print w-60 shrink-0 bg-navy p-4 text-white">
            <Link href="/" className="mb-8 block text-lg font-bold text-gold">
              ذا سلكشن
              <span className="block text-xs font-normal text-white/70">للحفلات الخارجية</span>
            </Link>
            <nav className="space-y-1">
              {nav.map(({ href, label, icon: Icon }) => (
                <Link key={href} href={href} className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-white/10">
                  <Icon size={16} className="text-gold" />
                  {label}
                </Link>
              ))}
            </nav>
          </aside>
          <main className="min-w-0 flex-1 p-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
