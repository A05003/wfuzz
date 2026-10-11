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

---

## الإصدار 2: التصفية المالية وسجل التدقيق (PostgreSQL + لوحة موحّدة)

### قاعدة البيانات — `db/schema_v2.sql`
| الجدول | الغرض |
|---|---|
| `bookings` | العقود. `contract_number` تلقائي؛ الأعمدة `total_amount` و`balance_due` محسوبة (Generated) |
| `booking_services` | الخدمات؛ تُضاف في أي وقت وترتبط تلقائيًا برقم العقد ويُعاد حساب الإجمالي فورًا |
| `payments` | سندات القبض؛ تُربط تلقائيًا برقم العقد، دفعات جزئية، ولا تتجاوز المتبقي |
| `event_settlements` | تصفية المناسبة: الإيراد − المصروفات = صافي الربح، ثم التوزيع بين إيجار القاعة والتسويق/الإدارة |
| `event_expenses` | المصروفات المباشرة (عمالة، نظافة، مستهلكات، أخرى) |
| `profit_split_settings` | نسب التوزيع — **إضافة فقط وللمالك فقط** |
| `audit_logs` | الأرشيف الدائم: `user_id, action_type, timestamp, original_data, new_data` |

**الحذف الصلب مستحيل:** أي `DELETE` على جداول العمل يتحول بالمشغّل إلى حذف ناعم (`deleted_at`) ويُؤرشف في `audit_logs`. وسجل التدقيق نفسه لا يقبل UPDATE/DELETE/TRUNCATE.
**الصلاحيات:** دور المستخدم يُقرأ من جدول `users` (لا من العميل). المالك وحده يعدّل النسب ويتجاوز القيم المالية؛ مدير القصر يدير العقود والسندات والمصروفات.
**تصفية يوم المناسبة:** لا تُفتح التصفية قبل يوم المناسبة، ولا يُغلق العقد إلا بعد سداد المتبقي بالكامل، ويُسجَّل `settled_on_event_day`. وبعد يوم المناسبة لا يضيف المدير خدمات جديدة.

على الخادم يجب بدء كل معاملة بـ `SELECT set_config('app.user_id', '<id>', true);` ليُنسب كل تغيير إلى مستخدم.

```bash
psql -v ON_ERROR_STOP=1 -f db/schema_v2.sql -f db/test_schema_v2.sql   # قاعدة فارغة؛ ينتهي بـ ALL TESTS PASSED
```

### اللوحة الموحّدة — `app/dashboard.html`
افتحها عبر `npm start` ثم `http://127.0.0.1:3000/dashboard.html`. نموذج واجهة ببيانات تجريبية داخل المتصفح (لم تُربط بعد بالخادم)،
وتتضمن: ساعة وتاريخ حيّان في الهيدر، بحث سريع بالعقد (اضغط `/`)، نافذة إضافة خدمة بمعاينة فورية، عرض تصفية ما بعد المناسبة، سجل التدقيق (للمالك)، ومبدّل أدوار للتجربة.
