import { createHmac, timingSafeEqual } from "node:crypto";
import { one, run, sql } from "./db";
import { newId } from "./auth";

// ============================================================
// Outbound merchant webhooks.
//
// When an order reaches APPROVED (auto-matched from SMS, or
// manually approved by an admin) the merchant's backend has to be
// told so it can credit the customer. The merchant must never
// trust the browser for this, so we sign every delivery.
//
// Header:  X-Gateway-Signature: t=<unix>,v1=<hex hmac-sha256>
// Signed:  `${t}.${rawJsonBody}` with the merchant's webhook_secret
//
// Delivery is best-effort inline, then retried by the scheduled
// function at netlify/functions/expire-orders.mts, which calls
// GET /api/cron/expire.
// ============================================================

const MAX_ATTEMPTS = 8;
const TIMEOUT_MS = 8_000;

export interface OrderWebhookPayload {
  event: "order.approved" | "order.rejected" | "order.expired";
  reference: string;
  status: string;
  amountBdt: number;
  currency: string;
  provider: string;
  trxId: string | null;
  customerMsisdn: string | null;
  receivingNumber: string;
  metadata: Record<string, unknown> | null;
  approvedAt: string | null;
  createdAt: string;
}

interface DispatchRow {
  id: string;
  reference: string;
  status: string;
  amount_bdt: number;
  currency: string;
  provider: string;
  submitted_trx_id: string | null;
  customer_msisdn: string | null;
  metadata: Record<string, unknown> | null;
  approved_at: Date | null;
  created_at: Date;
  webhook_attempts: number;
  receiving_msisdn: string;
  webhook_url: string | null;
  webhook_secret: string | null;
}

const DISPATCH_SELECT = `
  SELECT o.id, o.reference, o.status::text AS status, o.amount_bdt, o.currency,
         o.provider::text AS provider, o.submitted_trx_id, o.customer_msisdn,
         o.metadata, o.approved_at, o.created_at, o.webhook_attempts,
         r.msisdn AS receiving_msisdn,
         m.webhook_url, m.webhook_secret
    FROM orders o
    JOIN receiving_accounts r ON r.id = o.receiving_account_id
    JOIN merchants m          ON m.id = o.merchant_id
`;

export function signPayload(secret: string, timestamp: number, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/**
 * Verifies a signature header. Exported so the same logic can be
 * unit-tested and mirrored on the merchant side.
 */
export function verifySignature(
  secret: string,
  header: string | null,
  body: string,
  toleranceSeconds = 300
): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((kv) => kv.trim().split("=") as [string, string])
  );
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!t || !v1) return false;
  if (Math.abs(Date.now() / 1000 - t) > toleranceSeconds) return false;

  const expected = Buffer.from(signPayload(secret, t, body), "hex");
  const given = Buffer.from(v1, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

function buildPayload(row: DispatchRow): OrderWebhookPayload {
  const event =
    row.status === "APPROVED"
      ? "order.approved"
      : row.status === "REJECTED"
        ? "order.rejected"
        : "order.expired";

  return {
    event,
    reference: row.reference,
    status: row.status,
    amountBdt: Number(row.amount_bdt),
    currency: row.currency,
    provider: row.provider,
    trxId: row.submitted_trx_id,
    customerMsisdn: row.customer_msisdn,
    receivingNumber: row.receiving_msisdn,
    metadata: row.metadata,
    approvedAt: row.approved_at ? row.approved_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}

async function logAudit(action: string, targetId: string, detail: unknown) {
  await run(
    `INSERT INTO audit_log (id, actor, action, target_id, detail)
     VALUES ($1, 'system', $2, $3, $4)`,
    [newId(), action, targetId, detail ? JSON.stringify(detail) : null]
  );
}

/**
 * Deliver (or re-deliver) the webhook for one order.
 * Never throws — failures are recorded on the order for the retry sweep.
 */
export async function deliverOrderWebhook(orderId: string): Promise<boolean> {
  const row = await one<DispatchRow>(`${DISPATCH_SELECT} WHERE o.id = $1`, [orderId]);
  if (!row) return false;

  if (!row.webhook_url || !row.webhook_secret) {
    await run(`UPDATE orders SET webhook_status = 'NONE' WHERE id = $1`, [orderId]);
    return false;
  }

  const body = JSON.stringify(buildPayload(row));
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signPayload(row.webhook_secret, timestamp, body);
  const attempt = row.webhook_attempts + 1;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(row.webhook_url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gateway-signature": `t=${timestamp},v1=${signature}`,
        "x-gateway-event": buildPayload(row).event,
        "x-gateway-delivery": `${orderId}:${attempt}`,
      },
      body,
      signal: controller.signal,
    });

    if (res.ok) {
      await run(
        `UPDATE orders
            SET webhook_status = 'DELIVERED', webhook_sent_at = now(),
                webhook_attempts = $2, webhook_last_error = NULL, updated_at = now()
          WHERE id = $1`,
        [orderId, attempt]
      );
      return true;
    }

    const text = (await res.text().catch(() => "")).slice(0, 300);
    await recordFailure(orderId, attempt, `HTTP ${res.status}: ${text}`);
    return false;
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown transport error";
    await recordFailure(orderId, attempt, reason);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function recordFailure(orderId: string, attempt: number, error: string) {
  const exhausted = attempt >= MAX_ATTEMPTS;
  await run(
    `UPDATE orders
        SET webhook_status = $3, webhook_attempts = $2,
            webhook_last_error = $4, updated_at = now()
      WHERE id = $1`,
    [orderId, attempt, exhausted ? "FAILED" : "PENDING", error]
  );
  if (exhausted) {
    await logAudit("webhook.exhausted", orderId, { attempt, error });
  }
}

/** Mark an order's webhook as owed, then try once immediately. */
export async function queueOrderWebhook(orderId: string): Promise<void> {
  await run(
    `UPDATE orders SET webhook_status = 'PENDING', updated_at = now()
      WHERE id = $1 AND webhook_status <> 'DELIVERED'`,
    [orderId]
  );
  await deliverOrderWebhook(orderId);
}

/**
 * Retry sweep for the scheduled function. Exponential-ish backoff is
 * approximated by only retrying rows whose last update is older than
 * 2^attempts minutes.
 */
export async function retryPendingWebhooks(limit = 25): Promise<{ retried: number; delivered: number }> {
  const rows = await sql<{ id: string }>(
    `SELECT id FROM orders
      WHERE webhook_status = 'PENDING'
        AND webhook_attempts < $2
        AND updated_at < now() - (interval '1 minute' * power(2, webhook_attempts))
      ORDER BY updated_at ASC
      LIMIT $1`,
    [limit, MAX_ATTEMPTS]
  );

  let delivered = 0;
  for (const row of rows) {
    if (await deliverOrderWebhook(row.id)) delivered += 1;
  }
  return { retried: rows.length, delivered };
}
