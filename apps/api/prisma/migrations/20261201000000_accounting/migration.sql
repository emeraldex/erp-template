-- CreateTable
CREATE TABLE "accounting_exports" (
    "id" TEXT NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "includeExported" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_exports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_export_items" (
    "id" SERIAL NOT NULL,
    "exportId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "accounting_export_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "accounting_export_items_kind_ref_idx" ON "accounting_export_items"("kind", "ref");

-- CreateIndex
CREATE INDEX "accounting_export_items_exportId_idx" ON "accounting_export_items"("exportId");

-- AddForeignKey
ALTER TABLE "accounting_export_items" ADD CONSTRAINT "accounting_export_items_exportId_fkey" FOREIGN KEY ("exportId") REFERENCES "accounting_exports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

