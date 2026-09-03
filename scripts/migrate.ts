// Applies db/schema.sql to the database in DATABASE_URL.
//
//   npm run db:migrate
//
// The schema is written to be idempotent (CREATE TABLE IF NOT EXISTS,
// guarded CREATE TYPE), so this is safe to run against an existing
// database and safe to re-run in CI. Netlify's build image cannot reach
// your database on every deploy in every setup, so this is a deliberate
// one-off command rather than something the app does on boot.

import fs from "node:fs";
import path from "node:path";
import { getPool } from "../lib/db";

async function main() {
  const schemaPath = path.join(process.cwd(), "db", "schema.sql");
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`Schema not found at ${schemaPath}`);
  }

  const schema = fs.readFileSync(schemaPath, "utf-8");
  const pool = getPool();

  const host = (process.env.DATABASE_URL ?? "").replace(/:\/\/[^@]*@/, "://***@");
  console.log(`Applying db/schema.sql to ${host}`);

  const client = await pool.connect();
  try {
    await client.query(schema);
    console.log("Schema applied.");

    const { rows } = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' ORDER BY table_name`
    );
    console.log("Tables:", rows.map((r) => r.table_name).join(", "));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
