import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { describe, expect, it } from 'vitest'

describe('PostgreSQL migration', () => {
  it('применяется повторяемо и создаёт ключевые ограничения', async () => {
    const database = await PGlite.create({ extensions: { pgcrypto } })
    const directory = path.resolve(process.cwd(), 'migrations')
    const files = (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort()
    const migrations = await Promise.all(files.map((file) => readFile(path.join(directory, file), 'utf8')))
    try {
      for (const sql of migrations) await database.exec(sql)
      for (const sql of migrations) await database.exec(sql)
      const tables = await database.query<{ table_name: string }>(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
      `)
      expect(tables.rows.map((row) => row.table_name)).toEqual(expect.arrayContaining([
        'funnel_versions',
        'sessions',
        'jobs',
        'payments',
        'analytics_events',
        'admin_audit_log',
      ]))

      const first = await database.query<{ id: string }>(`
        INSERT INTO funnels(funnel_key, source_funnel_id, name, default_for_bot)
        VALUES ('one', 'source-one', 'One', true)
        RETURNING id
      `)
      expect(first.rows[0]?.id).toMatch(/^[0-9a-f-]{36}$/)
      await expect(database.exec(`
        INSERT INTO funnels(funnel_key, source_funnel_id, name, default_for_bot)
        VALUES ('two', 'source-two', 'Two', true)
      `)).rejects.toThrow()
    } finally {
      await database.close()
    }
  })
})
