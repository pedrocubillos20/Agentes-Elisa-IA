FROM node:18-slim

# Instalar OpenSSL y dependencias necesarias para Prisma
RUN apt-get update -y && apt-get install -y openssl libssl-dev ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./
COPY prisma ./prisma/

# Instalar dependencias con permisos correctos
RUN npm install --unsafe-perm

# Copiar código fuente
COPY . .

# Generar cliente Prisma y compilar TypeScript
RUN npx --yes prisma generate
RUN npm run build

# Exponer puerto
EXPOSE 3000

# Comando de inicio
CMD npx prisma db push --skip-generate && npm start
