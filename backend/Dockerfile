FROM node:20

WORKDIR /app

RUN npm install -g typescript prisma

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install

RUN DATABASE_URL="postgresql://x:x@x:5432/x" prisma generate

COPY . .

RUN tsc

RUN mkdir -p baileys_sessions

EXPOSE 3001

CMD ["node", "dist/server.js"]
