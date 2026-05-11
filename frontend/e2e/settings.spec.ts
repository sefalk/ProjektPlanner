import { test, expect } from '@playwright/test'

test.describe('Einstellungen', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')
  })

  test('zeigt Seitenüberschrift', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Einstellungen' })).toBeVisible()
  })

  test('zeigt Standard-Urlaubstage Einstellung', async ({ page }) => {
    await expect(page.getByText('Standard-Urlaubstage', { exact: false })).toBeVisible()
    await expect(page.getByRole('button', { name: /bearbeiten/i }).first()).toBeVisible()
  })

  test('Einstellung bearbeiten öffnet Eingabefeld', async ({ page }) => {
    await page.getByRole('button', { name: /bearbeiten/i }).first().click()
    await expect(page.getByRole('spinbutton')).toBeVisible()
    await expect(page.getByRole('button', { name: /speichern/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /abbrechen/i })).toBeVisible()
  })

  test('Abbrechen schließt Eingabefeld', async ({ page }) => {
    await page.getByRole('button', { name: /bearbeiten/i }).first().click()
    await expect(page.getByRole('spinbutton')).toBeVisible()
    await page.getByRole('button', { name: /abbrechen/i }).click()
    await expect(page.getByRole('spinbutton')).not.toBeVisible()
    await expect(page.getByRole('button', { name: /bearbeiten/i }).first()).toBeVisible()
  })

  test('Einstellungsseite über Sidebar erreichbar', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Einstellungen' }).click()
    await expect(page).toHaveURL(/\/settings/)
  })
})
