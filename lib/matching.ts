import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { one, run, tx } from "./db";
import { queueOrderWebhook } from "./webhook";

// ============================================================
// Matching Engine
//
// Two entry points feed this:
//  1. tryMatchSmsToOrder() -> new SMS arrives, try to match it to
//                             any PENDING/SUBMITTED order waiting
//                             on that receiving account.
//  2. submitTrxId()        -> customer types in their TrxID, try to
//                             match it against SMS already ingested
//                             (or leave PENDING->SUBMITTED if the
//                             SMS hasn't arrived yet — matched later
//                             by tryMatchSmsToOrder when it does).
//
// A match REQUIRES: same receiving account, same amount, exact
// TrxID equality between what the customer submitted and what the
// SMS reports, and the SMS not already used by another order.
//
// TrxID is treated as the primary key for matching. An SMS arriving
// with no order that has already submitted that exact TrxID is never
// auto-approved on amount alone — amount match without a TrxID match
// is not sufficient, since two customers can be told to pay the same
// amount at the same time. Orders only move to APPROVED once the
// customer-submitted TrxID and the SMS-parsed TrxID agree.
//
// POSTGRES NOTE: on Netlify two invocations can run concurrently
// (the forwarder's SMS POST and the customer's submit-trx POST), so
// every approval happens inside one transaction that takes a
// FOR UPDATE lock on both the order row and the SMS row. The
// `matched_sms_id` UNIQUE constraint is the final backstop against
// one SMS ever paying for two orders.
// ============================================================

async function logAudit(
  client: PoolClient,
  actor: string,
  action: string,
  targetId: string | null,
  detail?: unknown
) {
  await client.query(
    `INSERT INTO audit_log (id, actor, action, target_id, detail)
     VALUES ($1, $2, $3, $4, $5)`,
    [randomUUID(), actor, action, targetId, detail ? JSON.stringify(detail) : null]
  );
}

/** Flip order -> APPROVED and burn the SMS. Caller holds locks on both. */
async function approveOrder(client: PoolClient, orderId: string, smsId: string) {
  await client.query(
    `UPDATE orders
        SET status = 'APPROVED', matched_sms_id = $2, approved_at = now(),
            webhook_status = 'PENDING', updated_at = now()
      WHERE id = $1`,
    [orderId, smsId]
  );
  await client.query(`UPDATE incoming_sms SET is_used = TRUE WHERE id = $1`, [smsId]);
  await logAudit(client, "system", "order.approved", orderId, { smsId });
}

/**
 * Called when a new SMS is ingested from the forwarder webhook.
 * Tries to find a waiting order (PENDING or SUBMITTED) on the same
 * receiving account whose customer-submitted TrxID exactly matches
 * this SMS's parsed TrxID (and amount). An order that hasn't had a
 * TrxID submitted yet cannot be matched here — it can only move to
 * SUBMITTED via submitTrxId(), and is approved once its SMS arrives.
 */
export async function tryMatchSmsToOrder(
  smsId: string
): Promise<{ matchedOrderId: string | null }> {
  const matchedOrderId = await tx(async (client) => {
    const sms = (
      await client.query(
        `SELECT id, receiving_account_id, parsed_trx_id, parsed_amount_bdt,
                parse_status::text AS parse_status, is_used
           FROM incoming_sms
          WHERE id = $1
            FOR UPDATE`,
        [smsId]
      )
    ).rows[0];

    if (!sms || sms.parse_status !== "PARSED" || sms.is_used) return null;

    // An order whose customer already submitted this exact TrxID.
    const order = (
      await client.query(
        `SELECT id FROM orders
          WHERE receiving_account_id = $1
            AND status IN ('PENDING', 'SUBMITTED')
            AND submitted_trx_id = $2
            AND amount_bdt = $3
            AND expires_at > now()
          ORDER BY created_at ASC
          LIMIT 1
          FOR UPDATE`,
        [sms.receiving_account_id, sms.parsed_trx_id, sms.parsed_amount_bdt]
      )
    ).rows[0];

    if (!order) {
      // No amount-only fallback: an order that hasn't had its TrxID
      // submitted yet is left as-is. It will only be approved once the
      // customer submits a TrxID matching this (or another) SMS.
      return null;
    }

    await approveOrder(client, order.id, smsId);
    return order.id as string;
  });

  // Outside the transaction: the merchant must only ever see committed state.
  if (matchedOrderId) await queueOrderWebhook(matchedOrderId);

  return { matchedOrderId };
}

/**
 * Called when a customer submits their TrxID on the checkout page.
 * Tries to match against SMS already ingested. If none found yet,
 * stores the TrxID and moves the order to SUBMITTED — it'll be
 * matched retroactively by tryMatchSmsToOrder() when the SMS lands.
 */
export async function submitTrxId(
  orderId: string,
  trxId: string,
  customerMsisdn?: string
): Promise<{ status: "APPROVED" | "SUBMITTED" }> {
  const cleanTrxId = trxId.trim().toUpperCase();

  const result = await tx(async (client) => {
    const order = (
      await client.query(
        `SELECT id, status::text AS status, receiving_account_id, amount_bdt
           FROM orders
          WHERE id = $1
            FOR UPDATE`,
        [orderId]
      )
    ).rows[0];

    if (!order) throw new Error("Order not found");
    if (!["PENDING", "SUBMITTED"].includes(order.status)) {
      throw new Error(`Order is already ${order.status}`);
    }

    await client.query(
      `UPDATE orders
          SET submitted_trx_id = $2, customer_msisdn = $3,
              status = 'SUBMITTED', updated_at = now()
        WHERE id = $1`,
      [orderId, cleanTrxId, customerMsisdn ?? null]
    );
    await logAudit(client, "customer", "order.trx_submitted", orderId, { trxId: cleanTrxId });

    // Did the SMS already arrive before the customer got here?
    const sms = (
      await client.query(
        `SELECT id FROM incoming_sms
          WHERE receiving_account_id = $1
            AND parsed_trx_id = $2
            AND parsed_amount_bdt = $3
            AND parse_status = 'PARSED'
            AND is_used = FALSE
          ORDER BY received_at ASC
          LIMIT 1
          FOR UPDATE`,
        [order.receiving_account_id, cleanTrxId, order.amount_bdt]
      )
    ).rows[0];

    if (!sms) return { status: "SUBMITTED" as const, orderId: null };

    await approveOrder(client, orderId, sms.id);
    return { status: "APPROVED" as const, orderId };
  });

  if (result.orderId) await queueOrderWebhook(result.orderId);

  return { status: result.status };
}

/**
 * Expire any PENDING/SUBMITTED orders past their deadline.
 * Driven by the Netlify scheduled function (see /api/cron/expire).
 */
export async function expireStaleOrders(): Promise<number> {
  return run(
    `UPDATE orders
        SET status = 'EXPIRED', updated_at = now()
      WHERE status IN ('PENDING', 'SUBMITTED')
        AND expires_at <= now()`
  );
}

/** Admin manual override. Returns the updated row, or null if not found. */
export async function manuallySetOrderStatus(
  orderId: string,
  status: "APPROVED" | "REJECTED",
  adminId: string
) {
  const updated = await tx(async (client) => {
    const order = (
      await client.query(
        `SELECT id, status::text AS status FROM orders WHERE id = $1 FOR UPDATE`,
        [orderId]
      )
    ).rows[0];
    if (!order) return { notFound: true as const };

    if (order.status === "APPROVED") {
      return { conflict: "Already approved" as const };
    }
    if (status === "REJECTED" && order.status === "APPROVED") {
      return { conflict: "Cannot reject an already-approved order" as const };
    }

    await client.query(
      `UPDATE orders
          SET status = $2::order_status,
              approved_at = CASE WHEN $2 = 'APPROVED' THEN now() ELSE approved_at END,
              webhook_status = 'PENDING',
              updated_at = now()
        WHERE id = $1`,
      [orderId, status]
    );
    await logAudit(
      client,
      `admin:${adminId}`,
      status === "APPROVED" ? "order.manual_approve" : "order.manual_reject",
      orderId
    );
    return { ok: true as const };
  });

  if ("ok" in updated) {
    await queueOrderWebhook(orderId);
    const row = await one(`SELECT * FROM orders WHERE id = $1`, [orderId]);
    return { ok: true as const, order: row };
  }
  return updated;
}
