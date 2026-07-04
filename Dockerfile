# Stage 1: Build the SvelteKit frontend
FROM node:22-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Setup the production Express server
FROM node:22-alpine
WORKDIR /app/server

# Install build dependencies for better-sqlite3 native compilation if needed
RUN apk add --no-cache python3 make g++

COPY server/package*.json ./
RUN npm ci --only=production

COPY server/ ./

# Copy compiled static frontend from Stage 1 to server's public folder
COPY --from=frontend-builder /app/frontend/build ./build

# Create database directory for volume persistence
RUN mkdir -p /data && chown -R node:node /data
ENV DB_PATH=/data/omie_prices.db
ENV PORT=3000
EXPOSE 3000

# Run as non-root user
USER node

CMD ["node", "index.js"]
