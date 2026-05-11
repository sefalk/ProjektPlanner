import { test, expect } from '@playwright/test'

test.describe('Sage-Import', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/import')
    await page.waitForLoadState('networkidle')
  })

  test('zeigt Seitenüberschrift', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /sage-import/i })).toBeVisible()
  })

  test('beide Tabs sind sichtbar', async ({ page }) => {
    await expect(page.getByRole('button', { name: /datei hochladen/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /text einfügen/i })).toBeVisible()
  })

  test('Datei-Tab zeigt Upload-Bereich und Importieren-Button', async ({ page }) => {
    await expect(page.getByText('CSV-Datei auswählen')).toBeVisible()
    await expect(page.getByRole('button', { name: /importieren/i })).toBeVisible()
  })

  test('Wechsel zu Text-einfügen-Tab zeigt Textarea', async ({ page }) => {
    await page.getByRole('button', { name: /text einfügen/i }).click()
    const textarea = page.getByRole('textbox')
    await expect(textarea).toBeVisible()
    await expect(textarea).toHaveAttribute('placeholder', /Datum;Mitarbeiter/)
  })

  test('Importverlauf-Abschnitt ist sichtbar', async ({ page }) => {
    await expect(page.getByText('Importverlauf')).toBeVisible()
  })
})
