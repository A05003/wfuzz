-- CreateTable
CREATE TABLE "ChartOfAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT,
    "type" TEXT NOT NULL,
    "balance" TEXT NOT NULL DEFAULT '0',
    "parentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChartOfAccount_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ChartOfAccount" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JournalVoucher" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "voucherNo" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "description" TEXT NOT NULL,
    "totalAmount" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "voucherId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "debit" TEXT NOT NULL DEFAULT '0',
    "credit" TEXT NOT NULL DEFAULT '0',
    "memo" TEXT,
    CONSTRAINT "JournalEntry_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "JournalVoucher" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "JournalEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ChartOfAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CustomerVendor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT,
    "vatNumber" TEXT,
    "accountSubGroup" TEXT NOT NULL,
    "costCenter" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "CateringBooking" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookingNumber" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventDate" DATETIME NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "seatingList" TEXT,
    "menuPackage" TEXT NOT NULL,
    "guestCount" INTEGER NOT NULL,
    "totalAmount" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CateringBooking_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "CustomerVendor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExpenseRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestNo" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "ChartOfAccount_code_key" ON "ChartOfAccount"("code");

-- CreateIndex
CREATE UNIQUE INDEX "JournalVoucher_voucherNo_key" ON "JournalVoucher"("voucherNo");

-- CreateIndex
CREATE UNIQUE INDEX "CateringBooking_bookingNumber_key" ON "CateringBooking"("bookingNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseRequest_requestNo_key" ON "ExpenseRequest"("requestNo");
