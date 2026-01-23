# ============================================
# ELISA IA - Dockerfile para Railway
# Compatible con Supabase PostgreSQL
# ============================================

FROM node:18-alpine

# Instalar OpenSSL para Prisma
RUN apk add --no-cache openssl

WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./
COPY prisma ./prisma/

# Instalar dependencias
RUN npm ci --only=production

# Copiar código fuente
COPY . .

# Generar cliente Prisma
RUN npx prisma generate

# Compilar TypeScript
RUN npm run build

# Exponer puerto
EXPOSE 3000

# Comando de inicio con migración automática
# Esto ejecuta las migraciones antes de iniciar el servidor
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
