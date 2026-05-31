import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

// Fallback uses our compose port (5433) — never 5432, which may be a different
// project's Postgres on this host.
const connectionString =
  process.env.DATABASE_URL ?? "postgresql://autocomply:autocomply@localhost:5433/autocomply";

export const pool = new pg.Pool({ connectionString });
export const db = drizzle(pool, { schema });
