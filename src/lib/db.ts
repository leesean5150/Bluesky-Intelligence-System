import { Pool } from "pg";

// Singleton pool — avoids exhausting connections during Next.js hot reload
const globalForDb = globalThis as unknown as { pool: Pool | undefined };

function createPool() {
  return new Pool({
    user: process.env.POSTGRES_USER || "postgres",
    password: process.env.POSTGRES_PASSWORD || "postgres",
    host: process.env.POSTGRES_HOST || "localhost",
    port: parseInt(process.env.POSTGRES_PORT || "5432"),
    database: process.env.POSTGRES_DB || "bsis",
  });
}

const pool = globalForDb.pool ?? createPool();

if (process.env.NODE_ENV !== "production") {
  globalForDb.pool = pool;
}

export default pool;
