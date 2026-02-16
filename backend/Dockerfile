FROM node:18-slim

# Instalar OpenSSL y dependencias necesarias para Prisma
RUN apt-get update -y && apt-get install -y openssl libssl-dev ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./
COPY prisma ./prisma/

# Instalar dependencias
RUN npm install

# Fix permissions for prisma binary
RUN chmod -R 755 node_modules/.bin/ 2>/dev/null || true
RUN chmod -R 755 node_modules/prisma/ 2>/dev/null || true

# Copiar código fuente
COPY . .

# Generar cliente Prisma y compilar TypeScript
RUN node node_modules/prisma/build/index.js generate
RUN npm run build

# Exponer puerto
EXPOSE 3000

# Comando de inicio
CMD node node_modules/prisma/build/index.js db push --skip-generate && npm start
