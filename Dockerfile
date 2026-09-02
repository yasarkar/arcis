# ==============================================================================
# Arcis Protocol - Production Docker Container
# Multi-stage build for minimal image size and fast startup
# ==============================================================================

# Stage 1: Build Frontend Assets
FROM node:20-alpine AS builder
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source code and build SPA dist
COPY . .
RUN npm run build

# Stage 2: Production Server Runner
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Install production dependencies only
COPY package*.json ./
RUN npm ci --only=production

# Install tsx globally or as runtime executor for TypeScript server.ts
RUN npm install -g tsx

# Copy built frontend assets from builder stage
COPY --from=builder /app/dist ./dist

# Copy backend api & server files
COPY api ./api
COPY server.ts ./
COPY tsconfig*.json ./
COPY src/config ./src/config

EXPOSE 3000

# Run Express server
CMD ["tsx", "server.ts"]
