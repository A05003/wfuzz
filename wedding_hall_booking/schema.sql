-- =====================================================================
-- نظام حجز قاعة أفراح - تصميم قاعدة البيانات (PostgreSQL 13+)
-- Wedding Hall Booking System - Database Schema
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;  -- لمنع تداخل الحجوزات

-- ---------------------------------------------------------------------
-- 1) العملاء
-- ---------------------------------------------------------------------
CREATE TABLE customers (
    customer_id   BIGSERIAL PRIMARY KEY,
    full_name     VARCHAR(150) NOT NULL,
    phone         VARCHAR(20)  NOT NULL UNIQUE,
    email         VARCHAR(150) UNIQUE,
    national_id   VARCHAR(30),
    address       TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 2) القاعات (تفاصيل القاعة)
-- ---------------------------------------------------------------------
CREATE TABLE halls (
    hall_id        BIGSERIAL PRIMARY KEY,
    name           VARCHAR(150) NOT NULL,
    description    TEXT,
    city           VARCHAR(100) NOT NULL,
    address        TEXT NOT NULL,
    latitude       NUMERIC(9,6),
    longitude      NUMERIC(9,6),
    capacity_men   INT NOT NULL CHECK (capacity_men >= 0),     -- سعة قسم الرجال
    capacity_women INT NOT NULL CHECK (capacity_women >= 0),   -- سعة قسم النساء
    parking_spaces INT NOT NULL DEFAULT 0 CHECK (parking_spaces >= 0),
    base_price     NUMERIC(12,2) NOT NULL CHECK (base_price >= 0), -- السعر الأساسي لليوم/الفترة
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE hall_images (
    image_id   BIGSERIAL PRIMARY KEY,
    hall_id    BIGINT NOT NULL REFERENCES halls(hall_id) ON DELETE CASCADE,
    image_url  TEXT NOT NULL,
    is_cover   BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order INT NOT NULL DEFAULT 0
);

-- مرافق القاعة (تكييف، مسرح، غرفة عروس، ...)
CREATE TABLE amenities (
    amenity_id BIGSERIAL PRIMARY KEY,
    name       VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE hall_amenities (
    hall_id    BIGINT NOT NULL REFERENCES halls(hall_id) ON DELETE CASCADE,
    amenity_id BIGINT NOT NULL REFERENCES amenities(amenity_id) ON DELETE CASCADE,
    PRIMARY KEY (hall_id, amenity_id)
);

-- فترات الحجز المتاحة لكل قاعة (صباحية / مسائية / يوم كامل) مع تسعير خاص
CREATE TABLE hall_time_slots (
    slot_id     BIGSERIAL PRIMARY KEY,
    hall_id     BIGINT NOT NULL REFERENCES halls(hall_id) ON DELETE CASCADE,
    name        VARCHAR(50) NOT NULL,            -- مثال: مسائية
    start_time  TIME NOT NULL,
    end_time    TIME NOT NULL,
    price       NUMERIC(12,2) NOT NULL CHECK (price >= 0),
    UNIQUE (hall_id, name)
);

-- أيام الإغلاق / الصيانة / الحظر
CREATE TABLE hall_blackouts (
    blackout_id BIGSERIAL PRIMARY KEY,
    hall_id     BIGINT NOT NULL REFERENCES halls(hall_id) ON DELETE CASCADE,
    start_at    TIMESTAMPTZ NOT NULL,
    end_at      TIMESTAMPTZ NOT NULL,
    reason      VARCHAR(255),
    CHECK (end_at > start_at)
);

-- ---------------------------------------------------------------------
-- 3) الخدمات المتاحة
-- ---------------------------------------------------------------------
CREATE TABLE service_categories (
    category_id BIGSERIAL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL UNIQUE     -- ضيافة، تصوير، ديكور، صوتيات، زفة...
);

CREATE TABLE services (
    service_id   BIGSERIAL PRIMARY KEY,
    category_id  BIGINT NOT NULL REFERENCES service_categories(category_id),
    name         VARCHAR(150) NOT NULL,
    description  TEXT,
    pricing_type VARCHAR(20) NOT NULL DEFAULT 'FIXED'
                 CHECK (pricing_type IN ('FIXED','PER_PERSON','PER_HOUR')),
    default_price NUMERIC(12,2) NOT NULL CHECK (default_price >= 0),
    is_active    BOOLEAN NOT NULL DEFAULT TRUE
);

-- ربط الخدمات بالقاعات (مع إمكانية تخصيص السعر لكل قاعة)
CREATE TABLE hall_services (
    hall_id        BIGINT NOT NULL REFERENCES halls(hall_id) ON DELETE CASCADE,
    service_id     BIGINT NOT NULL REFERENCES services(service_id) ON DELETE CASCADE,
    price_override NUMERIC(12,2) CHECK (price_override >= 0),  -- NULL = السعر الافتراضي
    PRIMARY KEY (hall_id, service_id)
);

-- ---------------------------------------------------------------------
-- 4) الحجوزات
-- ---------------------------------------------------------------------
CREATE TABLE bookings (
    booking_id     BIGSERIAL PRIMARY KEY,
    booking_ref    VARCHAR(20) NOT NULL UNIQUE,            -- رقم مرجعي للعميل
    customer_id    BIGINT NOT NULL REFERENCES customers(customer_id),
    hall_id        BIGINT NOT NULL REFERENCES halls(hall_id),
    slot_id        BIGINT REFERENCES hall_time_slots(slot_id),
    event_type     VARCHAR(30) NOT NULL DEFAULT 'WEDDING'
                   CHECK (event_type IN ('WEDDING','ENGAGEMENT','GRADUATION','OTHER')),
    start_at       TIMESTAMPTZ NOT NULL,
    end_at         TIMESTAMPTZ NOT NULL,
    guests_men     INT NOT NULL DEFAULT 0 CHECK (guests_men >= 0),
    guests_women   INT NOT NULL DEFAULT 0 CHECK (guests_women >= 0),
    status         VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                   CHECK (status IN ('PENDING','CONFIRMED','CANCELLED','COMPLETED')),
    hall_price     NUMERIC(12,2) NOT NULL CHECK (hall_price >= 0),
    services_total NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (services_total >= 0),
    discount       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
    total_amount   NUMERIC(12,2) NOT NULL CHECK (total_amount >= 0),
    notes          TEXT,
    cancelled_at   TIMESTAMPTZ,
    cancel_reason  TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (end_at > start_at),

    -- منع حجز نفس القاعة في وقت متداخل (للحجوزات غير الملغاة)
    CONSTRAINT no_overlapping_bookings EXCLUDE USING gist (
        hall_id WITH =,
        tstzrange(start_at, end_at) WITH &&
    ) WHERE (status IN ('PENDING','CONFIRMED'))
);

CREATE INDEX idx_bookings_customer ON bookings(customer_id);
CREATE INDEX idx_bookings_hall_date ON bookings(hall_id, start_at);
CREATE INDEX idx_bookings_status ON bookings(status);

-- الخدمات المختارة لكل حجز (يُخزَّن السعر وقت الحجز لحفظ التاريخ)
CREATE TABLE booking_services (
    booking_service_id BIGSERIAL PRIMARY KEY,
    booking_id   BIGINT NOT NULL REFERENCES bookings(booking_id) ON DELETE CASCADE,
    service_id   BIGINT NOT NULL REFERENCES services(service_id),
    quantity     NUMERIC(10,2) NOT NULL DEFAULT 1 CHECK (quantity > 0), -- عدد الأشخاص/الساعات
    unit_price   NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
    line_total   NUMERIC(12,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
    UNIQUE (booking_id, service_id)
);

-- ---------------------------------------------------------------------
-- 5) المدفوعات (العربون والدفعات)
-- ---------------------------------------------------------------------
CREATE TABLE payments (
    payment_id   BIGSERIAL PRIMARY KEY,
    booking_id   BIGINT NOT NULL REFERENCES bookings(booking_id),
    amount       NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    payment_type VARCHAR(20) NOT NULL
                 CHECK (payment_type IN ('DEPOSIT','INSTALLMENT','FINAL','REFUND')),
    method       VARCHAR(20) NOT NULL
                 CHECK (method IN ('CASH','CARD','BANK_TRANSFER','ONLINE')),
    reference_no VARCHAR(100),
    paid_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    notes        TEXT
);

CREATE INDEX idx_payments_booking ON payments(booking_id);

-- ---------------------------------------------------------------------
-- عرض مساعد: الرصيد المتبقي لكل حجز
-- ---------------------------------------------------------------------
CREATE VIEW booking_balances AS
SELECT b.booking_id,
       b.booking_ref,
       b.total_amount,
       COALESCE(SUM(CASE WHEN p.payment_type = 'REFUND' THEN -p.amount ELSE p.amount END), 0) AS paid,
       b.total_amount
         - COALESCE(SUM(CASE WHEN p.payment_type = 'REFUND' THEN -p.amount ELSE p.amount END), 0) AS remaining
FROM bookings b
LEFT JOIN payments p ON p.booking_id = b.booking_id
GROUP BY b.booking_id;
