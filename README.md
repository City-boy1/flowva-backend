# FLOWVA Backend — Setup & Deployment Guide

Production API for the FLOWVA motion graphics marketplace.
Stack: Node 20 · TypeScript · Express · Prisma (Neon Postgres) · MongoDB Atlas · Cloudinary · Stripe · Upstash Redis · Resend · Sentry

---

## 1 — Clone & Install

```bash
git clone https://github.com/city-boy1/flowva-backend.git
cd flowva-backend
npm install
cp .env.example .env
# Fill in all values in .env before continuing
```

---

## 2 — Neon (PostgreSQL)

1. Go to **neon.tech** → Create Project → Name it `flowva`
2. Copy the **pooled connection string** (important — use pooled, not direct)
3. Paste into `.env` as `DATABASE_URL`
4. Run: `npm run db:push` — creates all tables
5. Optional: `npm run db:studio` — visual DB browser

---

## 3 — MongoDB Atlas

1. Go to **mongodb.com/atlas** → Create free cluster (M0 — no credit card)
2. Database Access → Add user → password auth → read/write to any database
3. Network Access → Add IP → `0.0.0.0/0` (allow all — Render needs this)
4. Clusters → Connect → Drivers → Copy the connection string
5. Replace `<password>` with your DB user password
6. Paste into `.env` as `MONGO_URI`

---

## 4 — Cloudinary

1. **cloudinary.com** → Create free account
2. Dashboard → Copy `Cloud Name`, `API Key`, `API Secret`
3. Paste into `.env` as `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
4. Free tier: 25 GB storage, 25 GB bandwidth/month

**No SDK config file needed** — configured via environment variables in `upload.ts`.

---

## 5 — Stripe

### API Keys
1. **dashboard.stripe.com** → Developers → API Keys
2. Copy `Secret key` → paste as `STRIPE_SECRET_KEY`
3. Use `sk_test_...` for development, `sk_live_...` for production

### Webhooks
1. Stripe Dashboard → Developers → Webhooks → Add endpoint
2. Endpoint URL: `https://your-domain.com/api/payments/webhook`
3. Events to listen for:
   - `checkout.session.completed`
4. Copy `Signing secret` → paste as `STRIPE_WEBHOOK_SECRET`

### Test Card
```
Number:  4242 4242 4242 4242
Expiry:  Any future date
CVC:     Any 3 digits
```

### Stripe Connect (creator payouts)
1. Dashboard → Connect → Settings → Copy `client_id`
2. Paste as `STRIPE_CONNECT_CLIENT_ID`

---

## 6 — Upstash Redis

1. **console.upstash.com** → Create Database → Region closest to your Render server
2. REST API tab → Copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
3. Free tier: 10,000 commands/day

---

## 7 — Resend (Email)

1. **resend.com** → Create account → API Keys → Create Key
2. Paste as `RESEND_API_KEY`
3. Set `ADMIN_EMAIL` to your email (receives DB size alerts)
4. Set `FROM_EMAIL` to your verified domain email (e.g. `noreply@flowva.com`)
5. Add and verify your domain under Resend → Domains

---

## 8 — Sentry

1. **sentry.io** → New Project → Node.js → Name it `flowva-backend`
2. Copy DSN → paste as `SENTRY_DSN`
3. Free tier: 5,000 errors/month

---

## 9 — Local Development

```bash
npm run dev
# Server starts on http://localhost:5000
# Health check: http://localhost:5000/health
```

Test the API:
```bash
# Register
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","email":"test@test.com","password":"password123","role":"creator"}'

# Login
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"password123"}'
```

---

## 10 — Deploy to Render

1. Push your code to a GitHub repo
2. **render.com** → New → Web Service → Connect GitHub repo
3. Settings:
   - **Runtime**: Node
   - **Build Command**: `npm install && npm run build && npx prisma generate`
   - **Start Command**: `npx prisma migrate deploy && node dist/server.js`
   - **Region**: Choose closest to your users
4. Environment Variables → Add all variables from `.env`
5. Deploy → copy the Render URL (e.g. `https://flowva-api.onrender.com`)
6. Update `FRONTEND_URL` in Render env vars to your Netlify URL
7. Update `js/core/api.js` `BASE_URL` in your frontend to the Render URL

---

## 11 — Connect Frontend to Backend

In `flowva-frontend/js/core/api.js`, change:
```js
const BASE_URL = 'http://localhost:5000/api';
```
to:
```js
const BASE_URL = 'https://your-app.onrender.com/api';
```

That's the only change needed. Everything else in the frontend already matches.

---

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/register` | ❌ | Register new user |
| POST | `/api/auth/login` | ❌ | Login |
| POST | `/api/auth/refresh` | 🍪 | Refresh access token |
| POST | `/api/auth/logout` | ❌ | Logout + clear cookie |
| GET | `/api/auth/me` | ✅ | Current user |
| GET | `/api/templates` | ❌ | List templates (filters) |
| GET | `/api/templates/:id` | ❌ | Single template |
| GET | `/api/templates/mine` | ✅ Creator | My templates |
| POST | `/api/templates` | ✅ Creator | Upload template |
| PATCH | `/api/templates/:id` | ✅ Creator | Update template |
| DELETE | `/api/templates/:id` | ✅ | Delete template |
| POST | `/api/payments/checkout` | ✅ | Create Stripe checkout |
| POST | `/api/payments/webhook` | Stripe | Stripe events |
| GET | `/api/payments/onboard` | ✅ Creator | Stripe Connect link |
| GET | `/api/payments/earnings` | ✅ Creator | Earnings breakdown |
| POST | `/api/payments/payout-method` | ✅ Creator | Save payout details |
| GET | `/api/messages/conversations` | ✅ | List conversations |
| GET | `/api/messages/:conversationId` | ✅ | Get messages |
| POST | `/api/messages` | ✅ | Send message |
| GET | `/api/dashboard/overview` | ✅ | Creator stats + chart |
| GET | `/api/dashboard/notifications` | ✅ | Notifications |
| PATCH | `/api/dashboard/notifications/read` | ✅ | Mark all read |
| GET | `/api/dashboard/profile` | ✅ | User profile |
| PATCH | `/api/dashboard/profile` | ✅ | Update profile |
| GET | `/health` | ❌ | Health check |

---

## Commission Structure

| Stage | Creator Earns | Platform Earns |
|-------|--------------|----------------|
| Launch (0–9 templates) | **70%** | 30% |
| Scale (10+ templates, busy) | **60%** | 40% |

To change the split: update `CREATOR_SHARE` in `.env` (e.g. `0.60` for 60/40).
No code changes needed — it reads from environment at runtime.

---

## Security Checklist

- [x] argon2id password hashing (GPU-resistant)
- [x] Access tokens in memory only (frontend never writes to localStorage)
- [x] Refresh tokens in httpOnly cookies (JS cannot read)
- [x] Refresh token rotation on every use
- [x] Token reuse detection → automatic revocation
- [x] Stripe webhook signature verification
- [x] Idempotent webhook processing (prevents double-orders)
- [x] Prisma transaction on order creation (rollback-safe)
- [x] Zod validation on all inputs
- [x] Helmet security headers
- [x] CORS locked to frontend URL only
- [x] Rate limiting: global + per-route + distributed (Upstash)
- [x] No stack traces exposed in production responses
- [x] Non-root Docker user
- [x] Body size limit (10kb) prevents large payload attacks