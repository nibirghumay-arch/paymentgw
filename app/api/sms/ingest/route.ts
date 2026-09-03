import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { one, run } from "@/lib/db";
import { parseSms } from "@/lib/sms-parser";
import { tryMatchSmsToOrder } from "@/lib/matching";
import { newId } from "@/lib/auth";

// ============================================================
// POST /api/sms/ingest
//
// Called by the Android SMS-forwarder app (e.g. a small app you
// install on the phone holding the owner's bKash/Nagad SIM, or
// a tool like "SMS Forwarder / Webhook SMS") every time a new
// SMS arrives on that device.
//
// Auth: the device_key issued when the admin creates a Receiving
// Account is sent in the body, so we know unambiguously which
// bKash/Nagad number this SMS belongs to (don't rely on parsing
// the number out of the SMS itself — it's not always present).
//
// Body:
//   { "deviceKey": "...", "text": "You have received Tk 500.00 from ...", "sentAt": "2026-09-03T10:00:00Z" }
// ============================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ingestSchema = z.object({
  deviceKey: z.string().min(1),
  text: z.string().min(1),
  sentAt: z.string().datetime().optional(),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = ingestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { deviceKey, text, sentAt } = parsed.data;

  const account = await one<{ id: string; provider: "BKASH" | "NAGAD" | "ROCKET" | "UPAY" }>(
    `SELECT id, provider::text AS provider
       FROM receiving_accounts
      WHERE device_key = $1 AND is_active = TRUE`,
    [deviceKey]
  );

  if (!account) {
    // Deliberately vague — don't reveal whether the key exists at all
    return NextResponse.json({ error: "Unauthorized device" }, { status: 401 });
  }

  const result = parseSms(account.provider, text);

  const smsId = newId();
  const parseStatus = !result.matched
    ? "UNPARSED"
    : result.isMoneyReceived
      ? "PARSED"
      : "IGNORED";

  // uq_sms_provider_trxid makes a replayed forward a no-op instead of a second
  // credit — the forwarder app retries aggressively on flaky mobile data.
  const inserted = await run(
    `INSERT INTO incoming_sms
       (id, receiving_account_id, raw_text, sent_at, provider, parse_status,
        parsed_trx_id, parsed_amount_bdt, parsed_sender_msisdn)
     VALUES ($1, $2, $3, $4, $5::provider_kind, $6::sms_parse_status, $7, $8, $9)
     ON CONFLICT DO NOTHING`,
    [
      smsId,
      account.id,
      text,
      sentAt ?? null,
      account.provider,
      parseStatus,
      result.trxId ?? null,
      result.amountBdt ?? null,
      result.senderMsisdn ?? null,
    ]
  );

  if (inserted === 0) {
    return NextResponse.json({ ok: true, duplicate: true, parseStatus });
  }

  let matchedOrderId: string | null = null;
  if (parseStatus === "PARSED") {
    const matchResult = await tryMatchSmsToOrder(smsId);
    matchedOrderId = matchResult.matchedOrderId;
  }

  return NextResponse.json({
    ok: true,
    smsId,
    parseStatus,
    matchedOrderId,
  });
}
