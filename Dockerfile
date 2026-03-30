# Root Dockerfile — delega al backend/
# Railway busca Dockerfile en la raíz del repo
FROM node:20-slim

RUN apt-get update -y && apt-get install -y \
    openssl \
    libssl-dev \
    ca-certificates \
    ffmpeg \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar desde backend/
COPY backend/ .

RUN npm install --legacy-peer-deps
RUN npx prisma generate
RUN node node_modules/typescript/bin/tsc

RUN mkdir -p /app/auth_sessions /app/uploads/pdfs /app/media && \
    chmod -R 777 /app/auth_sessions /app/uploads /app/media

ENV AUTH_DIR=/app/auth_sessions
ENV NODE_ENV=production

EXPOSE 3000

CMD ["sh", "-c", "npx prisma db push --accept-data-loss && npm start"]
