FROM node:18-slim

RUN apt-get update && apt-get install -y openssl

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install --ignore-scripts
RUN npm install -g typescript
RUN npm install -g prisma

RUN prisma generate

COPY . .

RUN tsc

EXPOSE 3001

CMD ["node", "dist/server.js"]
