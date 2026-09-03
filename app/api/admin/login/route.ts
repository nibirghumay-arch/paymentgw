import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { one } from "@/lib/db";
import { verifyPassword, signAdminToken } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const admin = await one<{ id: string; email: string; password_hash: string; name: string }>(
    `SELECT id, email, password_hash, name FROM admins WHERE email = $1`,
    [parsed.data.email.toLowerCase()]
  );

  // Constant-shape response whether or not the email exists, to avoid
  // leaking which admin emails are registered.
  if (!admin) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  const valid = await verifyPassword(parsed.data.password, admin.password_hash);
  if (!valid) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  const token = signAdminToken({ adminId: admin.id, email: admin.email });

  const res = NextResponse.json({ ok: true, name: admin.name });
  res.cookies.set("admin_session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 12,
    path: "/",
  });
  return res;
}
