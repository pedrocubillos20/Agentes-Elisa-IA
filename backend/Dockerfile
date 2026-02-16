FROM node:18-slim

RUN apt-get update -y && apt-get install -y openssl libssl-dev ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY . .

RUN npm install

# Fix permissions
RUN chmod -R 755 node_modules/.bin/ 2>/dev/null || true

# Generate Prisma client (using node directly, NOT npx)
RUN node node_modules/prisma/build/index.js generate

# Compile TypeScript (using node directly, NOT npx)
RUN node node_modules/typescript/bin/tsc

EXPOSE 3000

CMD node node_modules/prisma/build/index.js db push --skip-generate && node dist/server.js
