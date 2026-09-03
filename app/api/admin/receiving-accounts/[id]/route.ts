import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/require-admin";

const patchSchema = z.object({
  isActive: z.boolean().optional(),
  label: z.string().max(100).optional(),
  msisdn: z.string().regex(/^01[3-9]\d{8}$/).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!requireAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const db = getDb();
  const existing = db.prepare(`SELECT * FROM receiving_accounts WHERE id = ?`).get(id) as any;
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isActive = parsed.data.isActive ?? existing.is_active === 1;
  const label = parsed.data.label ?? existing.label;
  const msisdn = parsed.data.msisdn ?? existing.msisdn;

  db.prepare(
    `UPDATE receiving_accounts SET is_active = ?, label = ?, msisdn = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(isActive ? 1 : 0, label, msisdn, id);

  const account = db.prepare(`SELECT * FROM receiving_accounts WHERE id = ?`).get(id);
  return NextResponse.json({ account });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!requireAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const db = getDb();
  const inUse = db
    .prepare(`SELECT COUNT(*) as c FROM orders WHERE receiving_account_id = ?`)
    .get(id) as any;

  if (inUse.c > 0) {
    // Never hard-delete an account with order history — deactivate instead.
    db.prepare(`UPDATE receiving_accounts SET is_active = 0, updated_at = datetime('now') WHERE id = ?`).run(id);
    return NextResponse.json({ ok: true, deactivated: true });
  }

  db.prepare(`DELETE FROM receiving_accounts WHERE id = ?`).run(id);
  return NextResponse.json({ ok: true, deleted: true });
}
