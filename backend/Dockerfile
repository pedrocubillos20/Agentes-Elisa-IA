FROM node:20-slim

# Install system dependencies including ffmpeg and poppler-utils for PDF text extraction
RUN apt-get update -y && apt-get install -y \
    openssl \
    libssl-dev \
    ca-certificates \
    ffmpeg \
    poppler-utils \
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

EXPOSE 3000

CMD ["npm", "start"]
