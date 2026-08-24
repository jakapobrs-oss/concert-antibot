-- AlterTable
ALTER TABLE "concerts" ADD COLUMN     "stagePolygon" JSONB;

-- AlterTable
ALTER TABLE "zones" ADD COLUMN     "tier" VARCHAR(50);
