FROM node:18-slim

# Install system dependencies including ffmpeg for audio/video compression
RUN apt-get update -y && apt-get install -y \
    openssl \
    libssl-dev \
    ca-certificates \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy ALL project files first
COPY . .

# Install dependencies (devDependencies included for TypeScript compilation)
RUN npm install --legacy-peer-deps

# Generate Prisma client (schema already copied above)
RUN npx prisma generate

# Compile TypeScript (use node directly to avoid permission issues with tsc binary)
RUN node node_modules/typescript/bin/tsc

# Create necessary directories
RUN mkdir -p /app/auth_sessions /app/uploads/pdfs /app/media && \
    chmod -R 777 /app/auth_sessions /app/uploads /app/media

ENV AUTH_DIR=/app/auth_sessions
ENV NODE_ENV=production

EXPOSE 3001

# Push schema changes and start server
CMD npx prisma db push --accept-data-loss && npm start
