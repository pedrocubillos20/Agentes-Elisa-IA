FROM node:18-slim

# Instalar dependencias para Puppeteer/Chromium
RUN apt-get update && apt-get install -y \
    openssl \
    chromium \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Variables de entorno para Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY prisma ./prisma/
RUN npx prisma generate

COPY . .
RUN npm run build

# Crear directorio para sesiones de WhatsApp
RUN mkdir -p /app/.wwebjs_auth && chmod 777 /app/.wwebjs_auth

EXPOSE 3001

# Script de inicio que ejecuta migraciones y luego inicia el servidor
CMD npx prisma db push --accept-data-loss && npm start
