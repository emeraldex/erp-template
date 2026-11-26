-- AlterTable
ALTER TABLE "demands" ADD COLUMN     "forStore" TEXT,
ADD COLUMN     "partId" TEXT,
ADD COLUMN     "unitCost" DECIMAL(14,4),
ALTER COLUMN "jobId" DROP NOT NULL,
ALTER COLUMN "qty" SET DATA TYPE DECIMAL(14,3) USING "qty"::numeric;

-- CreateTable
CREATE TABLE "parts" (
    "id" TEXT NOT NULL,
    "partNo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "unit" TEXT NOT NULL DEFAULT 'EA',
    "group" TEXT NOT NULL DEFAULT '',
    "manufacturer" TEXT NOT NULL DEFAULT '',
    "mfrPartNo" TEXT NOT NULL DEFAULT '',
    "preferredSupplierId" TEXT,
    "avgCost" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "lastCost" DECIMAL(14,4),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_levels" (
    "id" SERIAL NOT NULL,
    "partId" TEXT NOT NULL,
    "store" TEXT NOT NULL,
    "bin" TEXT NOT NULL DEFAULT '',
    "qty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "reorderPoint" DECIMAL(14,3),
    "reorderQty" DECIMAL(14,3),
    "lowSince" TIMESTAMP(3),
    "countedAt" TIMESTAMP(3),

    CONSTRAINT "stock_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" BIGSERIAL NOT NULL,
    "partId" TEXT NOT NULL,
    "store" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "unitCost" DECIMAL(14,4) NOT NULL,
    "balanceAfter" DECIMAL(14,3) NOT NULL,
    "jobId" TEXT,
    "demandId" TEXT,
    "countId" TEXT,
    "transferRef" TEXT,
    "reason" TEXT NOT NULL DEFAULT '',
    "by" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_counts" (
    "id" TEXT NOT NULL,
    "store" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "startedBy" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedBy" TEXT,
    "postedAt" TIMESTAMP(3),
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_count_lines" (
    "id" SERIAL NOT NULL,
    "countId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "systemQty" DECIMAL(14,3) NOT NULL,
    "countedQty" DECIMAL(14,3),

    CONSTRAINT "stock_count_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "parts_partNo_key" ON "parts"("partNo");

-- CreateIndex
CREATE INDEX "parts_group_idx" ON "parts"("group");

-- CreateIndex
CREATE INDEX "parts_name_idx" ON "parts"("name");

-- CreateIndex
CREATE INDEX "stock_levels_store_idx" ON "stock_levels"("store");

-- CreateIndex
CREATE UNIQUE INDEX "stock_levels_partId_store_key" ON "stock_levels"("partId", "store");

-- CreateIndex
CREATE INDEX "stock_movements_partId_at_idx" ON "stock_movements"("partId", "at");

-- CreateIndex
CREATE INDEX "stock_movements_jobId_idx" ON "stock_movements"("jobId");

-- CreateIndex
CREATE INDEX "stock_movements_store_at_idx" ON "stock_movements"("store", "at");

-- CreateIndex
CREATE INDEX "stock_counts_store_status_idx" ON "stock_counts"("store", "status");

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_lines_countId_partId_key" ON "stock_count_lines"("countId", "partId");

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_partId_fkey" FOREIGN KEY ("partId") REFERENCES "parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_partId_fkey" FOREIGN KEY ("partId") REFERENCES "parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_countId_fkey" FOREIGN KEY ("countId") REFERENCES "stock_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Stock can never go below zero, whatever the application does.
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_qty_not_negative" CHECK ("qty" >= 0);
