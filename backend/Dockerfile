FROM node:18-slim

# Instalar solo openssl (requerido para Prisma)
RUN apt-get update && apt-get install -y \
    openssl \
    ca-certificates \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY prisma ./prisma/
RUN npx prisma generate

COPY . .
RUN npm run build

# Crear directorios para sesiones de WhatsApp y uploads
RUN mkdir -p /app/auth_sessions /app/uploads/pdfs && chmod -R 777 /app/auth_sessions /app/uploads

# Variables de entorno
ENV AUTH_DIR=/app/auth_sessions
ENV NODE_ENV=production

EXPOSE 3001

# Script de inicio
CMD npx prisma db push --accept-data-loss && npm start
