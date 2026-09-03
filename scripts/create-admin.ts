// Usage: npx tsx scripts/create-admin.ts <email> <password> <name>
// Creates (or updates the password of) an admin account. This is the only
// way to create admins — there is deliberately no public signup route.

import { getDb } from "../lib/db";
import { hashPassword, newId } from "../lib/auth";

async function main() {
  const [email, password, ...nameParts] = process.argv.slice(2);
  const name = nameParts.join(" ") || "Admin";

  if (!email || !password) {
    console.error("Usage: npx tsx scripts/create-admin.ts <email> <password> [name]");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  const db = getDb();
  const passwordHash = await hashPassword(password);
  const existing = db.prepare(`SELECT id FROM admins WHERE email = ?`).get(email.toLowerCase()) as any;

  if (existing) {
    db.prepare(`UPDATE admins SET password_hash = ?, name = ? WHERE id = ?`).run(
      passwordHash,
      name,
      existing.id
    );
    console.log(`Updated existing admin: ${email}`);
  } else {
    db.prepare(`INSERT INTO admins (id, email, password_hash, name) VALUES (?, ?, ?, ?)`).run(
      newId(),
      email.toLowerCase(),
      passwordHash,
      name
    );
    console.log(`Created admin: ${email}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
