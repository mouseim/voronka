import { expect, test } from '@playwright/test'
import path from 'node:path'

test('полное демо открывает схему, разделы, симулятор и статистику', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'Основной desktop-сценарий')
  await page.goto('/')
  await page.getByRole('button', { name: /Открыть полное демо/ }).click()
  await expect(page.getByLabel('Название воронки')).toHaveValue('7 внутренних механизмов')
  await expect(page.locator('.funnel-node')).toHaveCount(19)

  await page.getByRole('button', { name: 'Разделы проекта' }).click()
  await expect(page.getByRole('heading', { name: 'Переменные' })).toBeVisible()
  await page.getByRole('button', { name: /Тесты и результаты/ }).click()
  await expect(page.getByRole('heading', { name: 'Тесты и результаты' })).toBeVisible()
  await expect(page.getByText('7 внутренних механизмов', { exact: true }).first()).toBeVisible()

  await page.getByRole('button', { name: /Схема/ }).click()
  await page.getByRole('button', { name: 'Предпросмотр' }).click()
  await expect(page.getByRole('dialog', { name: 'Симулятор воронки' })).toBeVisible()
  await page.getByRole('button', { name: /Начать симуляцию/ }).click()
  await page.getByRole('button', { name: 'Начать диагностику' }).click()
  await page.getByRole('button', { name: 'Социальные сети' }).click()
  await expect(page.getByText('7 внутренних механизмов', { exact: true }).last()).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть' }).click()

  await page.getByRole('button', { name: 'Статистика', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Как работает воронка' })).toBeVisible()
  await page.getByRole('button', { name: 'Результаты' }).click()
  await expect(page.getByRole('heading', { name: 'Распределение результатов' })).toBeVisible()
  await page.getByRole('button', { name: 'Контакты и заявки' }).click()
  await expect(page.getByText('Анна К.')).toBeVisible()
})

test('старый fixture мигрирует в schema 1.0.0', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'Импорт проверяется один раз')
  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles(path.resolve('public/fixtures/demo-diagnostika-v0.1.funnel'))
  await expect(page.getByRole('heading', { name: 'Старая версия обновлена' })).toBeVisible()
  await expect(page.getByText('0.1.0 → 1.0.0')).toBeVisible()
  await page.getByRole('button', { name: 'Открыть проект' }).click()
  await expect(page.getByLabel('Название воронки')).toHaveValue('Диагностика продукта')
})

test('мобильный интерфейс сохраняет доступ к схеме и библиотеке', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Мобильная проверка')
  await page.goto('/')
  await page.getByRole('button', { name: /Открыть полное демо/ }).click()
  await expect(page.locator('.funnel-node').first()).toBeVisible()
  await page.getByRole('button', { name: 'Блоки' }).click()
  const drawer = page.locator('.mobile-drawer')
  await expect(drawer.getByPlaceholder('Найти блок')).toBeVisible()
  await drawer.getByPlaceholder('Найти блок').fill('условие')
  await expect(drawer.getByRole('button', { name: /Условие/ })).toBeVisible()
})
