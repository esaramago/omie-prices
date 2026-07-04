# Stage 1: Build the SvelteKit frontend
FROM node:22-alpine AS frontend-builder
USER node
WORKDIR /home/node/app
COPY --chown=node:node frontend/package*.json ./
RUN npm ci || npm install
COPY --chown=node:node frontend/vite.config.js frontend/jsconfig.json ./
COPY --chown=node:node frontend/src ./src
COPY --chown=node:node frontend/static ./static
RUN npm run build

# Stage 2: Production runtime image
FROM node:22-alpine
LABEL maintainer="Emanuel Saramago" version="1.0.0" description="OMIE Energy Prices API and Dashboard"
WORKDIR /home/node/app

# Install curl for healthcheck
RUN apk add --no-cache curl

# Copy server dependency manifest
COPY --chown=node:node server/package*.json ./

# Install compile tools temporarily, build native dependencies, and clean up in one step
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
    && (npm ci --only=production || npm install --only=production) \
    && apk del .build-deps

# Copy server application source code
COPY --chown=node:node server/ ./

# Copy compiled static frontend from Stage 1 to server's public folder
COPY --chown=node:node --from=frontend-builder /home/node/app/build ./build

# Create database directory for volume persistence
RUN mkdir -p /data && chown -R node:node /data
VOLUME /data

# Ensure all server files are owned by the node user
RUN chown -R node:node /home/node/app

ENV DB_PATH=/data/omie_prices.db
ENV FRONTEND_BUILD_PATH=/home/node/app/build

ARG PORT=3000
ENV PORT=${PORT}
EXPOSE ${PORT}

# Healthcheck to verify the server status using curl
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl --fail http://localhost:${PORT}/api/status || exit 1

# Audit production dependencies for high/critical security vulnerabilities (non-blocking)
RUN npm audit --production --audit-level=high || true

# Run the container as the non-root 'node' user
USER node

CMD ["node", "index.js"]
