# نظام إدارة قاعة الأفراح (ERP)

Next.js (App Router) + TypeScript + Tailwind + shadcn/ui + Prisma (PostgreSQL).

## التشغيل
```bash
cp .env.example .env        # عدّل DATABASE_URL
npm install
npm run db:deploy           # تطبيق الـ Migrations
npm run dev                 # http://localhost:3000
```

## الحالة
- Phase 0 (التأسيس): Layout + Sidebar + صفحات Placeholder + Prisma مع Migration فارغة.
