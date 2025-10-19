# Multi-stage build for Sublair 3D
FROM node:18-alpine AS builder

# Set working directory
WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++ git

# Copy package files
COPY package*.json ./

# Install all dependencies (needed for build)
RUN npm install

# Copy source code
COPY . .

# Build the frontend
ENV NODE_OPTIONS=--openssl-legacy-provider
RUN npm run build

# Production stage
FROM node:18-alpine

# Install ffmpeg for RTMP transcoding
RUN apk add --no-cache ffmpeg

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm install --omit=dev

# Copy built frontend from builder
COPY --from=builder /app/build ./build
COPY --from=builder /app/index.html ./index.html

# Copy backend and necessary files
COPY api ./api
COPY src/css ./src/css
COPY src/lib ./src/lib
COPY src/blend ./src/blend

# Create media directory for RTMP streams
RUN mkdir -p /app/media

# Expose ports
# 3000 - Express API + WebSocket
# 1935 - RTMP streaming input
# 8888 - HTTP-FLV streaming output
EXPOSE 3000 1935 8888

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV RTMP_PORT=1935

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the server
CMD ["node", "api/server.js"]
