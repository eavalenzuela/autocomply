// Verify the seed's delete cascade covers every foreign key into the tables it
// wipes.
//
// This has broken twice — api_tokens, then user_invites — each time leaving a
// half-wiped database because a new table gained an FK to `users` and nobody
// updated seed.ts. Checking it by reading the file is how it broke twice; ask
// the database instead.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { pool } from "./db/index";

// Tables the cascade deletes last, whose dependants must be cleared first.
const PARENTS = ["users", "controls", "requirements", "frameworks", "evidence_items", "attestations", "assessment_periods"];

async function main() {
  const seed = readFileSync(new URL("./seed.ts", import.meta.url), "utf8");
  const schema = readFileSync(new URL("./db/schema.ts", import.meta.url), "utf8");
  const nameOf = new Map<string, string>();
  for (const m of schema.matchAll(/export const (\w+) = pgTable\(\s*"([\w_]+)"/g)) nameOf.set(m[1], m[2]);
  const deleted = new Set<string>();
  for (const m of seed.matchAll(/db\.delete\(s\.(\w+)\)/g)) deleted.add(nameOf.get(m[1]) ?? m[1]);

  const { rows } = await pool.query<{ child: string; parent: string }>(
    `SELECT DISTINCT tc.table_name AS child, ccu.table_name AS parent
       FROM information_schema.table_constraints tc
       JOIN information_schema.constraint_column_usage ccu
         ON tc.constraint_name = ccu.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND ccu.table_name = ANY($1)
        AND tc.table_name <> ccu.table_name`,
    [PARENTS],
  );

  const missing = rows.filter((r) => deleted.has(r.parent) && !deleted.has(r.child));
  if (missing.length) {
    console.error("\nseed cascade is incomplete — these reference a wiped table but are never cleared:\n");
    for (const m of missing) console.error(`  ${m.child} -> ${m.parent}`);
    console.error("\nAdd them to the delete cascade in seed.ts, before their parent.\n");
    await pool.end();
    process.exit(1);
  }
  console.log(`fk-check: OK — ${rows.length} foreign keys into wiped tables, all covered`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
