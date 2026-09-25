-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'FUELMAN');

-- CreateEnum
CREATE TYPE "UnitCategory" AS ENUM ('HEAVY_EQUIPMENT', 'DUMP_TRUCK', 'SUPPORT_VEHICLE', 'GENERATOR', 'LIGHT_VEHICLE');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('PENDING', 'SYNCED', 'FAILED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'BYPASS_DISPENSE', 'BATCH_IMPORT', 'LOGIN', 'EXPORT');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'FUELMAN',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Unit" (
    "id" TEXT NOT NULL,
    "unitCode" TEXT NOT NULL,
    "plateNumber" TEXT,
    "category" "UnitCategory" NOT NULL DEFAULT 'DUMP_TRUCK',
    "makeModel" TEXT,
    "lastKm" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "lastHm" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorageTank" (
    "id" TEXT NOT NULL,
    "tankCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capacityLiters" DOUBLE PRECISION NOT NULL DEFAULT 50000.0,
    "currentStockLiters" DOUBLE PRECISION NOT NULL DEFAULT 45000.0,
    "minStockAlertLiters" DOUBLE PRECISION NOT NULL DEFAULT 5000.0,
    "fuelType" TEXT NOT NULL DEFAULT 'HIGH SPEED DIESEL / SOLAR B35',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorageTank_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FuelLog" (
    "id" TEXT NOT NULL,
    "logNumber" TEXT NOT NULL,
    "no" INTEGER NOT NULL DEFAULT 0,
    "unitId" TEXT NOT NULL,
    "fuelmanId" TEXT NOT NULL,
    "tankId" TEXT NOT NULL,
    "unitCode" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "dateStr" TEXT NOT NULL,
    "jamStr" TEXT NOT NULL,
    "previousHm" DOUBLE PRECISION NOT NULL,
    "currentHm" DOUBLE PRECISION NOT NULL,
    "deltaHm" DOUBLE PRECISION NOT NULL,
    "previousKm" DOUBLE PRECISION NOT NULL,
    "currentKm" DOUBLE PRECISION NOT NULL,
    "deltaKm" DOUBLE PRECISION NOT NULL,
    "volumeLiters" DOUBLE PRECISION NOT NULL,
    "shift" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "fuelInLiters" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "totalFuelOut" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "stockAkhir" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "totalFuelIn" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "fuelmanName" TEXT NOT NULL,
    "bypassValidation" BOOLEAN NOT NULL DEFAULT false,
    "bypassReason" TEXT,
    "dispensedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncStatus" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "syncedAt" TIMESTAMP(3),
    "syncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FuelLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncQueue" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL DEFAULT 'FuelLog',
    "entityId" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 5,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" "AuditAction" NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "oldValues" TEXT,
    "newValues" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE UNIQUE INDEX "Unit_unitCode_key" ON "Unit"("unitCode");

-- CreateIndex
CREATE INDEX "Unit_unitCode_idx" ON "Unit"("unitCode");

-- CreateIndex
CREATE INDEX "Unit_category_idx" ON "Unit"("category");

-- CreateIndex
CREATE UNIQUE INDEX "StorageTank_tankCode_key" ON "StorageTank"("tankCode");

-- CreateIndex
CREATE INDEX "StorageTank_tankCode_idx" ON "StorageTank"("tankCode");

-- CreateIndex
CREATE UNIQUE INDEX "FuelLog_logNumber_key" ON "FuelLog"("logNumber");

-- CreateIndex
CREATE INDEX "FuelLog_unitId_idx" ON "FuelLog"("unitId");

-- CreateIndex
CREATE INDEX "FuelLog_fuelmanId_idx" ON "FuelLog"("fuelmanId");

-- CreateIndex
CREATE INDEX "FuelLog_tankId_idx" ON "FuelLog"("tankId");

-- CreateIndex
CREATE INDEX "FuelLog_dateStr_idx" ON "FuelLog"("dateStr");

-- CreateIndex
CREATE INDEX "FuelLog_syncStatus_idx" ON "FuelLog"("syncStatus");

-- CreateIndex
CREATE INDEX "FuelLog_dispensedAt_idx" ON "FuelLog"("dispensedAt");

-- CreateIndex
CREATE INDEX "SyncQueue_status_idx" ON "SyncQueue"("status");

-- CreateIndex
CREATE INDEX "SyncQueue_entityId_idx" ON "SyncQueue"("entityId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_entity_idx" ON "AuditLog"("entity");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "FuelLog" ADD CONSTRAINT "FuelLog_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuelLog" ADD CONSTRAINT "FuelLog_fuelmanId_fkey" FOREIGN KEY ("fuelmanId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuelLog" ADD CONSTRAINT "FuelLog_tankId_fkey" FOREIGN KEY ("tankId") REFERENCES "StorageTank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
