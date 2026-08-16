import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // No fallback: the old default pointed at 5432 while the compose publishes
    // 5433, so a missing DATABASE_URL could push schema into an unrelated
    // Postgres on this host rather than erroring.
    url: (() => {
      const u = process.env.DATABASE_URL;
      if (!u) throw new Error("DATABASE_URL is not set — refusing to guess a database to migrate.");
      return u;
    })(),
  },
});
