FROM node:18-slim

RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY prisma ./prisma/
RUN npx prisma generate

COPY . .
RUN npm run build

EXPOSE 3001

# Script de inicio que ejecuta migraciones y luego inicia el servidor
CMD npx prisma db push --accept-data-loss && npm start
