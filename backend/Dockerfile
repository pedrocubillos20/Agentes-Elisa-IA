FROM node:20

WORKDIR /app

RUN npm install -g typescript prisma

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install --legacy-peer-deps --ignore-scripts

ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"

RUN prisma generate

COPY . .

RUN tsc

EXPOSE 3001

CMD ["node", "dist/server.js"]
