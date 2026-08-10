import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  // Relative to this package, not absolute: drizzle-kit globs this value, and
  // glob treats an absolute path containing spaces (as a local checkout may
  // have) as a failed match — "No schema files found". Both `push` scripts run
  // with the package root as cwd, so the relative form resolves identically.
  schema: "./src/schema/index.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
