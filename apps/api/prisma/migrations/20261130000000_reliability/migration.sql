-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "assetDown" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "doneAt" TIMESTAMP(3),
ADD COLUMN     "pmDueAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "asset_downtime" (
    "id" SERIAL NOT NULL,
    "assetId" TEXT NOT NULL,
    "fromAt" TIMESTAMP(3) NOT NULL,
    "toAt" TIMESTAMP(3),
    "jobId" TEXT,
    "reason" TEXT NOT NULL DEFAULT '',
    "openedBy" TEXT NOT NULL,
    "closedBy" TEXT,

    CONSTRAINT "asset_downtime_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "asset_downtime_assetId_fromAt_idx" ON "asset_downtime"("assetId", "fromAt");

-- CreateIndex
CREATE INDEX "asset_downtime_jobId_idx" ON "asset_downtime"("jobId");

