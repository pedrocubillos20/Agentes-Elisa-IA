FROM node:18-slim

# Instalar OpenSSL y dependencias necesarias para Prisma
RUN apt-get update -y && apt-get install -y openssl libssl-dev ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar TODO el código
COPY . .

# Instalar dependencias
RUN npm install

# Fix permissions for ALL binaries
RUN chmod -R 755 node_modules/.bin/ 2>/dev/null || true
RUN chmod -R 755 node_modules/prisma/ 2>/dev/null || true
RUN chmod -R 755 node_modules/typescript/ 2>/dev/null || true

# Generar cliente Prisma
RUN node node_modules/prisma/build/index.js generate

# Compilar TypeScript
RUN node node_modules/typescript/bin/tsc

# Exponer puerto
EXPOSE 3000

# Comando de inicio
CMD node node_modules/prisma/build/index.js db push --skip-generate && npm start
