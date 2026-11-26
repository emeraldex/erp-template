-- CreateTable
CREATE TABLE "service_requests" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "description" TEXT NOT NULL,
    "place" TEXT NOT NULL DEFAULT '',
    "site" TEXT NOT NULL DEFAULT '',
    "assetId" TEXT,
    "pointCode" TEXT,
    "category" TEXT NOT NULL DEFAULT '',
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "requesterName" TEXT NOT NULL,
    "requesterEmail" TEXT NOT NULL DEFAULT '',
    "requesterPhone" TEXT NOT NULL DEFAULT '',
    "lang" TEXT NOT NULL DEFAULT 'en',
    "source" TEXT NOT NULL DEFAULT 'PORTAL',
    "trackSalt" TEXT NOT NULL,
    "jobId" TEXT,
    "merged" BOOLEAN NOT NULL DEFAULT false,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "declineReason" TEXT NOT NULL DEFAULT '',
    "spam" BOOLEAN NOT NULL DEFAULT false,
    "rating" INTEGER,
    "ratingComment" TEXT NOT NULL DEFAULT '',
    "ratedAt" TIMESTAMP(3),
    "remindedAt" TIMESTAMP(3),
    "doneNotifiedAt" TIMESTAMP(3),
    "ipHash" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "service_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_messages" (
    "id" SERIAL NOT NULL,
    "requestId" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "by" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_points" (
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "site" TEXT NOT NULL DEFAULT '',
    "assetId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_points_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE INDEX "service_requests_status_idx" ON "service_requests"("status");

-- CreateIndex
CREATE INDEX "service_requests_jobId_idx" ON "service_requests"("jobId");

-- CreateIndex
CREATE INDEX "service_requests_createdAt_idx" ON "service_requests"("createdAt");

-- CreateIndex
CREATE INDEX "request_messages_requestId_idx" ON "request_messages"("requestId");

-- CreateIndex
CREATE INDEX "request_points_assetId_idx" ON "request_points"("assetId");

-- AddForeignKey
ALTER TABLE "request_messages" ADD CONSTRAINT "request_messages_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "service_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

