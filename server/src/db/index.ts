import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

// No fallback. A default DSN with a committed password means a misconfigured
// deployment silently connects somewhere plausible instead of failing, and it
// puts working credentials in the repo. Fail loudly instead.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Copy server/.env.example to server/.env for local " +
      "development, or set it in the environment for a deployment.",
  );
}

export const pool = new pg.Pool({ connectionString });
export const db = drizzle(pool, { schema });
