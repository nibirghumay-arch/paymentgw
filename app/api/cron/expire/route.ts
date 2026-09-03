import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { expireStaleOrders } from "@/lib/matching";
import { retryPendingWebhooks } from "@/lib/webhook";

// ============================================================
// GET /api/cron/expire
//
// Netlify has no long-running process, so the housekeeping that used
// to be a setInterval lives here and is driven by the scheduled
// function in netlify/functions/expire-orders.mts (every 5 minutes).
//
// Two jobs:
//   1. Expire PENDING/SUBMITTED orders past their deadline.
//   2. Retry merchant webhooks that failed on first delivery.
//
// Auth: Authorization: Bearer <CRON_SECRET>  (or ?token= for manual runs).
// Without CRON_SECRET set the route refuses to run rather than
// exposing an unauthenticated state-changing endpoint.
// ============================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = req.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const provided = bearer || req.nextUrl.searchParams.get("token") || "";
  if (provided.length !== secret.length) return false;

  return timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const expired = await expireStaleOrders();
  const webhooks = await retryPendingWebhooks();

  return NextResponse.json({
    ok: true,
    ranAt: new Date().toISOString(),
    expiredOrders: expired,
    webhooksRetried: webhooks.retried,
    webhooksDelivered: webhooks.delivered,
  });
}

export const GET = handle;
export const POST = handle;
