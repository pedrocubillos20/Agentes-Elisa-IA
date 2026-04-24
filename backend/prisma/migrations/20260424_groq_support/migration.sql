-- ============================================================
-- SOPORTE GROQ AI — Campos nuevos en User y Assistant
-- ============================================================

-- 1. Agregar campos Groq al modelo User
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "groqApiKey"       TEXT,
  ADD COLUMN IF NOT EXISTS "groqApiKeyConnected" BOOLEAN DEFAULT false;

-- 2. Agregar proveedor de IA al modelo Assistant
--    aiProvider: 'openai' | 'groq' (default openai para retrocompatibilidad)
ALTER TABLE "Assistant"
  ADD COLUMN IF NOT EXISTS "aiProvider" TEXT DEFAULT 'openai';

-- 3. Índice para búsqueda por proveedor
CREATE INDEX IF NOT EXISTS "Assistant_aiProvider_idx" ON "Assistant"("aiProvider");
