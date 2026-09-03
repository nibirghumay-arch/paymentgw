import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { manuallySetOrderStatus } from "@/lib/matching";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const result = await manuallySetOrderStatus(id, "REJECTED", admin.adminId);

  if ("notFound" in result) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if ("conflict" in result) {
    return NextResponse.json(
      { error: "Cannot reject an already-approved order. Handle as a refund instead." },
      { status: 409 }
    );
  }

  return NextResponse.json({ order: result.order });
}
