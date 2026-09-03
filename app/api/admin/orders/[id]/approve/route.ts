import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { manuallySetOrderStatus } from "@/lib/matching";

// Manual override — for edge cases the automatic SMS matcher couldn't
// resolve (e.g. customer sent a slightly different amount, SMS text
// format changed and failed to parse, etc). Always logged to the audit
// trail, and always fires the merchant webhook so the customer's wallet
// gets credited exactly as it would on an automatic match.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const result = await manuallySetOrderStatus(id, "APPROVED", admin.adminId);

  if ("notFound" in result) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if ("conflict" in result) {
    return NextResponse.json({ error: result.conflict }, { status: 409 });
  }

  return NextResponse.json({ order: result.order });
}
