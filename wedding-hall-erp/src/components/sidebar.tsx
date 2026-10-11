"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";

export function Sidebar({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex-1 space-y-1 p-3">
      {items.map((i) => {
        const active = pathname === i.href || pathname.startsWith(i.href + "/");
        return (
          <Link
            key={i.href}
            href={i.href}
            className={clsx(
              "block rounded-lg px-3 py-2 text-sm",
              active ? "bg-brand-600 text-white" : "hover:bg-brand-100",
            )}
          >
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
