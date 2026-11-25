-- AlterTable
ALTER TABLE "invoice_streams" ADD COLUMN     "requiredFields" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "transition_rules" ADD COLUMN     "effects" JSONB NOT NULL DEFAULT '[]';

