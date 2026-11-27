-- AlterTable
ALTER TABLE "users" ADD COLUMN     "hourlyRate" DECIMAL(14,4);

-- CreateTable
CREATE TABLE "time_entries" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "workDate" DATE NOT NULL,
    "minutes" INTEGER NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "rate" DECIMAL(14,4),
    "cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "time_entries_jobId_idx" ON "time_entries"("jobId");

-- CreateIndex
CREATE INDEX "time_entries_userId_workDate_idx" ON "time_entries"("userId", "workDate");

-- CreateIndex
CREATE INDEX "time_entries_workDate_idx" ON "time_entries"("workDate");

