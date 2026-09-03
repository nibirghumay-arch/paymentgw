# Deployment — BD Payment Gateway on Netlify

The gateway moved from **SQLite (`better-sqlite3` + `data/gateway.db`) to PostgreSQL**.
Netlify runs every route as a short-lived function on a read-only filesystem, so a
local database file cannot work there — nothing would persist between requests.

What that means in practice:

| | Before | Now |
|---|---|---|
| Driver | `better-sqlite3` (sync) | `pg` (`Pool`, async) |
| Schema | `db/schema.sql` (SQLite) | `db/schema.sql` (Postgres: `ENUM` types, `NUMERIC(14,2)`, `TIMESTAMPTZ`, `JSONB`) |
| Setup | file created on boot | `npm run db:migrate`, run once by you |
| Booleans | `0` / `1` | real `true` / `false` |
| Money | `REAL` | `NUMERIC(14,2)`, parsed back to `number` by a driver type parser |
| Cron | `setInterval` | `netlify/functions/expire-orders.mts` → `GET /api/cron/expire` |

`data/` is gitignored and no longer used — you can delete it once you have migrated.

---

## 1. Create a Postgres database

Any managed Postgres works. [Neon](https://neon.tech) has a free tier that suits this
workload well. From the dashboard, copy **both** connection strings:

- **Pooled** (host contains `-pooler`) → this is `DATABASE_URL`. Every warm function
  container opens at most one connection, but there can be many containers, so the
  pooler is what keeps you inside the connection limit.
- **Direct** → only needed if you prefer running migrations over a non-pooled link.

Keep `?sslmode=require` in the URL; `lib/db.ts` turns TLS on when it sees it.

## 2. Fill in the local `.env`

Copy `.env.example` to `.env` and set every value:

```bash
cp .env.example .env
```

- `DATABASE_URL` — the pooled string from step 1. **Your current `.env` has no
  `DATABASE_URL` yet** (it was not needed under SQLite); the app will refuse to
  start without it.
- `JWT_SECRET`, `CRON_SECRET` — generate each with `openssl rand -hex 32`.
- `PUBLIC_BASE_URL` — `http://localhost:3000` locally; the real site URL in production.

## 3. Create the schema

```bash
npm install
npm run db:migrate
```

`db/schema.sql` is idempotent (`CREATE TABLE IF NOT EXISTS`, guarded `CREATE TYPE`),
so re-running it is safe. It prints the resulting table list. The build does **not** do
this for you — Netlify's build image cannot always reach your database, and a deploy
should never mutate a schema by surprise.

## 4. Create your admin login

```bash
npm run admin:create -- you@example.com "a-strong-password" "Your Name"
```

There is no public signup route; this command is the only way to create an admin. Run
it again with the same email to reset that admin's password.

## 5. Push to GitHub

```bash
git add -A && git commit -m "Migrate gateway to Postgres for Netlify" && git push
```

## 6. Create the Netlify site

**Add new site → Import an existing project →** pick `nibirghumay-arch/paymentgw`.

| Setting | Value |
|---|---|
| Base directory | `bd-payment-gateway` |
| Build command | `npm run build` |
| Publish directory | `.next` |
| Functions directory | `netlify/functions` |

Everything above is already declared in `netlify.toml`, so the defaults Netlify
detects should match. `@netlify/plugin-nextjs` is what turns the App Router, the route
handlers and SSR into functions — without it only static files would deploy.

### Environment variables

Site configuration → Environment variables:

| Key | Value |
|---|---|
| `DATABASE_URL` | pooled Postgres URL |
| `JWT_SECRET` | `openssl rand -hex 32` |
| `CRON_SECRET` | `openssl rand -hex 32` |
| `PUBLIC_BASE_URL` | `https://<your-site>.netlify.app` |
| `NODE_ENV` | `production` |

`PUBLIC_BASE_URL` is only knowable after the first deploy. Deploy once, copy the URL
Netlify assigns, set the variable, then **redeploy** — the checkout links handed to
merchants are built from it.

## 7. Configure the gateway through the admin UI

Sign in at `https://<your-site>.netlify.app/admin/login`.

1. **Receiving Accounts** — add each bKash/Nagad/Rocket/Upay number you actually own
   and will receive Send Money on. Each one is issued a **device key**: that is what
   the SMS forwarder on the phone holding that SIM authenticates with, and it is how an
   inbound SMS is attributed to the right number. Copy it now.
2. **Merchants** — create one for the betting platform. You are shown an **API key**,
   an **API secret** and a **webhook secret** exactly once, at creation. Copy all
   three; they go into the betting backend's environment.
   Set that merchant's **webhook URL** to:

   ```
   https://<backend-site>.netlify.app/api/v1/payment/deposit/bdgateway/webhook
   ```

## 8. Point the SMS forwarder at the gateway

Install any SMS-to-webhook forwarder on the phone holding the SIM and have it POST
every incoming message to:

```
POST https://<your-site>.netlify.app/api/sms/ingest
Content-Type: application/json

{ "deviceKey": "<device key from step 7>", "text": "<full SMS body>", "sentAt": "<ISO timestamp, optional>" }
```

The parser reads the amount and TrxID out of the SMS and auto-approves an order only
when **both the TrxID and the exact amount** match a pending order on that receiving
number. Anything it cannot match is kept in the SMS log for manual approval.

## 9. Scheduled housekeeping

`netlify/functions/expire-orders.mts` declares its own `*/5 * * * *` schedule and calls
`GET /api/cron/expire` with `Authorization: Bearer $CRON_SECRET`. It expires stale
orders and retries webhook deliveries that failed (8 attempts, exponential backoff).
Nothing to configure — but if `CRON_SECRET` is unset the route returns 401 by design,
so orders would never expire.

## 10. Verify the deployment

```bash
curl -s "https://<your-site>.netlify.app/api/cron/expire?token=$CRON_SECRET"
```

A JSON body (not a 401, not an HTML error page) means the function boots, the database
is reachable and `CRON_SECRET` matches. Then run one real ৳10 deposit end to end from
the betting site.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `DATABASE_URL is not set` in the function log | env var missing on the site, or set only for a different deploy context |
| `too many connections` | you used the direct URL instead of the pooled one, or raised `DATABASE_POOL_MAX` above 1 |
| `self-signed certificate in certificate chain` | leave `DATABASE_SSL_STRICT=false` unless you also supply a CA |
| Checkout links point at `localhost` | `PUBLIC_BASE_URL` still holds the local value — fix it and redeploy |
| Orders never expire, webhooks never retry | `CRON_SECRET` unset, so `/api/cron/expire` answers 401 |
| Merchant gets 401 from the API | `Authorization` must be `Bearer <apiKey>:<apiSecret>` — both halves, colon-separated |


