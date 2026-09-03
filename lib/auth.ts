import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomBytes, randomUUID } from "node:crypto";
import { one } from "./db";

const JWT_SECRET = process.env.JWT_SECRET || "";
if (!JWT_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("JWT_SECRET must be set in production");
}

export interface AdminSession {
  adminId: string;
  email: string;
}

export function signAdminToken(payload: AdminSession): string {
  return jwt.sign(payload, JWT_SECRET || "dev-secret", { expiresIn: "12h" });
}

export function verifyAdminToken(token: string): AdminSession | null {
  try {
    return jwt.verify(token, JWT_SECRET || "dev-secret") as AdminSession;
  } catch {
    return null;
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ------------------------------------------------------------
// Merchant API credentials
// ------------------------------------------------------------
export function generateApiKey(): string {
  return "pk_" + randomBytes(16).toString("hex");
}

export function generateApiSecret(): string {
  return "sk_" + randomBytes(24).toString("hex");
}

/** Shared secret the merchant uses to verify our webhook HMAC. */
export function generateWebhookSecret(): string {
  return "whsec_" + randomBytes(32).toString("hex");
}

export async function hashApiSecret(secret: string): Promise<string> {
  return bcrypt.hash(secret, 10);
}

export interface AuthedMerchant {
  id: string;
  name: string;
  webhookUrl: string | null;
}

interface MerchantRow {
  id: string;
  name: string;
  api_secret_hash: string;
  webhook_url: string | null;
}

/**
 * Verifies the Authorization: Bearer <apiKey>:<apiSecret> header
 * used by merchant-facing API routes.
 */
export async function authenticateMerchant(
  authHeader: string | null
): Promise<AuthedMerchant | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length).trim();
  const [apiKey, apiSecret] = token.split(":");
  if (!apiKey || !apiSecret) return null;

  const merchant = await one<MerchantRow>(
    `SELECT id, name, api_secret_hash, webhook_url
       FROM merchants
      WHERE api_key = $1 AND is_active = TRUE`,
    [apiKey]
  );

  if (!merchant) return null;

  const valid = await verifyPassword(apiSecret, merchant.api_secret_hash);
  if (!valid) return null;

  return { id: merchant.id, name: merchant.name, webhookUrl: merchant.webhook_url };
}

export function newId(): string {
  return randomUUID();
}
