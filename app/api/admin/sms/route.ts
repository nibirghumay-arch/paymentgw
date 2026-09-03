import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireAdmin } from "@/lib/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PARSE_STATUSES = ["PARSED", "UNPARSED", "IGNORED"] as const;

export async function GET(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parseStatus = req.nextUrl.searchParams.get("parseStatus");
  const filtered = parseStatus && (PARSE_STATUSES as readonly string[]).includes(parseStatus);

  const smsRows = await sql(
    `SELECT s.id, s.raw_text, s.sent_at, s.received_at, s.provider::text AS provider,
            s.parse_status::text AS parse_status, s.parsed_trx_id, s.parsed_amount_bdt,
            s.parsed_sender_msisdn, s.is_used, r.msisdn AS receiving_msisdn
       FROM incoming_sms s
       JOIN receiving_accounts r ON r.id = s.receiving_account_id
      ${filtered ? "WHERE s.parse_status = $1::sms_parse_status" : ""}
      ORDER BY s.received_at DESC
      LIMIT 200`,
    filtered ? [parseStatus] : []
  );

  return NextResponse.json({ sms: smsRows });
}
