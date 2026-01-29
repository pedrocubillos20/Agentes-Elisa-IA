FROM node:18-slim

# Instalar OpenSSL y otras dependencias necesarias
RUN apt-get update -y && apt-get install -y openssl libssl-dev ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./
COPY prisma ./prisma/

# Instalar dependencias
RUN npm install

# Copiar código fuente
COPY . .

# Generar cliente Prisma y compilar TypeScript
RUN npx prisma generate
RUN npm run build

# Exponer puerto
EXPOSE 3000

# Comando de inicio
CMD ["npm", "start"]
