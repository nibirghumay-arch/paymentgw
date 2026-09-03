# BD Payment Gateway

A self-hosted payment gateway for Bangladesh mobile financial services
(bKash, Nagad, Rocket, Upay) that uses **Send Money** — not the official
merchant API — and verifies payments **automatically** by matching incoming
SMS notifications to pending orders.

## How it actually works (read this first)

bKash/Nagad do not expose an API to check "did customer X send me TrxID Y"
for ordinary Send Money transfers. That level of verification only exists
if you're an approved bKash/Nagad *merchant* with their official Payment
Gateway API — a separate business registration process.

This project instead automates the same way that most independently-built
"auto gateway" panels in Bangladesh work:

1. You install a small **SMS-forwarding app** on the Android phone that
   holds the owner's bKash/Nagad SIM (see below).
2. Every incoming SMS on that phone — including bKash/Nagad's
   "You have received Tk ..." messages — gets forwarded to this server's
   `/api/sms/ingest` endpoint.
3. The server parses the amount and TrxID out of the SMS text and stores it.
4. When a customer pays and submits their TrxID on the checkout page (or
   the SMS arrives first), the system matches it against pending orders
   and auto-approves — no human ever looks at it.
5. If an SMS format doesn't parse (provider changed their wording, or it's
   an unrelated SMS), it's flagged `UNPARSED` in the admin SMS log for you
   to review, and the order stays pending for manual approval if needed.

**This is genuinely automatic for the vast majority of transactions.** The
edge cases that fall back to manual admin approval are: SMS format changes,
duplicate simultaneous orders for the identical amount (see "Known
limitation" below), and network hiccups on the forwarder phone.

## Project structure

```
app/
  api/
    orders/                    merchant-facing: create order, check status
    orders/[reference]/submit-trx   customer submits TrxID
    sms/ingest                 webhook the SMS-forwarder app calls
    admin/                     admin-only endpoints (session-protected)
  admin/                       admin login + dashboard UI
  checkout/pay/[reference]     public customer checkout page
lib/
  db.ts                        Postgres connection pool (pg)
  sms-parser.ts                regex parsers per provider
  matching.ts                  the auto-verification engine
  auth.ts                      admin JWT + merchant API key auth
db/schema.sql                  full database schema (PostgreSQL)
scripts/migrate.ts             CLI to apply db/schema.sql
scripts/create-admin.ts        CLI to create/update the admin account
netlify/functions/             scheduled function: expire orders, retry webhooks
```

## Setup

```bash
npm install
cp .env.example .env   # then set DATABASE_URL, JWT_SECRET, CRON_SECRET
npm run db:migrate     # applies db/schema.sql (idempotent, safe to re-run)
npm run admin:create -- you@example.com "a-strong-password" "Your Name"
npm run dev
```

Needs a PostgreSQL database — see [DEPLOYMENT.md](DEPLOYMENT.md) for the Netlify
setup and for why a local SQLite file is no longer an option.

Visit `http://localhost:3000/admin/login` and sign in.

### 1. Add your receiving number(s)

In the admin dashboard → **Receiving numbers** → **Add number**. Enter the
real bKash/Nagad/Rocket number that customers will Send Money to. Saving it
generates a unique **device key** — click **SMS forwarder setup** on that
row to see it, along with the exact webhook URL to configure.

### 2. Set up the SMS forwarder on the owner's phone

You need an Android app that forwards incoming SMS as an HTTP POST. Two
practical options:

**Option A — MacroDroid / Tasker (no coding, recommended to start)**
Create a macro: trigger = "SMS Received", action = "HTTP POST" to
`https://yourdomain.com/api/sms/ingest` with JSON body:
```json
{ "deviceKey": "<the device key from step 1>", "text": "%sms_body%" }
```
(the exact variable name depends on which app; MacroDroid uses
`[sms_body]`, Tasker uses `%SMSRB`).

**Option B — a dedicated small SMS-forwarder app**
Several open-source "SMS to webhook forwarder" Android apps exist on
F-Droid/GitHub. Point them at the same URL/body shape above.

Keep this phone charged, connected to the internet, and dedicated to
receiving bKash/Nagad SMS — if it goes offline, incoming payments will sit
as `PENDING` until the customer's TrxID submission triggers a retroactive
match once the SMS eventually arrives (or until you approve manually).

### 3. Create a merchant (API key) for your website

Admin dashboard → **Merchants** → **New merchant**. Copy the `apiKey` and
`apiSecret` shown once — store them in your website's server-side env vars
(never expose `apiSecret` client-side).

## Integrating your website

**Create an order (server-side, on your site's backend):**

```bash
curl -X POST https://yourgateway.com/api/orders \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer pk_xxx:sk_xxx" \
  -d '{
    "amountBdt": 1000,
    "provider": "BKASH",
    "returnUrl": "https://yoursite.com/order/123/complete",
    "metadata": { "orderId": "123" }
  }'
```

Response includes a `checkoutUrl` — redirect your customer there. They'll
see the receiving number, send money, submit their TrxID, and the page
polls status automatically until `APPROVED`.

**Check order status (server-side polling or after redirect):**

```bash
curl https://yourgateway.com/api/orders/<reference> \
  -H "Authorization: Bearer pk_xxx:sk_xxx"
```

`status` will be one of `PENDING`, `SUBMITTED`, `APPROVED`, `REJECTED`,
`EXPIRED`. Only act on `APPROVED` as confirmation of funds received.

Webhook delivery (server calling your `webhookUrl` on status change) is
not yet wired up in this version — poll the status endpoint from your
backend after redirect, or extend `lib/matching.ts`'s `approveOrder()` to
fire a webhook (there's a `webhook_url` column and `webhookSentAt`/
`webhookAttempts` fields on the order already reserved for this).

## Known limitation — read before going live

When `tryMatchSmsToOrder()` can't find an order with a matching *TrxID*
(because the customer hasn't submitted one yet), it falls back to matching
by **amount + receiving account only**, picking the oldest pending order
(FIFO). This is what makes true "send money, walk away, it just works"
possible — but it means **two customers with simultaneously-pending orders
for the exact same amount** could have their payment matched to the wrong
order if their SMS arrives before either submits a TrxID.

Practical mitigations, in order of effort:
1. **Cheapest**: add a small random extra amount per order (e.g. 1000 →
   1000.05) so amounts are always unique. Some Bangladeshi gateways do
   exactly this.
2. Require the customer to submit their TrxID before matching is attempted
   (disable the amount-only fallback in `lib/matching.ts`) — fully safe,
   slightly less "walk away and forget" for the customer.
3. At higher volume, move to the official bKash/Nagad Merchant API instead
   of Send Money — true uniqueness per API-generated invoice, no SMS
   parsing needed at all.

## Production notes

- Runs on PostgreSQL (`pg`), so it deploys to any serverless host — see
  [DEPLOYMENT.md](DEPLOYMENT.md). Point `DATABASE_URL` at a **pooled**
  connection string and leave `DATABASE_POOL_MAX=1`: each warm function
  container needs one connection, and there can be many containers.
- Put this behind HTTPS — the SMS webhook and checkout page both handle
  sensitive data.
- Rotate `JWT_SECRET` and merchant `apiSecret`s if ever leaked.
- Add rate limiting to `/api/orders/[reference]/submit-trx` (public,
  unauthenticated) to prevent TrxID brute-forcing.
- Run `expireStaleOrders()` from `lib/matching.ts` on a schedule — already
  wired: `netlify/functions/expire-orders.mts` calls `/api/cron/expire`
  every 5 minutes, which also retries failed merchant webhooks.
