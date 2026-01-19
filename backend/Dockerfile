FROM node:18-slim

RUN apt-get update && apt-get install -y \
    openssl \
    ca-certificates \
    curl \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY prisma ./prisma/
RUN npx prisma generate

COPY . .
RUN npm run build

RUN mkdir -p /app/auth_sessions /app/uploads/pdfs && chmod -R 777 /app/auth_sessions /app/uploads

ENV AUTH_DIR=/app/auth_sessions
ENV NODE_ENV=production

EXPOSE 3001

# Ejecutar migraciones y luego iniciar
CMD npx prisma migrate deploy || npx prisma db push --accept-data-loss; npm start
