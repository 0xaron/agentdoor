FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ---------------------------------------------------------------------------
# Production image
# ---------------------------------------------------------------------------
FROM node:20-alpine

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled output
COPY --from=builder /app/dist ./dist

# Set default port
ENV PORT=3000

EXPOSE 3000

CMD ["node", "dist/index.js"]
