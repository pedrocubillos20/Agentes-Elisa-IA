FROM node:20

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install --legacy-peer-deps --ignore-scripts

RUN npx prisma generate

COPY . .

RUN npx tsc

EXPOSE 3001

CMD ["node", "dist/server.js"]
