import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

// Single shared connection across the app (Next.js dev server hot-reloads
// modules, so we stash the instance on globalThis to avoid re-opening the
// file and re-running the schema on every request in dev).

declare global {
  // eslint-disable-next-line no-var
  var __bdGatewayDb: Database.Database | undefined;
}

function createConnection(): Database.Database {
  const dbPath = process.env.DATABASE_FILE || path.join(process.cwd(), "data", "gateway.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const schemaPath = path.join(process.cwd(), "db", "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf-8");
  db.exec(schema);

  return db;
}

export function getDb(): Database.Database {
  if (!global.__bdGatewayDb) {
    global.__bdGatewayDb = createConnection();
  }
  return global.__bdGatewayDb;
}
