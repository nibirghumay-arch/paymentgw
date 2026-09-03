import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { newId } from "@/lib/auth";
import { requireAdmin } from "@/lib/require-admin";
import { randomBytes } from "node:crypto";

// ============================================================
// GET  /api/admin/receiving-accounts   -> list all
// POST /api/admin/receiving-accounts   -> create new (admin sets owner's number)
// ============================================================

export async function GET(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  const accounts = db
    .prepare(`SELECT * FROM receiving_accounts ORDER BY created_at DESC`)
    .all();

  return NextResponse.json({ accounts });
}

const createSchema = z.object({
  provider: z.enum(["BKASH", "NAGAD", "ROCKET", "UPAY"]),
  msisdn: z.string().regex(/^01[3-9]\d{8}$/, "Enter a valid Bangladeshi mobile number"),
  label: z.string().max(100).optional(),
});

export async function POST(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const db = getDb();
  const id = newId();
  const deviceKey = "dev_" + randomBytes(20).toString("hex");

  db.prepare(
    `INSERT INTO receiving_accounts (id, provider, msisdn, label, device_key)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, parsed.data.provider, parsed.data.msisdn, parsed.data.label ?? null, deviceKey);

  const account = db.prepare(`SELECT * FROM receiving_accounts WHERE id = ?`).get(id);

  return NextResponse.json({ account }, { status: 201 });
}
