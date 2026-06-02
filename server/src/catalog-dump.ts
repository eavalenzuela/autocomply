// Dump the GRCen catalog export to stdout (or a file via `> catalog.json`).
//   npm --prefix server run catalog:dump > catalog.json
//   grcen sync-catalog catalog.json --dry-run
import { buildCatalog, recordCatalogExport } from "./catalog";
import { pool } from "./db/index";

async function main() {
  const { catalog, droppedSatisfies } = await buildCatalog(new Date().toISOString());
  if (droppedSatisfies > 0) {
    process.stderr.write(`warn: dropped ${droppedSatisfies} mapping(s) to unknown requirements\n`);
  }
  await recordCatalogExport(null, "dump");
  process.stdout.write(JSON.stringify(catalog, null, 2) + "\n");
}

main()
  .catch((err) => {
    process.stderr.write(`catalog dump failed: ${err?.stack ?? err}\n`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
