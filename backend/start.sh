#!/bin/sh
# Arranque estable: NO se aplica el schema aquí.
# Las migraciones se corren manualmente con `npm run db:push` (ver LEEME).
# Antes este script hacía `prisma db push --accept-data-loss` en cada reinicio,
# lo que generaba una tormenta de conexiones cuando la DB estaba saturada.
echo "🚀 Iniciando servidor Bizonne..."
node dist/server.js
