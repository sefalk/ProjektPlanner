import { test, expect } from '@playwright/test'

test.describe('Kalender', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/calendar')
    await page.waitForLoadState('networkidle')
  })

  test('zeigt Seitenüberschrift und Monat', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Kalender' })).toBeVisible()
    // Month + year shown in the navigation span
    const monthSpan = page.locator('span.text-sm.font-medium').first()
    await expect(monthSpan).toBeVisible()
    const text = await monthSpan.textContent()
    expect(text?.trim()).toBeTruthy()
  })

  test('Vor/Zurück-Navigation wechselt den Monat', async ({ page }) => {
    const before = await page.locator('span.text-sm.font-medium').first().textContent()
    await page.getByRole('button', { name: /nächster monat/i }).click()
    await page.waitForLoadState('networkidle')
    const after = await page.locator('span.text-sm.font-medium').first().textContent()
    expect(after).not.toBe(before)

    await page.getByRole('button', { name: /vorheriger monat/i }).click()
    await page.waitForLoadState('networkidle')
    const restored = await page.locator('span.text-sm.font-medium').first().textContent()
    expect(restored).toBe(before)
  })

  test('Layer-Chips sind vorhanden', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Feiertage' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Urlaub' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Projekte' })).toBeVisible()
  })

  test('Filter-Dropdowns sind vorhanden', async ({ page }) => {
    // Program filter
    await expect(page.getByRole('combobox').first()).toBeVisible()
    const firstOption = await page.getByRole('combobox').first().locator('option').first().textContent()
    expect(firstOption).toContain('Alle Hauptprojekte')

    // Project filter
    const combos = page.getByRole('combobox')
    await expect(combos.nth(1)).toBeVisible()
    const secondOption = await combos.nth(1).locator('option').first().textContent()
    expect(secondOption).toContain('Alle Projekte')
  })

  test('Personen-Zeilen sind sichtbar wenn Daten vorhanden', async ({ page }) => {
    const table = page.getByRole('table')
    const tableVisible = await table.isVisible().catch(() => false)
    if (tableVisible) {
      await expect(table.getByRole('columnheader', { name: 'Person' })).toBeVisible()
    }
    const hasContent = await page.locator('table, p:has-text("Keine Personen")').first().isVisible()
    expect(hasContent).toBe(true)
  })

  test('Legende ist sichtbar', async ({ page }) => {
    await expect(page.getByText('Feiertag', { exact: true })).toBeVisible()
    await expect(page.getByText('Wochenende', { exact: true })).toBeVisible()
    await expect(page.getByText('Urlaub', { exact: true }).first()).toBeVisible()
  })

  test('Prognose-Chart ist nicht sichtbar ohne Projektauswahl', async ({ page }) => {
    // Chart only appears when a project is selected
    const chart = page.locator('text=Budgetverlauf')
    await expect(chart).not.toBeVisible()
  })

  test('Meilenstein-Badge zeigt Tooltip beim Hover', async ({ page }) => {
    // Milestone badges appear only when the current month has project milestones.
    // Use the milestone-badge container (span.group with cursor-default).
    const badge = page.locator('span.group.cursor-default').first()
    const badgeCount = await page.locator('span.group.cursor-default').count()

    if (badgeCount === 0) {
      // No milestone data in current month — pass gracefully.
      return
    }

    await badge.hover()

    // The tooltip div uses `invisible group-hover:visible`; after hover it should be visible.
    const tooltip = badge.locator('div.invisible')
    await expect(tooltip).toBeVisible()

    // Content: plan hours, current hours, status
    await expect(tooltip).toContainText('Plan:')
    await expect(tooltip).toContainText('Aktuell:')
    await expect(tooltip).toContainText('Status:')
  })
})
