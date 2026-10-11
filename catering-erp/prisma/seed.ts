import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const accounts: [string, string, string, string, string | null][] = [
  ["1", "الأصول", "Assets", "ASSET", null],
  ["11", "النقد وما في حكمه", "Cash", "ASSET", "1"],
  ["1101", "الصندوق", "Cash on Hand", "ASSET", "11"],
  ["1102", "البنك", "Bank", "ASSET", "11"],
  ["12", "الذمم المدينة", "Receivables", "ASSET", "1"],
  ["1201", "العملاء", "Customers", "ASSET", "12"],
  ["2", "الخصوم", "Liabilities", "LIABILITY", null],
  ["2101", "الموردون", "Suppliers", "LIABILITY", "2"],
  ["2201", "ضريبة القيمة المضافة", "VAT Payable", "LIABILITY", "2"],
  ["3", "حقوق الملكية", "Equity", "EQUITY", null],
  ["3101", "رأس المال", "Capital", "EQUITY", "3"],
  ["4", "الإيرادات", "Revenue", "REVENUE", null],
  ["4101", "إيرادات الحفلات الخارجية", "Outside Catering Revenue", "REVENUE", "4"],
  ["5", "المصروفات", "Expenses", "EXPENSE", null],
  ["5101", "مشتريات المواد الغذائية", "Food Purchases", "EXPENSE", "5"],
  ["5201", "رواتب وأجور", "Salaries", "EXPENSE", "5"],
];

async function main() {
  const idByCode = new Map<string, string>();
  for (const [code, nameAr, nameEn, type, parent] of accounts) {
    const a = await prisma.chartOfAccount.upsert({
      where: { code },
      update: {},
      create: { code, nameAr, nameEn, type, parentId: parent ? idByCode.get(parent) : null },
    });
    idByCode.set(code, a.id);
  }
}

main().finally(() => prisma.$disconnect());
