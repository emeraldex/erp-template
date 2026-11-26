-- Domain enums become plain text so each organisation defines its own values
-- (dictionary_entries). Converted in place with USING, so no data is lost.

ALTER TABLE "attachments"
  ALTER COLUMN "entity" SET DATA TYPE TEXT USING "entity"::text;
ALTER TABLE "audit_entries"
  ALTER COLUMN "role" SET DATA TYPE TEXT USING "role"::text;
ALTER TABLE "config_changes"
  ALTER COLUMN "role" SET DATA TYPE TEXT USING "role"::text;
ALTER TABLE "demands"
  ALTER COLUMN "status" SET DATA TYPE TEXT USING "status"::text,
  ALTER COLUMN "branch" SET DATA TYPE TEXT USING "branch"::text;
ALTER TABLE "fod_incidents"
  ALTER COLUMN "area" SET DATA TYPE TEXT USING "area"::text;
ALTER TABLE "invoice_streams"
  ALTER COLUMN "id" SET DATA TYPE TEXT USING "id"::text;
ALTER TABLE "invoices"
  ALTER COLUMN "stream" SET DATA TYPE TEXT USING "stream"::text,
  ALTER COLUMN "status" SET DATA TYPE TEXT USING "status"::text,
  ALTER COLUMN "branch" SET DATA TYPE TEXT USING "branch"::text;
ALTER TABLE "job_priorities"
  ALTER COLUMN "type" SET DATA TYPE TEXT USING "type"::text,
  ALTER COLUMN "route" SET DATA TYPE TEXT USING "route"::text;
ALTER TABLE "jobs"
  ALTER COLUMN "category" SET DATA TYPE TEXT USING "category"::text,
  ALTER COLUMN "repairUnit" SET DATA TYPE TEXT USING "repairUnit"::text,
  ALTER COLUMN "status" SET DATA TYPE TEXT USING "status"::text,
  ALTER COLUMN "location" SET DATA TYPE TEXT USING "location"::text;
ALTER TABLE "ov_repairs"
  ALTER COLUMN "status" SET DATA TYPE TEXT USING "status"::text;
ALTER TABLE "training_records"
  ALTER COLUMN "course" SET DATA TYPE TEXT USING "course"::text;
ALTER TABLE "transition_rules"
  ALTER COLUMN "setLocation" SET DATA TYPE TEXT USING "setLocation"::text;
ALTER TABLE "users"
  ALTER COLUMN "role" SET DATA TYPE TEXT USING "role"::text,
  ALTER COLUMN "branch" SET DATA TYPE TEXT USING "branch"::text;
ALTER TABLE "transition_rules" ALTER COLUMN "roles" SET DATA TYPE TEXT[] USING "roles"::text[];

DROP TYPE "AttachmentEntity";
DROP TYPE "Branch";
DROP TYPE "DemandStatus";
DROP TYPE "FodArea";
DROP TYPE "InvoiceStatus";
DROP TYPE "InvoiceStream";
DROP TYPE "ItemCategory";
DROP TYPE "JobStatus";
DROP TYPE "Location";
DROP TYPE "OvStatus";
DROP TYPE "PriorityType";
DROP TYPE "RepairRoute";
DROP TYPE "Role";
DROP TYPE "TrainingCourse";

-- CreateTable
CREATE TABLE "dictionary_entries" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "labelMs" TEXT NOT NULL DEFAULT '',
    "meta" JSONB NOT NULL DEFAULT '{}',
    "seq" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "dictionary_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dictionary_entries_kind_seq_idx" ON "dictionary_entries"("kind", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "dictionary_entries_kind_key_key" ON "dictionary_entries"("kind", "key");
