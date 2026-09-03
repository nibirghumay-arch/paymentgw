import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { newId, generateApiKey, generateApiSecret, hashApiSecret } from "@/lib/auth";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  const merchants = db
    .prepare(
      `SELECT id, name, api_key, webhook_url, is_active, created_at FROM merchants ORDER BY created_at DESC`
    )
    .all();

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

  const db = getDb();
  const id = newId();
  const apiKey = generateApiKey();
  const apiSecret = generateApiSecret();
  const apiSecretHash = await hashApiSecret(apiSecret);

  db.prepare(
    `INSERT INTO merchants (id, name, api_key, api_secret_hash, webhook_url) VALUES (?, ?, ?, ?, ?)`
  ).run(id, parsed.data.name, apiKey, apiSecretHash, parsed.data.webhookUrl ?? null);

  // apiSecret is only ever shown once, at creation time — store it safely.
  return NextResponse.json(
    { merchant: { id, name: parsed.data.name, apiKey, apiSecret } },
    { status: 201 }
  );
}
