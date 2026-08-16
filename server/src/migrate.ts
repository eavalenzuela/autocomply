// Apply pending migrations.
//
// This replaces `drizzle-kit push` as the way schema reaches a database.
// `push` diffs the schema file against whatever it finds and applies the
// difference, which is convenient on a scratch database and unsafe on one with
// data in it: there is no review step, no record of what ran, no ordering, and
// no way to express anything the schema file cannot describe — the audit_log
// append-only triggers, for instance, could only ever be applied by hand.
//
// Migrations are files, committed, ordered, and recorded in the database. What
// ran on this deployment is answerable.
import "dotenv/config";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./db/index";

async function main() {
  const started = Date.now();
  // Folder is relative to the server package root (npm sets cwd there).
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log(`migrations applied in ${Date.now() - started}ms`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
