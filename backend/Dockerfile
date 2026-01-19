FROM node:18-slim

# Instalar dependencias del sistema incluyendo git (necesario para algunas dependencias npm)
RUN apt-get update && apt-get install -y \
    openssl \
    ca-certificates \
    curl \
    git \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar package.json
COPY package.json ./

# Instalar dependencias (sin usar package-lock.json para evitar conflictos)
RUN npm install --legacy-peer-deps

# Copiar archivos de Prisma y generar cliente
COPY prisma ./prisma/
RUN npx prisma generate

# Copiar el resto del código
COPY . .

# Compilar TypeScript
RUN npm run build

# Crear directorios necesarios
RUN mkdir -p /app/auth_sessions /app/uploads/pdfs && chmod -R 777 /app/auth_sessions /app/uploads

# Variables de entorno
ENV AUTH_DIR=/app/auth_sessions
ENV NODE_ENV=production

EXPOSE 3001

# Ejecutar migraciones y luego iniciar
CMD npx prisma db push --accept-data-loss && npm start
