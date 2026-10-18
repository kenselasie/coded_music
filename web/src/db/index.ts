import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

const globalForDb = globalThis as unknown as {
  codedmusicSql?: ReturnType<typeof postgres>;
};

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy web/.env.example to web/.env.local and start Postgres.",
    );
  }
  return url;
}

function sqlClient() {
  if (!globalForDb.codedmusicSql) {
    globalForDb.codedmusicSql = postgres(databaseUrl(), { max: 10 });
  }
  return globalForDb.codedmusicSql;
}

export function getDb() {
  return drizzle(sqlClient(), { schema });
}

export type Db = ReturnType<typeof getDb>;
