// Usage: npx tsx scripts/create-admin.ts <email> <password> [name]
// Creates (or updates the password of) an admin account. This is the only
// way to create admins — there is deliberately no public signup route.

import { getPool, one, run } from "../lib/db";
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

  const passwordHash = await hashPassword(password);
  const existing = await one<{ id: string }>(`SELECT id FROM admins WHERE email = $1`, [
    email.toLowerCase(),
  ]);

  if (existing) {
    await run(`UPDATE admins SET password_hash = $2, name = $3 WHERE id = $1`, [
      existing.id,
      passwordHash,
      name,
    ]);
    console.log(`Updated existing admin: ${email}`);
  } else {
    await run(
      `INSERT INTO admins (id, email, password_hash, name) VALUES ($1, $2, $3, $4)`,
      [newId(), email.toLowerCase(), passwordHash, name]
    );
    console.log(`Created admin: ${email}`);
  }

  await getPool().end();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await getPool().end().catch(() => {});
  process.exit(1);
});
