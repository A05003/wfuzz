import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { UsersManager } from "./users-manager";

export default async function UsersPage() {
  const session = await auth();
  if (session?.user.role !== "ADMIN") redirect("/forbidden"); // دفاع إضافي فوق الـ middleware
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, email: true, isActive: true, role: { select: { name: true, label: true } } },
  });
  return <UsersManager initial={users} meId={session.user.id} />;
}
