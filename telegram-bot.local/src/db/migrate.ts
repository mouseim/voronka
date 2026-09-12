import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import type { DatabasePool } from './pool'

export async function migrate(pool: DatabasePool, directory = path.resolve(process.cwd(), 'migrations')) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)
  const files = (await readdir(directory)).filter((file) => /^\d+.*\.sql$/.test(file)).sort()
  for (const file of files) {
    const already = await pool.query<{ version: string }>('SELECT version FROM schema_migrations WHERE version = $1', [file])
    if (already.rowCount) continue
    const sql = await readFile(path.join(directory, file), 'utf8')
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [file])
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
  return files
}
