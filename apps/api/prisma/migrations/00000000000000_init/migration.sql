-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'STORES', 'WORKSHOP', 'MIS', 'MM', 'PURCHASING', 'PCE', 'QUALITY', 'FINANCE', 'BILLING');

-- CreateEnum
CREATE TYPE "Branch" AS ENUM ('HQ', 'CENTRAL', 'EAST', 'NORTH', 'NORTHEAST', 'OFFSHORE');

-- CreateEnum
CREATE TYPE "Location" AS ENUM ('LOGISTIC', 'BAY', 'HQ', 'VENDOR', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('REGISTERED', 'AWAITING_TDI', 'TDI', 'AWAITING_SPARE', 'AWAITING_INDENT', 'WIP', 'REC_OV', 'BER', 'SOR', 'SERVICEABLE', 'DELIVERED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ItemCategory" AS ENUM ('MILITARY', 'NAS');

-- CreateEnum
CREATE TYPE "DemandStatus" AS ENUM ('RAISED', 'APPROVED', 'STOCK_CHECK', 'ISSUED_FROM_STOCK', 'RFQ_ISSUED', 'EVALUATED', 'PO_ISSUED', 'RECEIVED', 'ISSUED');

-- CreateEnum
CREATE TYPE "OvStatus" AS ENUM ('RECEIVED_HQ', 'VENDOR_IDENTIFIED', 'F134_SUBMITTED', 'APPROVED', 'REJECTED', 'PO_ISSUED', 'AT_VENDOR', 'COST_ADVISED', 'QUOTE_APPROVED', 'RECEIVED_BACK', 'RETURNED');

-- CreateEnum
CREATE TYPE "InvoiceStream" AS ENUM ('PBC', 'BRANCH_REPAIR', 'COE_MRA', 'ACD');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFTED', 'CERTIFIED', 'TAX_RAISED', 'CORRECTNESS_CHECK', 'SUBMITTED', 'REJECTED', 'PAID');

-- CreateEnum
CREATE TYPE "PartnerType" AS ENUM ('SUPPLIER', 'SUBCONTRACTOR');

-- CreateEnum
CREATE TYPE "PartnerStatus" AS ENUM ('APPLIED', 'UNDER_EVALUATION', 'JTP_APPROVED', 'REGISTERED', 'DROPPED');

-- CreateEnum
CREATE TYPE "PriorityType" AS ENUM ('AOG', 'ROA', 'CRITICAL');

-- CreateEnum
CREATE TYPE "RepairRoute" AS ENUM ('COE_UNIT', 'OV', 'POOLEX', 'AW_SPARE', 'UNIT_PROCEED');

-- CreateEnum
CREATE TYPE "PriorityState" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "PriorityCloseReason" AS ENUM ('DELIVERED', 'DOWNGRADED');

-- CreateEnum
CREATE TYPE "FodArea" AS ENUM ('AWARENESS', 'CONTROL', 'CRITICAL');

-- CreateEnum
CREATE TYPE "FodStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'CLOSED');

-- CreateEnum
CREATE TYPE "ToolStatus" AS ENUM ('IN', 'OUT', 'MISSING');

-- CreateEnum
CREATE TYPE "TrainingCourse" AS ENUM ('FOD_INITIAL', 'FOD_RECURRENT');

-- CreateEnum
CREATE TYPE "SlaEntity" AS ENUM ('JOB', 'DEMAND', 'OV', 'INVOICE');

-- CreateEnum
CREATE TYPE "WorkflowKind" AS ENUM ('JOB', 'DEMAND', 'OV', 'INVOICE');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "designation" TEXT NOT NULL,
    "branch" "Branch" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "psDate" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "partNo" TEXT NOT NULL,
    "serialNo" TEXT NOT NULL,
    "category" "ItemCategory" NOT NULL,
    "originUnit" TEXT NOT NULL,
    "repairUnit" "Branch" NOT NULL,
    "status" "JobStatus" NOT NULL,
    "location" "Location" NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "statusSince" TIMESTAMP(3) NOT NULL,
    "indentRef" TEXT,
    "ovId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "ordinal" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_priorities" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "type" "PriorityType" NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "route" "RepairRoute" NOT NULL,
    "suffixK" BOOLEAN NOT NULL DEFAULT false,
    "state" "PriorityState" NOT NULL DEFAULT 'OPEN',
    "colRef" TEXT NOT NULL,
    "raisedAt" TIMESTAMP(3) NOT NULL,
    "raisedBy" TEXT NOT NULL,
    "edd" TEXT,
    "remark" TEXT,
    "closedAt" TIMESTAMP(3),
    "closeReason" "PriorityCloseReason",

    CONSTRAINT "job_priorities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "demands" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "partDescription" TEXT NOT NULL,
    "partNo" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "status" "DemandStatus" NOT NULL,
    "statusSince" TIMESTAMP(3) NOT NULL,
    "raisedBy" TEXT NOT NULL,
    "branch" "Branch" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "ordinal" INTEGER NOT NULL DEFAULT 0,
    "stockF244Ref" TEXT,
    "stockAvailable" BOOLEAN,
    "stockHoldingUnit" TEXT,
    "rfqRef" TEXT,
    "evalF221Ref" TEXT,
    "evalSupplierId" TEXT,
    "evalLocalPurchase" BOOLEAN,
    "evalF241Ref" TEXT,
    "poRef" TEXT,
    "discF217Ref" TEXT,
    "discNote" TEXT,

    CONSTRAINT "demands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotations" (
    "id" SERIAL NOT NULL,
    "demandId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "supplier" TEXT NOT NULL,
    "priceMYR" DECIMAL(14,2) NOT NULL,
    "eddDays" INTEGER NOT NULL,
    "remarks" TEXT,
    "seq" INTEGER NOT NULL,

    CONSTRAINT "quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ov_repairs" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "defectReportRef" TEXT NOT NULL,
    "am75Ref" TEXT NOT NULL,
    "vendorId" TEXT,
    "vendorName" TEXT,
    "f134Ref" TEXT,
    "poRef" TEXT,
    "costMYR" DECIMAL(14,2),
    "eddDays" INTEGER,
    "aboveIndent" BOOLEAN,
    "f119Ref" TEXT,
    "status" "OvStatus" NOT NULL,
    "statusSince" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "ordinal" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ov_repairs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partners" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PartnerType" NOT NULL,
    "status" "PartnerStatus" NOT NULL,
    "country" TEXT NOT NULL,
    "certifications" TEXT[],
    "lists" TEXT[],
    "rating" INTEGER,
    "evaluationRef" TEXT,
    "siteAuditRef" TEXT,
    "lastAssessed" TEXT,
    "nextReassessment" TEXT,
    "nonConformances" INTEGER NOT NULL DEFAULT 0,
    "factorsEvaluated" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "ordinal" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cars" (
    "id" SERIAL NOT NULL,
    "partnerId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,

    CONSTRAINT "cars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fod_incidents" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "partName" TEXT NOT NULL,
    "typeModel" TEXT NOT NULL,
    "serialNo" TEXT NOT NULL,
    "area" "FodArea" NOT NULL,
    "location" TEXT NOT NULL,
    "discovered" TEXT NOT NULL,
    "rootCause" TEXT,
    "correctiveAction" TEXT,
    "reporter" TEXT NOT NULL,
    "focalPoint" TEXT NOT NULL,
    "status" "FodStatus" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "ordinal" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "fod_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tools" (
    "tag" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "board" TEXT NOT NULL,
    "holder" TEXT,
    "status" "ToolStatus" NOT NULL,
    "since" TIMESTAMP(3) NOT NULL,
    "ordinal" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "tools_pkey" PRIMARY KEY ("tag")
);

-- CreateTable
CREATE TABLE "training_records" (
    "id" SERIAL NOT NULL,
    "person" TEXT NOT NULL,
    "course" "TrainingCourse" NOT NULL,
    "date" TEXT NOT NULL,
    "nextDue" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "training_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "stream" "InvoiceStream" NOT NULL,
    "jobId" TEXT,
    "customer" TEXT NOT NULL,
    "period" TEXT,
    "amountMYR" DECIMAL(14,2) NOT NULL,
    "gstRate" DECIMAL(5,2) NOT NULL,
    "gstMYR" DECIMAL(14,2) NOT NULL,
    "totalMYR" DECIMAL(14,2) NOT NULL,
    "status" "InvoiceStatus" NOT NULL,
    "statusSince" TIMESTAMP(3) NOT NULL,
    "f311Ref" TEXT,
    "ctcRef" TEXT,
    "customerSignRef" TEXT,
    "correctnessBy" TEXT,
    "salesPerfRef" TEXT,
    "paymentRef" TEXT,
    "paidAt" TEXT,
    "outstanding" BOOLEAN NOT NULL DEFAULT true,
    "raisedBy" TEXT NOT NULL,
    "branch" "Branch" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "ordinal" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_entries" (
    "id" BIGSERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "by" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "action" TEXT NOT NULL,
    "fields" JSONB,
    "seq" INTEGER NOT NULL,
    "jobId" TEXT,
    "jobPriorityId" TEXT,
    "demandId" TEXT,
    "ovId" TEXT,
    "partnerId" TEXT,
    "fodId" TEXT,
    "invoiceId" TEXT,

    CONSTRAINT "audit_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_records" (
    "id" BIGSERIAL NOT NULL,
    "formNo" TEXT NOT NULL,
    "refNo" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "by" TEXT NOT NULL,
    "note" TEXT,
    "seq" INTEGER NOT NULL,
    "jobId" TEXT,
    "demandId" TEXT,
    "ovId" TEXT,
    "invoiceId" TEXT,

    CONSTRAINT "form_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transition_rules" (
    "id" SERIAL NOT NULL,
    "kind" "WorkflowKind" NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "labelMs" TEXT NOT NULL,
    "roles" "Role"[],
    "requires" JSONB NOT NULL,
    "setLocation" "Location",
    "seq" INTEGER NOT NULL,

    CONSTRAINT "transition_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_rules" (
    "id" TEXT NOT NULL,
    "entity" "SlaEntity" NOT NULL,
    "status" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "rule" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,

    CONSTRAINT "sla_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_streams" (
    "id" "InvoiceStream" NOT NULL,
    "label" TEXT NOT NULL,
    "labelMs" TEXT NOT NULL,
    "customer" TEXT NOT NULL,
    "perJob" BOOLEAN NOT NULL,
    "docSet" TEXT[],
    "deadlines" JSONB NOT NULL,
    "seq" INTEGER NOT NULL,

    CONSTRAINT "invoice_streams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_closures" (
    "week" INTEGER NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "weekly_closures_pkey" PRIMARY KEY ("week")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "jobs_status_idx" ON "jobs"("status");

-- CreateIndex
CREATE INDEX "jobs_status_statusSince_idx" ON "jobs"("status", "statusSince");

-- CreateIndex
CREATE INDEX "jobs_repairUnit_idx" ON "jobs"("repairUnit");

-- CreateIndex
CREATE INDEX "jobs_ordinal_idx" ON "jobs"("ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "job_priorities_jobId_key" ON "job_priorities"("jobId");

-- CreateIndex
CREATE INDEX "job_priorities_state_idx" ON "job_priorities"("state");

-- CreateIndex
CREATE INDEX "demands_status_idx" ON "demands"("status");

-- CreateIndex
CREATE INDEX "demands_status_statusSince_idx" ON "demands"("status", "statusSince");

-- CreateIndex
CREATE INDEX "demands_jobId_idx" ON "demands"("jobId");

-- CreateIndex
CREATE INDEX "demands_ordinal_idx" ON "demands"("ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "quotations_demandId_seq_key" ON "quotations"("demandId", "seq");

-- CreateIndex
CREATE INDEX "ov_repairs_status_idx" ON "ov_repairs"("status");

-- CreateIndex
CREATE INDEX "ov_repairs_status_statusSince_idx" ON "ov_repairs"("status", "statusSince");

-- CreateIndex
CREATE INDEX "ov_repairs_ordinal_idx" ON "ov_repairs"("ordinal");

-- CreateIndex
CREATE INDEX "partners_status_idx" ON "partners"("status");

-- CreateIndex
CREATE INDEX "partners_type_idx" ON "partners"("type");

-- CreateIndex
CREATE INDEX "partners_ordinal_idx" ON "partners"("ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "cars_partnerId_seq_key" ON "cars"("partnerId", "seq");

-- CreateIndex
CREATE INDEX "fod_incidents_status_idx" ON "fod_incidents"("status");

-- CreateIndex
CREATE INDEX "fod_incidents_ordinal_idx" ON "fod_incidents"("ordinal");

-- CreateIndex
CREATE INDEX "tools_status_idx" ON "tools"("status");

-- CreateIndex
CREATE INDEX "tools_ordinal_idx" ON "tools"("ordinal");

-- CreateIndex
CREATE INDEX "training_records_ordinal_idx" ON "training_records"("ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "training_records_person_course_key" ON "training_records"("person", "course");

-- CreateIndex
CREATE INDEX "invoices_status_idx" ON "invoices"("status");

-- CreateIndex
CREATE INDEX "invoices_status_statusSince_idx" ON "invoices"("status", "statusSince");

-- CreateIndex
CREATE INDEX "invoices_outstanding_idx" ON "invoices"("outstanding");

-- CreateIndex
CREATE INDEX "invoices_ordinal_idx" ON "invoices"("ordinal");

-- CreateIndex
CREATE INDEX "audit_entries_jobId_seq_idx" ON "audit_entries"("jobId", "seq");

-- CreateIndex
CREATE INDEX "audit_entries_jobPriorityId_seq_idx" ON "audit_entries"("jobPriorityId", "seq");

-- CreateIndex
CREATE INDEX "audit_entries_demandId_seq_idx" ON "audit_entries"("demandId", "seq");

-- CreateIndex
CREATE INDEX "audit_entries_ovId_seq_idx" ON "audit_entries"("ovId", "seq");

-- CreateIndex
CREATE INDEX "audit_entries_partnerId_seq_idx" ON "audit_entries"("partnerId", "seq");

-- CreateIndex
CREATE INDEX "audit_entries_fodId_seq_idx" ON "audit_entries"("fodId", "seq");

-- CreateIndex
CREATE INDEX "audit_entries_invoiceId_seq_idx" ON "audit_entries"("invoiceId", "seq");

-- CreateIndex
CREATE INDEX "audit_entries_at_idx" ON "audit_entries"("at");

-- CreateIndex
CREATE INDEX "form_records_jobId_seq_idx" ON "form_records"("jobId", "seq");

-- CreateIndex
CREATE INDEX "form_records_demandId_seq_idx" ON "form_records"("demandId", "seq");

-- CreateIndex
CREATE INDEX "form_records_ovId_seq_idx" ON "form_records"("ovId", "seq");

-- CreateIndex
CREATE INDEX "form_records_invoiceId_seq_idx" ON "form_records"("invoiceId", "seq");

-- CreateIndex
CREATE INDEX "form_records_formNo_idx" ON "form_records"("formNo");

-- CreateIndex
CREATE INDEX "transition_rules_kind_seq_idx" ON "transition_rules"("kind", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "transition_rules_kind_from_to_key" ON "transition_rules"("kind", "from", "to");

-- CreateIndex
CREATE INDEX "sla_rules_entity_idx" ON "sla_rules"("entity");

-- AddForeignKey
ALTER TABLE "job_priorities" ADD CONSTRAINT "job_priorities_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demands" ADD CONSTRAINT "demands_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_demandId_fkey" FOREIGN KEY ("demandId") REFERENCES "demands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ov_repairs" ADD CONSTRAINT "ov_repairs_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cars" ADD CONSTRAINT "cars_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_entries" ADD CONSTRAINT "audit_entries_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_entries" ADD CONSTRAINT "audit_entries_jobPriorityId_fkey" FOREIGN KEY ("jobPriorityId") REFERENCES "job_priorities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_entries" ADD CONSTRAINT "audit_entries_demandId_fkey" FOREIGN KEY ("demandId") REFERENCES "demands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_entries" ADD CONSTRAINT "audit_entries_ovId_fkey" FOREIGN KEY ("ovId") REFERENCES "ov_repairs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_entries" ADD CONSTRAINT "audit_entries_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_entries" ADD CONSTRAINT "audit_entries_fodId_fkey" FOREIGN KEY ("fodId") REFERENCES "fod_incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_entries" ADD CONSTRAINT "audit_entries_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_records" ADD CONSTRAINT "form_records_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_records" ADD CONSTRAINT "form_records_demandId_fkey" FOREIGN KEY ("demandId") REFERENCES "demands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_records" ADD CONSTRAINT "form_records_ovId_fkey" FOREIGN KEY ("ovId") REFERENCES "ov_repairs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_records" ADD CONSTRAINT "form_records_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

