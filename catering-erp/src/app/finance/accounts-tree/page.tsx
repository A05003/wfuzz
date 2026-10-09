import { prisma } from "@/lib/prisma";
import { AccountsTree, type AccountNode } from "@/components/accounts-tree";

export const dynamic = "force-dynamic";

export default async function Page() {
  const rows = await prisma.chartOfAccount.findMany({ orderBy: { code: "asc" } });
  const map = new Map<string, AccountNode>(rows.map((r) => [r.id, { ...r, children: [] }]));
  const roots: AccountNode[] = [];
  for (const r of rows) {
    const node = map.get(r.id)!;
    const parent = r.parentId ? map.get(r.parentId) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">شجرة الحسابات</h1>
      <AccountsTree roots={roots} />
    </div>
  );
}
