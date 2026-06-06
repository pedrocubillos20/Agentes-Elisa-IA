#!/bin/sh
echo "🔄 Aplicando migraciones DB..."
npx prisma db push --accept-data-loss
echo "✅ DB actualizada, iniciando servidor..."
node dist/server.js
