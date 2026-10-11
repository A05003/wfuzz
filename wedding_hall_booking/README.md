# نظام إدارة قصر الأفراح

خادم REST API + واجهة إدارة بالعربية. بدون اعتماديات خارجية؛ يتطلب Node.js 22.5 أو أحدث.

## التشغيل
```bash
cd wedding_hall_booking
npm start            # http://127.0.0.1:3000
npm test             # اختبارات الـ API
```
عند أول تشغيل تُنشأ قاعدة البيانات في `data/qasr.db` ويُنشأ المستخدمون `admin` و`sales` و`accountant` و`store`،
وتُطبع **كلمة المرور الأولية مرة واحدة** في سطر الأوامر. للتحكم بها: `SEED_PASSWORD=...`، ولتعطيل البيانات التجريبية: `SEED_DEMO=0`.
متغيرات أخرى: `PORT` و`HOST` و`DB_PATH`.

## الصلاحيات
| الصلاحية | admin | sales | accountant | store |
|---|:-:|:-:|:-:|:-:|
| إنشاء/تعديل/إلغاء الحجوزات والخدمات | ✓ | ✓ | | |
| تسجيل الدفعات (سندات القبض) | ✓ | ✓ | ✓ | |
| إنشاء طلب شراء | ✓ | ✓ | | ✓ |
| اعتماد/رفض طلب الشراء | ✓ | | | |
| أوامر الشراء والمخزون | ✓ | | | ✓ |

## واجهة API (كلها JSON، وتتطلب `Authorization: Bearer <token>` عدا الدخول)
`POST /api/login` · `POST /api/logout` · `GET /api/me` · `GET /api/state`
`POST /api/bookings` · `PUT /api/bookings/:id` · `POST /api/bookings/:id/cancel`
`POST /api/bookings/:id/payments` · `POST /api/bookings/:id/services` · `DELETE /api/bookings/:id/services/:sid`
`POST /api/inventory` · `POST /api/inventory/:id/adjust`
`POST /api/requests` · `POST /api/requests/:id/approve|reject`
`POST /api/orders` · `POST /api/orders/:id/receive`

منع الحجز المزدوج يتم في الخادم داخل معاملة: نفس اليوم مع تداخل الأقسام يُرفض بالحالة 409.

## ملاحظة عن قاعدة البيانات
التشغيل الحالي على SQLite (ملف واحد، مناسب لقصر واحد). مخطط PostgreSQL الأوسع في `schema.sql` (قاعات متعددة وفترات زمنية)
هو التصميم المستهدف عند التوسع؛ مخطط SQLite الفعلي في `server/db.js`.
