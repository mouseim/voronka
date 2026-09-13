import { randomUUID } from 'node:crypto'
import type { Logger } from 'pino'
import type { FunnelEngine } from '../runtime/engine'
import type { RuntimeStore } from '../runtime/store'

export interface JobWorker {
  start(): void
  stop(): Promise<void>
  runOnce(): Promise<number>
}

export function createJobWorker(store: RuntimeStore, engine: Pick<FunnelEngine, 'handleJob'>, logger: Logger, pollMs: number): JobWorker {
  const workerId = `worker-${randomUUID()}`
  let timer: NodeJS.Timeout | undefined
  let stopped = true
  let activeRun: Promise<number> | undefined

  const runOnce = async () => {
    const jobs = await store.claimDueJobs(workerId, 20)
    for (const job of jobs) {
      try {
        await engine.handleJob(job)
        await store.completeJob(job.id)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error({ jobId: job.id, jobType: job.type, err: error }, 'Ошибка фоновой задачи')
        await store.failJob(job.id, message)
      }
    }
    return jobs.length
  }

  const tick = () => {
    if (stopped) return
    activeRun = runOnce().catch((error) => {
      logger.error({ err: error }, 'Не удалось получить фоновые задачи')
      return 0
    }).finally(() => {
      activeRun = undefined
      if (!stopped) timer = setTimeout(tick, pollMs)
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
      await activeRun
    },
    runOnce,
  }
}
