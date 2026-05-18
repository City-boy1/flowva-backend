# ── Build stage ───────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY prisma ./prisma/
COPY src ./src/

RUN npx prisma generate
RUN npm run build

# ── Production stage ──────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY --from=builder /app/dist      ./dist
COPY --from=builder /app/prisma    ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Non-root user for security
RUN addgroup -S flowva && adduser -S flowva -G flowva
USER flowva

EXPOSE 5000

# Run migrations then start
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]