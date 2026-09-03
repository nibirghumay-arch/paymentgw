import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { one } from "@/lib/db";
import { submitTrxId } from "@/lib/matching";

// ============================================================
// POST /api/orders/:reference/submit-trx
// Called from the public checkout page after the customer has
// sent money and typed in their TrxID. No auth needed (this is
// the customer-facing step) but rate-limited-worthy in production.
// ============================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  trxId: z
    .string()
    .trim()
    .min(6)
    .max(20)
    .regex(/^[A-Za-z0-9]+$/, "TrxID should only contain letters and numbers"),
  customerMsisdn: z
    .string()
    .trim()
    .regex(/^01[3-9]\d{8}$/, "Enter a valid Bangladeshi mobile number")
    .optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ reference: string }> }
) {
  const { reference } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const order = await one<{ id: string; status: string; expired: boolean }>(
    `SELECT id, status::text AS status, (expires_at <= now()) AS expired
       FROM orders WHERE reference = $1`,
    [reference]
  );

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (order.status === "APPROVED") {
    return NextResponse.json({ status: "APPROVED", message: "Already confirmed" });
  }
  if (order.status === "REJECTED") {
    return NextResponse.json({ error: "This order was rejected" }, { status: 409 });
  }
  // Treat a past-deadline order as expired even if the sweep hasn't run yet.
  if (order.status === "EXPIRED" || order.expired) {
    return NextResponse.json({ error: "This payment session has expired" }, { status: 410 });
  }

  try {
    const result = await submitTrxId(order.id, parsed.data.trxId, parsed.data.customerMsisdn);
    return NextResponse.json({
      status: result.status,
      message:
        result.status === "APPROVED"
          ? "Payment verified automatically."
          : "TrxID received. We are matching it against incoming payments — this page will update automatically once confirmed.",
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not submit TrxID" },
      { status: 400 }
    );
  }
}
