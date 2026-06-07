# FLOWVA Backend

Production backend for the FLOWVA global motion graphics marketplace.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20 + TypeScript (ESM) |
| Framework | Express 4 |
| SQL DB | PostgreSQL via Neon + Prisma ORM |
| NoSQL DB | MongoDB Atlas + Mongoose |
| Cache / Rate Limit | Upstash Redis |
| Queue | BullMQ + ioredis |
| Media | Cloudinary |
| Email | Resend |
| Monitoring | Sentry |
| Payments | Paystack + Flutterwave |

## Payment Architecture

- **Buyers** pay via Paystack (card, mobile money, bank transfer)
- **Creators** receive 70% (or 90% if early adopter) via their chosen payout method:
  - MTN Mobile Money (Ghana)
  - Telecel Cash (Ghana)
  - AirtelTigo Money (Ghana)
  - Payoneer (international)
  - Bank Transfer (international)
  - Wise (international)
  - Skrill (international)
- **Platform commission** (30%) auto-disbursed to admin MTN MoMo via Flutterwave

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Fill in all values

# 3. Generate Prisma client
npm run prisma:generate

# 4. Push schema to database
npm run prisma:push

# 5. Start development server
npm run dev
```

## Project Structure

```
src/
├── server.ts          — Express app bootstrap & Sentry
├── routes/            — Route definitions
├── controllers/       — Request handlers (thin)
├── services/          — Business logic
├── middleware/         — Auth, rate limit, validation, errors
├── db/
│   ├── prisma.ts      — Prisma client singleton
│   └── mongoose.ts    — Mongoose connection
├── queues/            — BullMQ workers & producers
└── utils/             — Logger, JWT, crypto, email helpers
prisma/
└── schema.prisma      — Full PostgreSQL schema
```

## API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/auth/signup | Register buyer or creator |
| POST | /api/auth/login | Login |
| POST | /api/auth/refresh | Refresh access token |
| POST | /api/auth/logout | Logout |
| GET | /api/auth/verify-email/:token | Verify email |
| POST | /api/payments/initialize | Start checkout |
| GET | /api/payments/verify/:ref | Verify payment |
| POST | /api/payments/webhook/paystack | Paystack webhook |
| POST | /api/payments/webhook/flutterwave | Flutterwave webhook |
| POST | /api/payouts/withdraw | Creator withdrawal |
| GET | /api/payouts/settings | Get payout settings |
| PUT | /api/payouts/settings | Update payout settings |
| POST | /api/templates | Upload template |
| GET | /api/templates | List templates |
| GET | /api/templates/:id | Get template |
| POST | /api/projects | Post project |
| GET | /api/projects | Browse projects |
| POST | /api/projects/:id/bids | Submit bid |
| POST | /api/projects/:id/bids/:bidId/accept | Accept bid |
| GET | /api/health | Health check |

## Deployment on Render

1. Push to GitHub
2. Connect repo in Render dashboard
3. Render detects `render.yaml` automatically
4. Set secret environment variables in Render dashboard
5. Deploy

## Security Features

- argon2id password hashing
- JWT access (15 min) + httpOnly refresh token (7 days)
- Zod input validation on all routes
- Strict CORS (frontend URL only)
- Tiered rate limiting (global / auth / upload / payment)
- Helmet HTTP headers
- HPP parameter pollution prevention
- Sanitized HTML inputs
- NoSQL injection prevention
- Webhook idempotency via ProcessedWebhook table
- No card data ever stored
- Full transaction rollback safety