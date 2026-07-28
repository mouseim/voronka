import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createServer } from 'vite'

const root = resolve(import.meta.dirname, '..')
const server = await createServer({ root, appType: 'custom', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } })

try {
  const { freshDemoFunnel } = await server.ssrLoadModule('/src/model/demo.ts')
  const content = `${JSON.stringify(freshDemoFunnel(), null, 2)}\n`
  await Promise.all([
    writeFile(resolve(root, 'public/demo-7-mehanizmov-v2.funnel'), content, 'utf8'),
    writeFile(resolve(root, 'public/demo-diagnostika-v2.funnel'), content, 'utf8'),
  ])
} finally {
  await server.close()
}
