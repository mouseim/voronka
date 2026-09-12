import type { Logger } from 'pino'
import type { DatabasePool } from '../db/pool'

export function createMaintenanceWorker(pool: DatabasePool, logger: Logger, intervalMs = 3_600_000) {
  let timer: NodeJS.Timeout | undefined
  let running: Promise<void> | undefined
  let stopped = true

  const runOnce = async () => {
    const abandoned = await pool.query(`
      UPDATE sessions s
      SET status = 'abandoned', last_activity_at = now(), revision = revision + 1
      FROM funnel_versions fv
      WHERE s.version_id = fv.id
        AND s.status IN ('active', 'waiting')
        AND s.last_activity_at < now() - make_interval(
          days => GREATEST(1, COALESCE((fv.raw_document->'bot'->>'inactivityDays')::integer, 30))
        )
        AND NOT EXISTS (
          SELECT 1 FROM jobs j
          WHERE j.status IN ('pending', 'running')
            AND j.payload->>'sessionId' = s.id::text
        )
    `)
    await pool.query(`
      UPDATE jobs
      SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
          locked_at = NULL,
          locked_by = NULL,
          last_error = COALESCE(last_error, 'worker lease expired')
      WHERE status = 'running' AND locked_at < now() - interval '5 minutes'
    `)
    await Promise.all([
      pool.query(`DELETE FROM callback_tokens WHERE expires_at < now() - interval '7 days'`),
      pool.query(`DELETE FROM redirect_tokens WHERE expires_at < now() - interval '7 days'`),
      pool.query(`DELETE FROM processed_updates WHERE processed_at < now() - interval '30 days'`),
    ])
    if (abandoned.rowCount) logger.info({ sessions: abandoned.rowCount }, 'Неактивные сессии помечены заброшенными')
  }

  const tick = () => {
    if (stopped) return
    running = runOnce().catch((error) => {
      logger.error({ err: error }, 'Ошибка lifecycle maintenance')
    }).finally(() => {
      running = undefined
      if (!stopped) timer = setTimeout(tick, intervalMs)
    })
  }

  return {
    start() {
      if (!stopped) return
      stopped = false
      tick()
    },
    async stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      await running
    },
    runOnce,
  }
}
