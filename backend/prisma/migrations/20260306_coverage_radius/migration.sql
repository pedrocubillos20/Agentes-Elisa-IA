-- Add delivery coverage fields to Assistant model
ALTER TABLE "Assistant" ADD COLUMN IF NOT EXISTS "coverageLat" DOUBLE PRECISION;
ALTER TABLE "Assistant" ADD COLUMN IF NOT EXISTS "coverageLon" DOUBLE PRECISION;
ALTER TABLE "Assistant" ADD COLUMN IF NOT EXISTS "coverageRadiusKm" DOUBLE PRECISION;
