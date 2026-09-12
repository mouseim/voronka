import pg from 'pg'

const { Pool } = pg

export function createPool(databaseUrl: string) {
  return new Pool({
    connectionString: databaseUrl,
    max: 12,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'voronka-telegram-runtime',
  })
}

export type DatabasePool = ReturnType<typeof createPool>
