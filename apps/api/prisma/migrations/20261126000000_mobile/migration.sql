-- AlterTable
ALTER TABLE "attachments" ADD COLUMN     "caption" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'file',
ADD COLUMN     "signedBy" TEXT;

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "assignedAt" TIMESTAMP(3),
ADD COLUMN     "assigneeId" TEXT,
ADD COLUMN     "assigneeName" TEXT;

-- CreateTable
CREATE TABLE "client_ops" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_ops_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_ops_createdAt_idx" ON "client_ops"("createdAt");

-- CreateIndex
CREATE INDEX "jobs_assigneeId_idx" ON "jobs"("assigneeId");

