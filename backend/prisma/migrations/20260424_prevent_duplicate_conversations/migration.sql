-- ============================================================
-- PREVENIR CONVERSACIONES DUPLICADAS
-- ============================================================
-- PASO 1: Eliminar duplicados existentes antes de crear el índice
-- Mantiene la conversación con más mensajes (o la más antigua)
-- ============================================================

-- Mover mensajes de duplicados al original más antiguo
WITH ranked AS (
  SELECT 
    id,
    "userId",
    "whatsappLineId",
    RIGHT(REGEXP_REPLACE("recipientId", '[^0-9]', '', 'g'), 10) AS phone10,
    ROW_NUMBER() OVER (
      PARTITION BY 
        "userId",
        RIGHT(REGEXP_REPLACE("recipientId", '[^0-9]', '', 'g'), 10),
        COALESCE("whatsappLineId", 'NO_LINE')
      ORDER BY (SELECT COUNT(*) FROM "Message" m WHERE m."conversationId" = "Conversation".id) DESC, "createdAt" ASC
    ) AS rn
  FROM "Conversation"
  WHERE "isGroup" = false
),
keepers AS (SELECT id FROM ranked WHERE rn = 1),
dupes AS (SELECT id FROM ranked WHERE rn > 1)
UPDATE "Message"
SET "conversationId" = (
  SELECT k.id FROM ranked r
  JOIN keepers k ON k.id = (
    SELECT id FROM ranked r2
    WHERE r2."userId" = r."userId"
      AND r2.phone10 = r.phone10
      AND r2.rn = 1
    LIMIT 1
  )
  WHERE r.id = "Message"."conversationId"
  LIMIT 1
)
WHERE "conversationId" IN (SELECT id FROM dupes);

-- PASO 2: Eliminar duplicados (los que quedaron sin mensajes importantes)
DELETE FROM "Conversation"
WHERE id IN (
  SELECT id FROM (
    SELECT 
      id,
      ROW_NUMBER() OVER (
        PARTITION BY 
          "userId",
          RIGHT(REGEXP_REPLACE("recipientId", '[^0-9]', '', 'g'), 10),
          COALESCE("whatsappLineId", 'NO_LINE')
        ORDER BY (SELECT COUNT(*) FROM "Message" m WHERE m."conversationId" = "Conversation".id) DESC, "createdAt" ASC
      ) AS rn
    FROM "Conversation"
    WHERE "isGroup" = false
  ) sub
  WHERE rn > 1
);

-- ============================================================
-- PASO 3: Crear índice único para prevenir futuros duplicados
-- Nota: Solo para conversaciones individuales (no grupos)
-- ============================================================
-- No agregamos UNIQUE constraint en el schema para no romper
-- código existente, pero sí creamos un índice parcial
CREATE UNIQUE INDEX IF NOT EXISTS "Conversation_userId_phone_line_unique"
ON "Conversation" ("userId", RIGHT(REGEXP_REPLACE("recipientId", '[^0-9]', '', 'g'), 10), COALESCE("whatsappLineId", 'NO_LINE'))
WHERE "isGroup" = false;
