import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { run, sql } from "@/lib/db";
import {
  newId,
  generateApiKey,
  generateApiSecret,
  generateWebhookSecret,
  hashApiSecret,
} from "@/lib/auth";
import { requireAdmin } from "@/lib/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const merchants = await sql(
    `SELECT id, name, api_key, webhook_url, is_active, created_at
       FROM merchants ORDER BY created_at DESC`
  );

  return NextResponse.json({ merchants });
}

const createSchema = z.object({
  name: z.string().min(1).max(100),
  webhookUrl: z.string().url().optional(),
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
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const id = newId();
  const apiKey = generateApiKey();
  const apiSecret = generateApiSecret();
  const apiSecretHash = await hashApiSecret(apiSecret);
  const webhookSecret = generateWebhookSecret();

  await run(
    `INSERT INTO merchants (id, name, api_key, api_secret_hash, webhook_url, webhook_secret)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, parsed.data.name, apiKey, apiSecretHash, parsed.data.webhookUrl ?? null, webhookSecret]
  );

  // apiSecret and webhookSecret are only ever shown once, at creation time.
  // Copy them straight into the merchant app's environment.
  return NextResponse.json(
    { merchant: { id, name: parsed.data.name, apiKey, apiSecret, webhookSecret } },
    { status: 201 }
  );
}
