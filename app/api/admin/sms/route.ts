import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parseStatus = req.nextUrl.searchParams.get("parseStatus");
  const db = getDb();

  const rows = parseStatus
    ? db
        .prepare(
          `SELECT s.*, r.msisdn as receiving_msisdn
           FROM incoming_sms s
           JOIN receiving_accounts r ON r.id = s.receiving_account_id
           WHERE s.parse_status = ?
           ORDER BY s.received_at DESC LIMIT 200`
        )
        .all(parseStatus)
    : db
        .prepare(
          `SELECT s.*, r.msisdn as receiving_msisdn
           FROM incoming_sms s
           JOIN receiving_accounts r ON r.id = s.receiving_account_id
           ORDER BY s.received_at DESC LIMIT 200`
        )
        .all();

  return NextResponse.json({ sms: rows });
}
