import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { one, run } from "@/lib/db";
import { requireAdmin } from "@/lib/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  isActive: z.boolean().optional(),
  label: z.string().max(100).optional(),
  msisdn: z.string().regex(/^01[3-9]\d{8}$/).optional(),
});

const SELECT_ACCOUNT = `
  SELECT id, provider::text AS provider, msisdn, label, device_key,
         is_active, created_at, updated_at
    FROM receiving_accounts WHERE id = $1`;

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

  // COALESCE lets Postgres do the "only change what was sent" merge, so a
  // concurrent update to another field isn't silently reverted.
  const updated = await run(
    `UPDATE receiving_accounts
        SET is_active = COALESCE($2, is_active),
            label     = COALESCE($3, label),
            msisdn    = COALESCE($4, msisdn),
            updated_at = now()
      WHERE id = $1`,
    [id, parsed.data.isActive ?? null, parsed.data.label ?? null, parsed.data.msisdn ?? null]
  );

  if (updated === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const account = await one(SELECT_ACCOUNT, [id]);
  return NextResponse.json({ account });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!requireAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const inUse = await one<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM orders WHERE receiving_account_id = $1`,
    [id]
  );

  if ((inUse?.c ?? 0) > 0) {
    // Never hard-delete an account with order history — deactivate instead.
    await run(
      `UPDATE receiving_accounts SET is_active = FALSE, updated_at = now() WHERE id = $1`,
      [id]
    );
    return NextResponse.json({ ok: true, deactivated: true });
  }

  const deleted = await run(`DELETE FROM receiving_accounts WHERE id = $1`, [id]);
  if (deleted === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ ok: true, deleted: true });
}
