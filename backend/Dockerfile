FROM node:18

RUN npm install -g typescript prisma

WORKDIR /app

COPY . .

RUN npm install

RUN prisma generate

RUN tsc

EXPOSE 3001

CMD ["node", "dist/server.js"]
