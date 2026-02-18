FROM node:18-slim

RUN apt-get update -y && apt-get install -y \
    openssl \
    libssl-dev \
    ca-certificates \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --legacy-peer-deps

COPY prisma ./prisma/
RUN npx prisma generate

COPY . .
RUN node node_modules/typescript/bin/tsc

RUN mkdir -p /app/auth_sessions /app/uploads/pdfs /app/media && chmod -R 777 /app/auth_sessions /app/uploads /app/media

ENV AUTH_DIR=/app/auth_sessions
ENV NODE_ENV=production

EXPOSE 3001

CMD npx prisma db push --accept-data-loss && npm start
