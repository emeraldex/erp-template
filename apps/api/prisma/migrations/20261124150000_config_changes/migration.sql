-- CreateTable
CREATE TABLE "config_changes" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "by" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "area" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,

    CONSTRAINT "config_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "config_changes_at_idx" ON "config_changes"("at");

