import { test, expect } from '@playwright/test'

async function ensureProjectExists(page: import('@playwright/test').Page, number: string, name: string) {
  const rows = page.getByRole('row')
  const count = await rows.count()
  if (count < 2) {
    await page.getByRole('button', { name: /neu/i }).click()
    await page.getByLabel(/projektnummer/i).fill(number)
    await page.getByLabel(/^name$/i).fill(name)
    await page.getByLabel(/start/i).fill('2026-01-01')
    await page.getByLabel(/ende/i).fill('2026-12-31')
    const saved = page.waitForResponse(
      (r) => r.url().includes('/projects') && r.request().method() === 'POST',
      { timeout: 20_000 },
    )
    await page.getByRole('button', { name: /speichern/i }).click()
    await saved
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 })
  }
}

test.describe('Projekte-Verwaltung', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/projects')
    await page.waitForLoadState('networkidle')
  })

  test('zeigt die Projektliste an', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Projekte' })).toBeVisible()
    await expect(page.getByRole('button', { name: /neu/i })).toBeVisible()
  })

  test('öffnet den Neu-Dialog beim Klick auf Neu', async ({ page }) => {
    await page.getByRole('button', { name: /neu/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('heading', { name: /neues projekt/i })).toBeVisible()
  })

  test('schließt den Dialog beim Klick auf Abbrechen', async ({ page }) => {
    await page.getByRole('button', { name: /neu/i }).click()
    await page.getByRole('button', { name: /abbrechen/i }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
  })

  test('schließt den Dialog über den X-Button', async ({ page }) => {
    await page.getByRole('button', { name: /neu/i }).click()
    await page.getByRole('button', { name: /schließen/i }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
  })

  test('legt ein neues Projekt an und zeigt es in der Liste', async ({ page }) => {
    const uid = Date.now()
    const number = `P${uid}`
    const name = `E2E Projekt ${uid}`

    await page.getByRole('button', { name: /neu/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    await page.getByLabel(/projektnummer/i).fill(number)
    await page.getByLabel(/^name$/i).fill(name)
    await page.getByLabel(/start/i).fill('2026-01-01')
    await page.getByLabel(/ende/i).fill('2026-12-31')

    const saved = page.waitForResponse(
      (r) => r.url().includes('/projects') && r.request().method() === 'POST',
      { timeout: 20_000 },
    )
    await page.getByRole('button', { name: /speichern/i }).click()
    const resp = await saved
    expect(resp.status(), `POST /projects returned ${resp.status()}`).toBe(201)

    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(number)).toBeVisible()
    await expect(page.getByText(name)).toBeVisible()
  })

  test('navigiert zur Detailseite beim Klick auf eine Zeile', async ({ page }) => {
    await ensureProjectExists(page, 'P99002', 'Klick-Test')
    // Wait for any open modal to close before clicking row
    await expect(page.getByRole('dialog')).not.toBeVisible()
    await page.getByRole('row').nth(1).click()
    await expect(page).toHaveURL(/\/projects\/\d+/)
  })
})

test.describe('Projektdetail-Tabs', () => {
  test('zeigt alle 4 Tabs auf der Detailseite', async ({ page }) => {
    await page.goto('/projects')
    await page.waitForLoadState('networkidle')

    await ensureProjectExists(page, 'P99003', 'Tab-Test')
    await expect(page.getByRole('dialog')).not.toBeVisible()
    await page.getByRole('row').nth(1).click()
    await expect(page).toHaveURL(/\/projects\/\d+/)

    await expect(page.getByRole('button', { name: /meilensteine/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /rebalancing/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /rechnungen/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /mitglieder/i })).toBeVisible()
  })
})
