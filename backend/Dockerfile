FROM node:20

WORKDIR /app

RUN npm install -g typescript prisma

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install --legacy-peer-deps --ignore-scripts

RUN prisma generate

COPY . .

RUN tsc

EXPOSE 3001

CMD ["node", "dist/server.js"]
