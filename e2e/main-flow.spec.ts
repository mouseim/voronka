import { expect, test } from '@playwright/test'
import path from 'node:path'
import { freshDemoFunnel } from '../src/model/demo'

test('упрощённое демо открывает схему, тесты, предпросмотр и источники', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'Основной desktop-сценарий')
  await page.goto('/')
  await page.getByRole('button', { name: /Открыть полное демо/ }).click()
  await expect(page.getByLabel('Название воронки')).toHaveValue('7 внутренних механизмов')
  await expect(page.locator('.funnel-node')).toHaveCount(15)
  await expect(page.locator('.react-flow__minimap')).toHaveCount(0)
  await expect(page.locator('.canvas-tools')).toHaveCount(0)
  const viewport = page.locator('.react-flow__viewport')
  const viewportBeforePan = await viewport.getAttribute('style')
  const paneBox = await page.locator('.react-flow__pane').boundingBox()
  if (!paneBox) throw new Error('Холст не найден')
  await page.mouse.move(paneBox.x + paneBox.width * .75, paneBox.y + paneBox.height * .9)
  await page.mouse.down()
  await page.mouse.move(paneBox.x + paneBox.width * .75 + 70, paneBox.y + paneBox.height * .9 - 45, { steps: 4 })
  await page.mouse.up()
  await expect.poll(() => viewport.getAttribute('style')).not.toBe(viewportBeforePan)

  const firstNode = page.locator('.react-flow__node').first()
  const nodeBeforeDrag = await firstNode.getAttribute('style')
  const nodeBox = await firstNode.boundingBox()
  if (!nodeBox) throw new Error('Блок не найден')
  await page.mouse.move(nodeBox.x + nodeBox.width / 2, nodeBox.y + nodeBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(nodeBox.x + nodeBox.width / 2 + 45, nodeBox.y + nodeBox.height / 2 + 30, { steps: 4 })
  await page.mouse.up()
  await expect.poll(() => firstNode.getAttribute('style')).not.toBe(nodeBeforeDrag)

  const selectionStart = { x: paneBox.x + paneBox.width * .85, y: paneBox.y + paneBox.height * .92 }
  await page.locator('.react-flow__pane').click({ position: { x: paneBox.width * .85, y: paneBox.height * .92 } })
  await expect(page.locator('.canvas-selection-ready')).toBeVisible()
  await page.mouse.move(selectionStart.x, selectionStart.y)
  await page.mouse.down()
  await page.mouse.move(selectionStart.x - 150, selectionStart.y - 90, { steps: 4 })
  await expect(page.locator('.react-flow__selection')).toBeVisible()
  await page.mouse.up()
  await expect(page.locator('.canvas-selection-ready')).toHaveCount(0)

  await page.getByRole('button', { name: 'Переменные', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Переменные' })).toBeVisible()
  await expect(page.getByText('Интерес к подробному разбору', { exact: true }).first()).toBeVisible()

  await page.getByRole('button', { name: 'Тесты' }).click()
  await expect(page.getByRole('heading', { name: 'Психологические тесты' })).toBeVisible()
  await expect(page.getByText('7 внутренних механизмов', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Результаты' }).click()
  await expect(page.getByText('Как выбирается результат')).toBeVisible()

  await page.getByRole('button', { name: 'Схема' }).click()
  await page.getByRole('button', { name: 'Предпросмотр' }).click()
  await expect(page.getByRole('dialog', { name: 'Предпросмотр воронки' })).toBeVisible()
  await page.getByRole('button', { name: 'Начать', exact: true }).click()
  await expect(page.getByText(/Здравствуйте! Пройдите короткую диагностику/)).toBeVisible()
  await page.getByRole('button', { name: 'Пройти тест' }).click()
  await page.getByRole('button', { name: 'Применить и продолжить' }).click()
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
  await expect(page.getByText('Что вам важнее всего в сложной ситуации?')).toBeVisible()
  await page.getByLabel('Закрыть').click()

  await page.getByRole('button', { name: 'Статистика' }).click()
  await expect(page.getByRole('heading', { name: 'Как работает воронка' })).toBeVisible()
  await page.getByRole('button', { name: 'Источники' }).click()
  await expect(page.getByText('Instagram — Reels про тест')).toBeVisible()
  await expect(page.getByText('840', { exact: true })).toBeVisible()
})

test('старый расширенный fixture отклоняется понятным сообщением', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'Импорт проверяется один раз')
  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles(path.resolve('public/demo-7-mehanizmov-v1.funnel'))
  await expect(page.getByRole('heading', { name: 'Не удалось открыть файл' })).toBeVisible()
  await expect(page.getByText(/старой расширенной версии конструктора/)).toBeVisible()
})

test('мобильный интерфейс даёт доступ к блокам, настройкам сообщения и тестам', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Мобильная проверка')
  await page.goto('/')
  await page.getByRole('button', { name: /Открыть полное демо/ }).click()
  await expect(page.locator('.funnel-node').first()).toBeVisible()
  await page.getByRole('button', { name: 'Блоки', exact: true }).click()
  const drawer = page.locator('.mobile-drawer')
  await expect(drawer.getByRole('button', { name: /Сообщение/ })).toBeVisible()
  await expect(drawer.getByRole('button', { name: /Переменные/ })).toBeVisible()
  await expect(drawer.getByRole('button', { name: /Условие/ })).toBeVisible()
  await page.locator('.mobile-drawer-backdrop').click({ position: { x: 390, y: 20 } })

  await page.getByRole('button', { name: 'Тесты' }).click()
  await expect(page.getByRole('heading', { name: 'Психологические тесты' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Вопросы' })).toBeVisible()
})

test('чистый браузер загружает VPS-воронку, сохраняет её и разрешает конфликт без потери локальной работы', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'Сценарий второго устройства проверяется один раз')
  let serverDocument = freshDemoFunnel()
  serverDocument.funnel.status = 'published'
  let publishCount = 0
  let deleted = false
  await page.route('https://runtime.example/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname === '/admin/editor/funnels') {
      return route.fulfill({ json: { funnels: deleted ? [] : [{
        id: serverDocument.funnel.id,
        name: serverDocument.funnel.name,
        activeVersion: serverDocument.funnel.version,
        updatedAt: serverDocument.funnel.updatedAt,
        publishedAt: serverDocument.funnel.updatedAt,
        isDefault: true,
        nodeCount: serverDocument.nodes.length,
      }] } })
    }
    if (request.method() === 'GET' && url.pathname.startsWith('/admin/editor/funnels/')) {
      return route.fulfill({ json: { document: serverDocument } })
    }
    if (request.method() === 'POST' && url.pathname === '/admin/editor/publish') {
      const submitted = request.postDataJSON() as typeof serverDocument
      const changed = submitted.funnel.name !== serverDocument.funnel.name
      if (changed) serverDocument = { ...submitted, funnel: { ...submitted.funnel, version: serverDocument.funnel.version + 1, status: 'published' } }
      publishCount += 1
      return route.fulfill({ json: {
        published: true,
        created: changed,
        unchanged: !changed,
        version: serverDocument.funnel.version,
        document: serverDocument,
        issues: [],
      } })
    }
    if (request.method() === 'DELETE' && url.pathname.startsWith('/admin/editor/funnels/')) {
      deleted = true
      return route.fulfill({ json: { deleted: true, replacementSourceId: null } })
    }
    return route.fulfill({ status: 404, json: { message: 'Не найдено' } })
  })

  await page.goto('/')
  await page.locator('.primary-actions').getByRole('button', { name: /Подключить мои воронки/ }).click()
  const connection = page.getByRole('dialog', { name: 'Подключить мои воронки' })
  await connection.getByLabel('Адрес').fill('https://runtime.example')
  await connection.getByLabel('Токен доступа').fill('test-admin-token-long')
  await connection.getByRole('button', { name: 'Подключить', exact: true }).click()
  const serverCard = page.locator('.server-card')
  await expect(serverCard.getByText('На сервере · основная')).toBeVisible()
  await serverCard.getByRole('button', { name: 'Открыть' }).click()
  await expect(page.getByLabel('Название воронки')).toHaveValue(serverDocument.funnel.name)

  await page.locator('.brand-button').click()
  await expect(page.getByText('На этом устройстве', { exact: true })).toBeVisible()
  await page.locator('.draft-card').getByRole('button', { name: 'Открыть' }).click()
  await expect(page.getByLabel('Название воронки')).toBeVisible()
  await page.getByLabel('Название воронки').fill('Локальная несохранённая правка')
  await page.waitForTimeout(1_000)
  await page.locator('.brand-button').click()
  await page.locator('.draft-card').getByRole('button', { name: 'Открыть' }).click()
  const conflict = page.getByRole('dialog', { name: 'Есть изменения на этом устройстве' })
  await expect(conflict).toBeVisible()
  await conflict.getByRole('button', { name: 'Продолжить локальную версию' }).click()
  await expect(page.getByLabel('Название воронки')).toHaveValue('Локальная несохранённая правка')

  await page.locator('.brand-button').click()
  await page.locator('.draft-card').getByRole('button', { name: 'Открыть' }).click()
  await page.getByRole('dialog', { name: 'Есть изменения на этом устройстве' }).getByRole('button', { name: 'Загрузить опубликованную версию' }).click()
  await expect(page.getByLabel('Название воронки')).toHaveValue(serverDocument.funnel.name)
  await page.getByLabel('Название воронки').fill('Опубликовано со второго устройства')
  await page.getByRole('button', { name: 'Опубликовать и сделать активной' }).click()
  await expect(page.getByText(/Версия 2 опубликована и сделана активной/)).toBeVisible()
  await page.getByRole('button', { name: 'Опубликовать и сделать активной' }).click()
  await expect(page.getByText(/новая версия не создавалась/)).toBeVisible()
  expect(publishCount).toBe(2)

  await page.reload()
  await expect(page.locator('.draft-card')).toHaveCount(1)
  await expect(page.locator('.draft-card').getByText('Опубликовано со второго устройства', { exact: true })).toBeVisible()
  const stored = await page.evaluate(async () => new Promise<number>((resolve, reject) => {
    const open = indexedDB.open('voronka-funnel-builder', 2)
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const request = open.result.transaction('drafts', 'readonly').objectStore('drafts').getAll()
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result.filter((draft) => draft.document?.funnel?.version === 2).length)
    }
  }))
  expect(stored).toBeGreaterThan(0)
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Удалить воронку' }).click()
  await expect(page.locator('.draft-card')).toHaveCount(0)
  expect(deleted).toBe(true)
  const localRecords = await page.evaluate(async () => new Promise<{ drafts: number; revisions: number }>((resolve, reject) => {
    const open = indexedDB.open('voronka-funnel-builder', 2)
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const tx = open.result.transaction(['drafts', 'revisions'], 'readonly')
      const drafts = tx.objectStore('drafts').count()
      const revisions = tx.objectStore('revisions').count()
      tx.oncomplete = () => resolve({ drafts: drafts.result, revisions: revisions.result })
      tx.onerror = () => reject(tx.error)
    }
  }))
  expect(localRecords).toEqual({ drafts: 0, revisions: 0 })
})
