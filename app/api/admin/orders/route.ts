import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireAdmin } from "@/lib/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ORDER_STATUSES = [
  "PENDING",
  "SUBMITTED",
  "MATCHED",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
] as const;

export async function GET(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const status = req.nextUrl.searchParams.get("status");
  const filtered = status && (ORDER_STATUSES as readonly string[]).includes(status);

  const orders = await sql(
    `SELECT o.id, o.reference, o.amount_bdt, o.currency, o.provider::text AS provider,
            o.status::text AS status, o.customer_msisdn, o.submitted_trx_id,
            o.webhook_status::text AS webhook_status, o.webhook_attempts,
            o.webhook_last_error, o.expires_at, o.approved_at, o.created_at,
            m.name AS merchant_name, r.msisdn AS receiving_msisdn
       FROM orders o
       JOIN merchants m          ON m.id = o.merchant_id
       JOIN receiving_accounts r ON r.id = o.receiving_account_id
      ${filtered ? "WHERE o.status = $1::order_status" : ""}
      ORDER BY o.created_at DESC
      LIMIT 200`,
    filtered ? [status] : []
  );

  return NextResponse.json({ orders });
}
