import { Pool, types, type PoolClient, type QueryResultRow } from "pg";

// ============================================================
// PostgreSQL access layer.
//
// Replaces the old better-sqlite3 connection. Netlify runs every
// route as a short-lived serverless function on a read-only
// filesystem, so a local SQLite file is not an option — and each
// warm container needs at most one connection.
//
// Point DATABASE_URL at a POOLED connection string:
//   Neon      -> ...-pooler.<region>.aws.neon.tech/db?sslmode=require
//   Supabase  -> aws-0-<region>.pooler.supabase.com:6543/postgres
// Direct (non-pooled) URLs will exhaust Postgres' connection slots
// once more than a handful of functions are warm at the same time.
// ============================================================

// node-postgres hands NUMERIC back as a string to avoid precision loss.
// Every money column here is NUMERIC(14,2) — BDT amounts capped at
// 500,000.00 — which is exactly representable as a float64, and the
// admin UI / JSON API expect numbers. Parse them at the driver level so
// no call site has to remember.
types.setTypeParser(types.builtins.NUMERIC, (v) => (v === null ? null : parseFloat(v)));
types.setTypeParser(types.builtins.INT8, (v) => (v === null ? null : parseInt(v, 10)));

declare global {
  // eslint-disable-next-line no-var
  var __bdGatewayPool: Pool | undefined;
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Point it at your Postgres pooled connection string."
    );
  }

  // Managed Postgres (Neon/Supabase/Railway/Aiven) requires TLS but serves
  // certificates from a CA the Lambda image does not always carry, so verify
  // is off unless DATABASE_SSL_STRICT=true. Set that when you supply a CA.
  const wantsSsl =
    /sslmode=(require|verify-ca|verify-full)/.test(connectionString) ||
    process.env.DATABASE_SSL === "true" ||
    process.env.NODE_ENV === "production";

  return new Pool({
    connectionString,
    ssl: wantsSsl
      ? { rejectUnauthorized: process.env.DATABASE_SSL_STRICT === "true" }
      : undefined,
    // One connection per warm function container.
    max: Number(process.env.DATABASE_POOL_MAX ?? 1),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    // Never let a stuck query hold a Netlify function open to its timeout.
    statement_timeout: 15_000,
    query_timeout: 15_000,
  });
}

export function getPool(): Pool {
  if (!global.__bdGatewayPool) {
    global.__bdGatewayPool = createPool();
    // A dead backend (idle connection reaped by the pooler) must not crash
    // the whole function invocation.
    global.__bdGatewayPool.on("error", (err) => {
      console.error("[db] idle client error:", err.message);
    });
  }
  return global.__bdGatewayPool;
}

/** Run a query and return every row. */
export async function sql<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await getPool().query<T>(text, params as never[]);
  return result.rows;
}

/** Run a query and return the first row, or null. */
export async function one<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await sql<T>(text, params);
  return rows[0] ?? null;
}

/** Run a statement and return the number of affected rows. */
export async function run(text: string, params: unknown[] = []): Promise<number> {
  const result = await getPool().query(text, params as never[]);
  return result.rowCount ?? 0;
}

/**
 * Run `fn` inside a single transaction on a dedicated client.
 * Rolls back on any thrown error and always releases the client.
 * Used by the matching engine, where an order and the SMS that paid
 * for it must flip together or not at all.
 */
export async function tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Connection is already broken; the pool will discard it.
    }
    throw err;
  } finally {
    client.release();
  }
}
