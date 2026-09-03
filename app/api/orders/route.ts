import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { authenticateMerchant, newId } from "@/lib/auth";

// ============================================================
// POST /api/orders
// Merchant creates a new payment request (like Stripe PaymentIntent).
//
// Auth: Authorization: Bearer <apiKey>:<apiSecret>
//
// Body:
//   {
//     "amountBdt": 500,
//     "provider": "BKASH",          // which provider customer will pay with
//     "returnUrl": "https://yoursite.com/thank-you",
//     "metadata": { "orderId": "1234" }
//   }
//
// Response: { reference, checkoutUrl, receivingNumber, amountBdt, expiresAt }
// ============================================================

const createOrderSchema = z.object({
  amountBdt: z.number().positive().max(500000),
  provider: z.enum(["BKASH", "NAGAD", "ROCKET", "UPAY"]),
  returnUrl: z.string().url().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  expiresInMinutes: z.number().int().positive().max(180).optional().default(30),
});

export async function POST(req: NextRequest) {
  const merchant = await authenticateMerchant(req.headers.get("authorization"));
  if (!merchant) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { amountBdt, provider, returnUrl, metadata, expiresInMinutes } = parsed.data;
  const db = getDb();

  // Pick an active receiving account for this provider (round-robin by least-recently-used
  // could be added later; for now, first active one — typically you'll only have one per provider).
  const account = db
    .prepare(
      `SELECT * FROM receiving_accounts WHERE provider = ? AND is_active = 1 ORDER BY created_at ASC LIMIT 1`
    )
    .get(provider) as any;

  if (!account) {
    return NextResponse.json(
      { error: `No active ${provider} receiving account configured. Ask admin to set one up.` },
      { status: 422 }
    );
  }

  const id = newId();
  const reference = newId();
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60_000).toISOString();

  db.prepare(
    `INSERT INTO orders
      (id, reference, merchant_id, amount_bdt, provider, receiving_account_id,
       metadata, return_url, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    reference,
    merchant.id,
    amountBdt,
    provider,
    account.id,
    metadata ? JSON.stringify(metadata) : null,
    returnUrl ?? null,
    expiresAt
  );

  const origin = req.nextUrl.origin;

  return NextResponse.json(
    {
      reference,
      status: "PENDING",
      amountBdt,
      provider,
      receivingNumber: account.msisdn,
      checkoutUrl: `${origin}/checkout/pay/${reference}`,
      expiresAt,
    },
    { status: 201 }
  );
}
