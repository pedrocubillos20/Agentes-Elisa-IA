FROM node:18

WORKDIR /app

COPY . .

RUN npm ci || npm install

RUN npx prisma generate || true

RUN npx tsc || ./node_modules/.bin/tsc

EXPOSE 3001

CMD ["node", "dist/server.js"]
