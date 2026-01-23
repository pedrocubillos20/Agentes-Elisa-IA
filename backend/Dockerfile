FROM node:18-slim

WORKDIR /app

RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm install --legacy-peer-deps

COPY prisma ./prisma/

RUN node node_modules/prisma/build/index.js generate

COPY . .

RUN node node_modules/typescript/bin/tsc

EXPOSE 3001

CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && node dist/server.js"]