-- Migration to fix Plan enum issue
-- This migration converts the plan column to use the Plan enum properly

-- First, create the Plan enum if it doesn't exist
DO $$ BEGIN
    CREATE TYPE "Plan" AS ENUM ('FREE', 'EMPRENDEDORES', 'NEGOCIOS', 'BUSINESS', 'MARCA_BLANCA');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Alter the User table to use the Plan enum
-- First, we need to handle existing data
ALTER TABLE "User" 
ALTER COLUMN "plan" TYPE "Plan" 
USING (
    CASE 
        WHEN "plan" = 'FREE' THEN 'FREE'::"Plan"
        WHEN "plan" = 'EMPRENDEDORES' THEN 'EMPRENDEDORES'::"Plan"
        WHEN "plan" = 'NEGOCIOS' THEN 'NEGOCIOS'::"Plan"
        WHEN "plan" = 'BUSINESS' THEN 'BUSINESS'::"Plan"
        WHEN "plan" = 'MARCA_BLANCA' THEN 'MARCA_BLANCA'::"Plan"
        ELSE 'FREE'::"Plan"
    END
);

-- Set default value
ALTER TABLE "User" ALTER COLUMN "plan" SET DEFAULT 'FREE'::"Plan";
