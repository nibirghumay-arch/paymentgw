import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/require-admin";
import { newId } from "@/lib/auth";

// Manual override — for edge cases the automatic SMS matcher couldn't
// resolve (e.g. customer sent a slightly different amount, SMS text
// format changed and failed to parse, etc). Always logged to audit trail.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id) as any;
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  if (order.status === "APPROVED") {
    return NextResponse.json({ error: "Already approved" }, { status: 409 });
  }

  db.prepare(
    `UPDATE orders SET status = 'APPROVED', approved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
  ).run(id);

  db.prepare(
    `INSERT INTO audit_log (id, actor, action, target_id, detail) VALUES (?, ?, ?, ?, ?)`
  ).run(newId(), `admin:${admin.adminId}`, "order.manual_approve", id, null);

  const updated = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id);
  return NextResponse.json({ order: updated });
}
