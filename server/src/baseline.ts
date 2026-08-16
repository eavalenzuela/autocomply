// Adopt migrations on a database that predates them.
//
// Databases created by `drizzle-kit push` have the schema but no migrations
// journal, so `db:migrate` tries to apply 0000 from scratch and dies on
// "relation already exists". Dropping and recreating is fine for a scratch
// database and not an option for a deployment with data in it.
//
// This marks migrations as already applied WITHOUT running them, so the next
// `db:migrate` only applies what genuinely comes after. Run it once, on a
// database whose schema already matches the migrations you are baselining:
//
//   npm --prefix server run db:baseline -- 0000_easy_captain_marvel 0001_audit_append_only
//
// It refuses to mark a migration that has already been recorded, and it does
// not verify that the schema truly matches — that is the operator's assertion,
// which is why this is a separate deliberate command rather than something
// db:migrate does silently.
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pool } from "./db/index";

async function main() {
  const tags = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  if (tags.length === 0) {
    console.error("usage: db:baseline -- <migration-tag> [<migration-tag>...]");
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    // Same shape the drizzle node-postgres migrator uses.
    await client.query(`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
    await client.query(
      `CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
         id SERIAL PRIMARY KEY,
         hash text NOT NULL,
         created_at bigint
       )`,
    );

    // The migrator decides what is pending by comparing each journal entry's
    // `when` against the newest recorded created_at. Stamping "now" here would
    // therefore mark every LATER migration as already applied too — which is
    // exactly what happened the first time this ran: 0002 was silently skipped
    // and reported as a clean migration. Mirror the journal instead.
    const journal = JSON.parse(await readFile("./drizzle/meta/_journal.json", "utf8")) as {
      entries: { tag: string; when: number }[];
    };

    for (const tag of tags) {
      const entry = journal.entries.find((e) => e.tag === tag);
      if (!entry) {
        console.error(`no journal entry for ${tag} — is the tag spelled correctly?`);
        process.exit(1);
      }
      const sql = await readFile(`./drizzle/${tag}.sql`, "utf8");
      // The migrator hashes the file's contents; matching it is what makes the
      // migration count as applied.
      const hash = createHash("sha256").update(sql).digest("hex");
      const existing = await client.query(`SELECT 1 FROM "drizzle"."__drizzle_migrations" WHERE hash = $1`, [hash]);
      if (existing.rowCount) {
        console.log(`already recorded: ${tag}`);
        continue;
      }
      await client.query(`INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES ($1, $2)`, [
        hash,
        entry.when,
      ]);
      console.log(`baselined: ${tag}`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
