import { getDb } from "./db";
import { randomUUID } from "node:crypto";

// ============================================================
// Matching Engine
//
// Two entry points feed this:
//  1. ingestSms()      -> new SMS arrives, try to match it to
//                          any PENDING/SUBMITTED order waiting
//                          on that receiving account.
//  2. submitTrxId()     -> customer types in their TrxID, try to
//                          match it against SMS already ingested
//                          (or leave PENDING->SUBMITTED if the
//                          SMS hasn't arrived yet — matched later
//                          by ingestSms when it does).
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
// ============================================================

function logAudit(actor: string, action: string, targetId: string | null, detail?: unknown) {
  const db = getDb();
  db.prepare(
    `INSERT INTO audit_log (id, actor, action, target_id, detail) VALUES (?, ?, ?, ?, ?)`
  ).run(randomUUID(), actor, action, targetId, detail ? JSON.stringify(detail) : null);
}

function approveOrder(orderId: string, smsId: string) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE orders
     SET status = 'APPROVED', matched_sms_id = ?, approved_at = ?, updated_at = ?
     WHERE id = ?`
  ).run(smsId, now, now, orderId);

  db.prepare(`UPDATE incoming_sms SET is_used = 1 WHERE id = ?`).run(smsId);

  logAudit("system", "order.approved", orderId, { smsId });
}

/**
 * Called when a new SMS is ingested from the forwarder webhook.
 * Tries to find a waiting order (PENDING or SUBMITTED) on the same
 * receiving account whose customer-submitted TrxID exactly matches
 * this SMS's parsed TrxID (and amount). An order that hasn't had a
 * TrxID submitted yet (still PENDING with submitted_trx_id IS NULL)
 * cannot be matched by this function — it can only move to SUBMITTED
 * via submitTrxId(), and is approved later when its SMS arrives.
 */
export function tryMatchSmsToOrder(smsId: string): { matchedOrderId: string | null } {
  const db = getDb();

  const sms = db
    .prepare(`SELECT * FROM incoming_sms WHERE id = ?`)
    .get(smsId) as any;

  if (!sms || sms.parse_status !== "PARSED" || sms.is_used) {
    return { matchedOrderId: null };
  }

  // Priority 1: an order whose customer already submitted this exact TrxID
  const byTrxId = db
    .prepare(
      `SELECT * FROM orders
       WHERE receiving_account_id = ?
         AND status IN ('PENDING','SUBMITTED')
         AND submitted_trx_id = ?
         AND amount_bdt = ?
       ORDER BY created_at ASC LIMIT 1`
    )
    .get(sms.receiving_account_id, sms.parsed_trx_id, sms.parsed_amount_bdt) as any;

  if (byTrxId) {
    approveOrder(byTrxId.id, smsId);
    return { matchedOrderId: byTrxId.id };
  }

  // No amount-only fallback: an order that hasn't had its TrxID
  // submitted yet is left as-is. It will only be approved once the
  // customer submits a TrxID that matches this (or another) SMS via
  // submitTrxId() below.
  return { matchedOrderId: null };
}

/**
 * Called when a customer submits their TrxID on the checkout page.
 * Tries to match against SMS already ingested. If none found yet,
 * stores the TrxID and moves the order to SUBMITTED — it'll be
 * matched retroactively by tryMatchSmsToOrder() when the SMS lands.
 */
export function submitTrxId(orderId: string, trxId: string, customerMsisdn?: string) {
  const db = getDb();
  const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId) as any;

  if (!order) throw new Error("Order not found");
  if (!["PENDING", "SUBMITTED"].includes(order.status)) {
    throw new Error(`Order is already ${order.status}`);
  }

  const now = new Date().toISOString();
  const cleanTrxId = trxId.trim().toUpperCase();

  db.prepare(
    `UPDATE orders
     SET submitted_trx_id = ?, customer_msisdn = ?, status = 'SUBMITTED', updated_at = ?
     WHERE id = ?`
  ).run(cleanTrxId, customerMsisdn ?? null, now, orderId);

  logAudit("customer", "order.trx_submitted", orderId, { trxId: cleanTrxId });

  // Check if a matching SMS already arrived before the customer submitted
  const existingSms = db
    .prepare(
      `SELECT * FROM incoming_sms
       WHERE receiving_account_id = ?
         AND parsed_trx_id = ?
         AND parsed_amount_bdt = ?
         AND is_used = 0
       ORDER BY received_at ASC LIMIT 1`
    )
    .get(order.receiving_account_id, cleanTrxId, order.amount_bdt) as any;

  if (existingSms) {
    approveOrder(orderId, existingSms.id);
    return { status: "APPROVED" as const };
  }

  return { status: "SUBMITTED" as const };
}

/** Expire any PENDING/SUBMITTED orders past their deadline. Run on a cron/interval. */
export function expireStaleOrders() {
  const db = getDb();
  const result = db
    .prepare(
      `UPDATE orders SET status = 'EXPIRED', updated_at = datetime('now')
       WHERE status IN ('PENDING','SUBMITTED') AND expires_at <= datetime('now')`
    )
    .run();
  return result.changes;
}