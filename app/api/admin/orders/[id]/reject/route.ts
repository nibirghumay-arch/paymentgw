import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/require-admin";
import { newId } from "@/lib/auth";

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
    return NextResponse.json(
      { error: "Cannot reject an already-approved order. Handle as a refund instead." },
      { status: 409 }
    );
  }

  db.prepare(
    `UPDATE orders SET status = 'REJECTED', updated_at = datetime('now') WHERE id = ?`
  ).run(id);

  db.prepare(
    `INSERT INTO audit_log (id, actor, action, target_id, detail) VALUES (?, ?, ?, ?, ?)`
  ).run(newId(), `admin:${admin.adminId}`, "order.manual_reject", id, null);

  const updated = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id);
  return NextResponse.json({ order: updated });
}
