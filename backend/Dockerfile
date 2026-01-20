FROM node:18-slim

RUN apt-get update && apt-get install -y \
    openssl \
    ca-certificates \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --legacy-peer-deps

COPY prisma ./prisma/
RUN npx prisma generate

COPY . .
RUN npm run build

RUN mkdir -p /app/uploads/pdfs && chmod -R 777 /app/uploads

ENV NODE_ENV=production

EXPOSE 3001

CMD npx prisma db push --accept-data-loss && npm start