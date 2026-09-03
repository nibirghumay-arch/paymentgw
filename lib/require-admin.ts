import { NextRequest } from "next/server";
import { verifyAdminToken, AdminSession } from "./auth";

export function requireAdmin(req: NextRequest): AdminSession | null {
  const token = req.cookies.get("admin_session")?.value;
  if (!token) return null;
  return verifyAdminToken(token);
}
