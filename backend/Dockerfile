FROM node:18

WORKDIR /app

ENV PRISMA_CLI_BINARY_TARGETS=linux-musl-openssl-3.0.x

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install

RUN chmod -R 777 node_modules/.prisma || true
RUN chmod -R 777 node_modules/@prisma || true

RUN ./node_modules/.bin/prisma generate

COPY . .

RUN ./node_modules/.bin/tsc

EXPOSE 3001

CMD ["node", "dist/server.js"]
