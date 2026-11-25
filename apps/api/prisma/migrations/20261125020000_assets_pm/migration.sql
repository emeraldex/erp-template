-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "assetId" TEXT,
ADD COLUMN     "checklist" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "jobType" TEXT NOT NULL DEFAULT 'CORRECTIVE',
ADD COLUMN     "pmScheduleId" TEXT;

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "site" TEXT NOT NULL,
    "location" TEXT NOT NULL DEFAULT '',
    "parentId" TEXT,
    "make" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL DEFAULT '',
    "serialNo" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'IN_SERVICE',
    "criticality" TEXT NOT NULL DEFAULT 'MEDIUM',
    "commissionedOn" TEXT,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL DEFAULT '',
    "ordinal" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meters" (
    "id" SERIAL NOT NULL,
    "assetId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "meters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meter_readings" (
    "id" BIGSERIAL NOT NULL,
    "meterId" INTEGER NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "by" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',

    CONSTRAINT "meter_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pm_schedules" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "intervalDays" INTEGER,
    "meterKey" TEXT,
    "intervalMeter" DOUBLE PRECISION,
    "leadDays" INTEGER NOT NULL DEFAULT 7,
    "leadMeter" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "jobType" TEXT NOT NULL DEFAULT 'PREVENTIVE',
    "category" TEXT NOT NULL DEFAULT '',
    "instructions" TEXT NOT NULL DEFAULT '',
    "checklist" JSONB NOT NULL DEFAULT '[]',
    "lastDoneAt" TIMESTAMP(3),
    "lastDoneMeter" DOUBLE PRECISION,
    "nextDueAt" TIMESTAMP(3),
    "nextDueMeter" DOUBLE PRECISION,
    "openJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "pm_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assets_tag_key" ON "assets"("tag");

-- CreateIndex
CREATE INDEX "assets_site_idx" ON "assets"("site");

-- CreateIndex
CREATE INDEX "assets_type_idx" ON "assets"("type");

-- CreateIndex
CREATE INDEX "assets_parentId_idx" ON "assets"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "meters_assetId_key_key" ON "meters"("assetId", "key");

-- CreateIndex
CREATE INDEX "meter_readings_meterId_at_idx" ON "meter_readings"("meterId", "at");

-- CreateIndex
CREATE INDEX "pm_schedules_active_idx" ON "pm_schedules"("active");

-- CreateIndex
CREATE INDEX "pm_schedules_assetId_idx" ON "pm_schedules"("assetId");

-- CreateIndex
CREATE INDEX "jobs_assetId_idx" ON "jobs"("assetId");

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meters" ADD CONSTRAINT "meters_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_meterId_fkey" FOREIGN KEY ("meterId") REFERENCES "meters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pm_schedules" ADD CONSTRAINT "pm_schedules_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

