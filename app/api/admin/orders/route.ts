import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const status = req.nextUrl.searchParams.get("status");
  const db = getDb();

  const rows = status
    ? db
        .prepare(
          `SELECT o.*, m.name as merchant_name, r.msisdn as receiving_msisdn
           FROM orders o
           JOIN merchants m ON m.id = o.merchant_id
           JOIN receiving_accounts r ON r.id = o.receiving_account_id
           WHERE o.status = ?
           ORDER BY o.created_at DESC LIMIT 200`
        )
        .all(status)
    : db
        .prepare(
          `SELECT o.*, m.name as merchant_name, r.msisdn as receiving_msisdn
           FROM orders o
           JOIN merchants m ON m.id = o.merchant_id
           JOIN receiving_accounts r ON r.id = o.receiving_account_id
           ORDER BY o.created_at DESC LIMIT 200`
        )
        .all();

  return NextResponse.json({ orders: rows });
}
