import type { ColumnDef } from "@tanstack/react-table";
import { fmt } from "@/lib/money";
import { fmtDate } from "@/lib/utils";

export type BookingRow = {
  id: string; bookingNumber: string; eventType: string; eventDate: string; customer: string;
  status: string; guestCount: number; menuPackage: string; totalAmount: string;
};

const statusStyle: Record<string, [string, string]> = {
  PENDING: ["قيد الانتظار", "bg-amber-100 text-amber-800"],
  CONFIRMED: ["مؤكد", "bg-blue-100 text-blue-800"],
  COMPLETED: ["مكتمل", "bg-green-100 text-green-800"],
  CANCELLED: ["ملغي", "bg-red-100 text-red-800"],
};

export const createColumnDef = (): ColumnDef<BookingRow>[] => [
  { accessorKey: "bookingNumber", header: "رقم الحجز" },
  { accessorKey: "customer", header: "العميل" },
  { accessorKey: "eventType", header: "المناسبة" },
  { accessorKey: "eventDate", header: "التاريخ", cell: ({ getValue }) => fmtDate(getValue<string>()) },
  { accessorKey: "guestCount", header: "الضيوف" },
  {
    accessorKey: "status",
    header: "الحالة",
    cell: ({ getValue }) => {
      const [label, cls] = statusStyle[getValue<string>()] ?? [getValue<string>(), ""];
      return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>;
    },
  },
  { accessorKey: "totalAmount", header: "الإجمالي (شامل الضريبة)", cell: ({ getValue }) => fmt(getValue<string>()) },
];
