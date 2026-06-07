# ─── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci --prefer-offline

COPY tsconfig*.json ./
COPY src ./src

RUN npm run prisma:generate
RUN npm run build

# ─── Stage 2: Production ──────────────────────────────────────────────────────
FROM node:20-alpine AS production

RUN apk add --no-cache tini

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci --only=production --prefer-offline && \
    npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

RUN addgroup -S flowva && adduser -S flowva -G flowva
RUN mkdir -p /app/logs && chown -R flowva:flowva /app/logs
USER flowva

EXPOSE 5000

# Use tini as PID 1 for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]