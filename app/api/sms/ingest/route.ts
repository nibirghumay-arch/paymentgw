import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
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
// Account is sent as a header, so we know unambiguously which
// bKash/Nagad number this SMS belongs to (don't rely on parsing
// the number out of the SMS itself — it's not always present).
//
// Body:
//   { "deviceKey": "...", "text": "You have received Tk 500.00 from ...", "sentAt": "2026-09-03T10:00:00Z" }
// ============================================================

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
  const db = getDb();

  const account = db
    .prepare(`SELECT * FROM receiving_accounts WHERE device_key = ? AND is_active = 1`)
    .get(deviceKey) as any;

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

  db.prepare(
    `INSERT INTO incoming_sms
      (id, receiving_account_id, raw_text, sent_at, provider, parse_status,
       parsed_trx_id, parsed_amount_bdt, parsed_sender_msisdn)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    smsId,
    account.id,
    text,
    sentAt ?? null,
    account.provider,
    parseStatus,
    result.trxId ?? null,
    result.amountBdt ?? null,
    result.senderMsisdn ?? null
  );

  let matchedOrderId: string | null = null;
  if (parseStatus === "PARSED") {
    const matchResult = tryMatchSmsToOrder(smsId);
    matchedOrderId = matchResult.matchedOrderId;
  }

  return NextResponse.json({
    ok: true,
    smsId,
    parseStatus,
    matchedOrderId,
  });
}
