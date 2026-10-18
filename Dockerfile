# ==============================================================================
# Arcis Protocol - Production Docker Container
# Multi-stage build for minimal image size and fast startup
# ==============================================================================

# Node 22 is required: package.json declares engines.node >=22.12.0.
# Stage 1: Build Frontend Assets + Precompiled Server Bundle
FROM node:22-alpine AS builder
WORKDIR /app

# Install dependencies (devDeps needed for the Vite build + esbuild precompile)
COPY package*.json ./
RUN npm ci

# Copy source code, build the SPA dist and precompile the server.
# Layer order keeps package installs cached across src/api edits.
COPY . .
RUN npm run build
# P13: precompile server.ts (+ api + needed src subtrees) to plain JS so the
# runner ships no TS toolchain and pays no JIT cost at boot. node_modules stay
# external and are installed --only=production in the runner.
RUN npm run build:server

# Stage 2: Production Server Runner
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Install production dependencies only
COPY package*.json ./
RUN npm ci --only=production

# Copy built frontend assets and the precompiled server from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-server ./dist-server

EXPOSE 3000

# Run the precompiled Express server with plain node (no tsx needed)
CMD ["node", "dist-server/server.js"]
