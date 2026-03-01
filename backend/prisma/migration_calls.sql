-- ====================================================
-- 📞 LLAMADAS IA — Migration: CallConfig + Call tables
-- ====================================================
-- Run this SQL in your database (Supabase SQL Editor or psql)
-- ====================================================

-- 1️⃣ CallConfig — Configuración de llamadas por usuario
CREATE TABLE IF NOT EXISTS "CallConfig" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "userId" TEXT NOT NULL,
  
  -- Twilio
  "twilioAccountSid" TEXT NOT NULL DEFAULT '',
  "twilioAuthToken" TEXT NOT NULL DEFAULT '',
  "twilioPhoneNumber" TEXT NOT NULL DEFAULT '',
  
  -- ElevenLabs Conversational AI
  "elevenLabsAgentId" TEXT NOT NULL DEFAULT '',
  "elevenLabsApiKey" TEXT NOT NULL DEFAULT '',
  
  -- Voice
  "voiceId" TEXT NOT NULL DEFAULT '',
  "voiceName" TEXT NOT NULL DEFAULT '',
  
  -- Agent Config
  "systemPrompt" TEXT DEFAULT '',
  "firstMessage" TEXT DEFAULT '',
  "language" TEXT NOT NULL DEFAULT 'es',
  
  -- Feature Flags
  "callsEnabled" BOOLEAN NOT NULL DEFAULT false,
  "autoCallReminders" BOOLEAN NOT NULL DEFAULT false,
  "autoCallFollowup" BOOLEAN NOT NULL DEFAULT false,
  "autoCallReactivation" BOOLEAN NOT NULL DEFAULT false,
  "reminderHoursBefore" INTEGER NOT NULL DEFAULT 24,
  
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT "CallConfig_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CallConfig_userId_key" UNIQUE ("userId"),
  CONSTRAINT "CallConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "CallConfig_userId_idx" ON "CallConfig"("userId");

-- 2️⃣ Call — Registro de cada llamada
CREATE TABLE IF NOT EXISTS "Call" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "userId" TEXT NOT NULL,
  
  "direction" TEXT NOT NULL DEFAULT 'outbound',    -- inbound, outbound
  "type" TEXT NOT NULL DEFAULT 'manual',            -- manual, reminder, followup, reactivation, inbound
  "phoneNumber" TEXT NOT NULL,
  
  "status" TEXT NOT NULL DEFAULT 'initiating',      -- initiating, ringing, in_progress, completed, failed
  "duration" INTEGER DEFAULT 0,                     -- seconds
  
  -- External IDs
  "twilioCallSid" TEXT,
  "agentId" TEXT,
  "elevenLabsConversationId" TEXT,
  
  -- Content
  "transcript" TEXT,
  "recordingUrl" TEXT,
  "context" TEXT,                                    -- JSON context (appointment data, etc)
  "error" TEXT,
  "summary" TEXT,
  
  -- Timestamps
  "answeredAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT "Call_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Call_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "Call_userId_idx" ON "Call"("userId");
CREATE INDEX IF NOT EXISTS "Call_userId_createdAt_idx" ON "Call"("userId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "Call_status_idx" ON "Call"("status");
CREATE INDEX IF NOT EXISTS "Call_twilioCallSid_idx" ON "Call"("twilioCallSid");

-- ✅ Done! Now update your schema.prisma and run: npx prisma db pull
SELECT 'Migration complete: CallConfig + Call tables created' AS result;
