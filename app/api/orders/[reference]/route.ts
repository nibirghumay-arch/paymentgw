import { NextRequest, NextResponse } from "next/server";
import { one } from "@/lib/db";
import { authenticateMerchant } from "@/lib/auth";

// ============================================================
// GET /api/orders/:reference
// Used by merchant backend (server-to-server, authenticated) to
// poll status, AND by the public checkout page (no auth, but only
// exposes minimal non-sensitive fields) to show live status.
// ============================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface OrderRow {
  id: string;
  reference: string;
  merchant_id: string;
  status: string;
  amount_bdt: number;
  currency: string;
  provider: string;
  receiving_msisdn: string;
  expires_at: Date;
  return_url: string | null;
  submitted_trx_id: string | null;
  customer_msisdn: string | null;
  metadata: Record<string, unknown> | null;
  approved_at: Date | null;
  created_at: Date;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ reference: string }> }
) {
  const { reference } = await params;

  const order = await one<OrderRow>(
    `SELECT o.id, o.reference, o.merchant_id, o.status::text AS status, o.amount_bdt,
            o.currency, o.provider::text AS provider, o.expires_at, o.return_url,
            o.submitted_trx_id, o.customer_msisdn, o.metadata, o.approved_at, o.created_at,
            r.msisdn AS receiving_msisdn
       FROM orders o
       JOIN receiving_accounts r ON r.id = o.receiving_account_id
      WHERE o.reference = $1`,
    [reference]
  );

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // If a valid merchant auth header is present, return full details.
  // Otherwise (public checkout page use), return only what's needed
  // to render the pay page / poll status — nothing about other orders,
  // internal ids, or merchant info.
  const merchant = await authenticateMerchant(req.headers.get("authorization"));
  const isOwner = merchant && merchant.id === order.merchant_id;

  const publicView = {
    reference: order.reference,
    status: order.status,
    amountBdt: Number(order.amount_bdt),
    currency: order.currency,
    provider: order.provider,
    receivingNumber: order.receiving_msisdn,
    expiresAt: order.expires_at.toISOString(),
    returnUrl: order.return_url,
  };

  if (!isOwner) {
    return NextResponse.json(publicView);
  }

  return NextResponse.json({
    ...publicView,
    id: order.id,
    submittedTrxId: order.submitted_trx_id,
    customerMsisdn: order.customer_msisdn,
    metadata: order.metadata,
    approvedAt: order.approved_at ? order.approved_at.toISOString() : null,
    createdAt: order.created_at.toISOString(),
  });
}
