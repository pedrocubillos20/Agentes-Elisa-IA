FROM node:18

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install --unsafe-perm

COPY . .

RUN npx prisma generate
RUN npx tsc

EXPOSE 3001

CMD ["node", "dist/server.js"]
