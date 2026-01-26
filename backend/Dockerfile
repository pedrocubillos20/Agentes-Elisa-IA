FROM node:20

WORKDIR /app

RUN npm install -g typescript prisma

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install

ENV DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres"

RUN prisma generate

COPY . .

RUN tsc

RUN mkdir -p baileys_sessions

EXPOSE 3001

CMD ["node", "dist/server.js"]
