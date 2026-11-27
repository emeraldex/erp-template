-- AlterTable
ALTER TABLE "demands" ADD COLUMN     "purchaseAmount" DECIMAL(14,2),
ADD COLUMN     "purchaseAmountBase" DECIMAL(14,2),
ADD COLUMN     "purchaseCurrency" TEXT,
ADD COLUMN     "purchaseRate" DECIMAL(18,8);

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "amount" DECIMAL(14,2),
ADD COLUMN     "currency" TEXT,
ADD COLUMN     "fxGain" DECIMAL(14,2),
ADD COLUMN     "fxRate" DECIMAL(18,8),
ADD COLUMN     "paidBase" DECIMAL(14,2),
ADD COLUMN     "paidRate" DECIMAL(18,8),
ADD COLUMN     "tax" DECIMAL(14,2),
ADD COLUMN     "total" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "ov_repairs" ADD COLUMN     "cost" DECIMAL(14,2),
ADD COLUMN     "costFixedAt" TIMESTAMP(3),
ADD COLUMN     "currency" TEXT,
ADD COLUMN     "fxRate" DECIMAL(18,8);

-- AlterTable
ALTER TABLE "partners" ADD COLUMN     "currency" TEXT;

-- AlterTable
ALTER TABLE "quotations" ADD COLUMN     "currency" TEXT,
ADD COLUMN     "fxRate" DECIMAL(18,8),
ADD COLUMN     "price" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "currency" TEXT,
ADD COLUMN     "fxRate" DECIMAL(18,8),
ADD COLUMN     "unitCostFx" DECIMAL(14,4);

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" SERIAL NOT NULL,
    "currency" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "enteredBy" TEXT NOT NULL,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "exchange_rates_currency_effectiveFrom_key" ON "exchange_rates"("currency", "effectiveFrom");

